/*
 * signalk-meshcore
 *
 * SignalK Node Server plugin that connects to a MeshCore companion radio
 * device over TCP/WiFi, listens for incoming contact messages, decodes
 * MeshCore "#TEL:" telemetry payloads (lat/lon/battery), and republishes
 * each reporting node into SignalK as a vessel ("AIS-style" target) with
 * position + battery data so it shows up on the chart plotter / webapp
 * with a track, just like a normal AIS target.
 *
 * Uses the official @liamcottle/meshcore.js library to talk to the
 * Companion Radio firmware (TCPConnection) and to decode/await messages.
 */

const fs = require("fs");
const path = require("path");

module.exports = function (app) {
  const plugin = {};
  let connection = null;
  let reconnectTimer = null;
  let stopped = false;

  // Cache of contacts we've seen, keyed by lowercase hex pubKeyPrefix,
  // so we know the friendly name to use in SignalK.
  const knownContacts = new Map();
  // Reverse lookup: advertised name -> stable hex pubkey id, so a channel
  // message with a sender name we recognise from the contact list reuses
  // the same vessel identity as that contact's direct messages, instead
  // of creating a second, separately-keyed vessel for the same node.
  const contactNameToHexId = new Map();

  plugin.id = "signalk-meshcore";
  plugin.name = "MeshCore Telemetry";
  plugin.description =
    "Connects to a MeshCore companion radio over TCP, decodes #TEL: telemetry messages and publishes nodes as SignalK/AIS targets";

  plugin.schema = {
    type: "object",
    required: ["connectionType"],
    properties: {
      connectionType: {
        type: "string",
        title: "Connection type",
        description: "TCP/WiFi for a MeshCore device with WiFi companion firmware. USB Serial for a device connected by USB cable.",
        enum: ["tcp", "serial"],
        enumNames: ["TCP / WiFi", "USB Serial"],
        default: "tcp"
      },
      host: {
        type: "string",
        title: "MeshCore device IP address",
        description: "IP address of the MeshCore companion radio (WiFi/TCP firmware). Only used when connection type is TCP.",
        default: "192.168.1.50"
      },
      port: {
        type: "number",
        title: "MeshCore device TCP port",
        description: "Only used when connection type is TCP.",
        default: 5000
      },
      serialPort: {
        type: "string",
        title: "USB serial port path",
        description: "Path to the serial device. Linux: /dev/ttyUSB0 or /dev/ttyACM0. Mac: /dev/cu.usbmodem14401. Only used when connection type is USB Serial.",
        default: "/dev/ttyUSB0"
      },
      reconnectDelaySeconds: {
        type: "number",
        title: "Reconnect delay (seconds) if connection drops",
        default: 10
      },
      listenOnAllChannels: {
        type: "boolean",
        title: "Listen for #TEL: messages on all channels",
        default: true
      },
      captureLocationAdverts: {
        type: "boolean",
        title: "Capture location adverts from non-Team nodes",
        description: "Opt-in. Also listens for MeshCore node advertisements and captures location when lat/lon are present. Advertisements without coordinates are ignored.",
        default: false
      },
      vesselTypeId: {
        type: "number",
        title: "AIS vessel type for MeshCore nodes",
        description: "Controls which icon freeboard-sk displays for each node. 37 = Pleasure Craft, 36 = Sailing Vessel (sailboat icon), 51 = Search & Rescue, 52 = Tug, 90 = Other",
        enum: [37, 36, 35, 51, 52, 58, 90],
        default: 37
      },
      channelIndexes: {
        type: "string",
        title: "Channel indexes to listen on (comma separated, e.g. 0,2,5)",
        description: "Only used when \"Listen on all channels\" is turned off. Channel 0 is normally 'public'.",
        default: "0"
      },
      staleTargetMinutes: {
        type: "number",
        title: "Minutes of inactivity before a node is considered stale (informational only)",
        default: 30
      },
      persistNodes: {
        type: "boolean",
        title: "Keep a persistent database of seen nodes",
        description: "Saves last-known name/position/timestamp for every node to disk so they survive a SignalK restart",
        default: true
      },
      associateWithAisVessels: {
        type: "boolean",
        title: "Associate nodes with existing AIS/SignalK vessels by name",
        description: "If a node's name matches the pattern 'DE <callsign>' (e.g. 'DE MMXY9'), and a vessel with that callsign already exists in SignalK, publish the node's data onto that vessel instead of creating a separate MeshCore target",
        default: false
      },
      shareOwnPosition: {
        type: "boolean",
        title: "Share this vessel's position with the MeshCore device",
        description: "Periodically pushes this vessel's SignalK GNSS position to the MeshCore device's own advertised location, so crew ashore can see the boat",
        default: false
      },
      shareOwnPositionIntervalMinutes: {
        type: "number",
        title: "How often to share own position (minutes)",
        default: 15
      },
      sendOwnTelToMesh: {
        type: "boolean",
        title: "Broadcast own #TEL: telemetry to the mesh",
        description: "Sends this vessel's position/battery as a standard #TEL: message on a chosen channel, so other apps/nodes that understand this format (including other MeshCore boats) can see this vessel too. Uses the same interval as 'Share own position'.",
        default: false
      },
      ownTelChannelIndex: {
        type: "number",
        title: "Channel index to broadcast #TEL: on",
        description: "Channel 0 ('public') is never used for sending, even if set here - pick a channel that other TEL-aware nodes are listening on.",
        default: 1
      },
      relayAlertsToMesh: {
        type: "boolean",
        title: "Relay SignalK alerts to the mesh as text messages",
        description: "Sends a text message over MeshCore whenever a SignalK notification reaches alert/warn/alarm/emergency state",
        default: false
      },
      alertChannelIndex: {
        type: "number",
        title: "Channel index to send alerts on",
        description: "Channel 0 ('public') is never used for sending, even if set here.",
        default: 1
      },
      alertMinSeverity: {
        type: "string",
        title: "Minimum notification severity to relay",
        enum: ["alert", "warn", "alarm", "emergency"],
        default: "alarm"
      },
      recoverTelFromUnknownFrames: {
        type: "boolean",
        title: "Listen for MeshCore telemetry outside channels",
        description: "Off by default. Decodes raw or unrecognised MeshCore frames that contain a #TEL: payload, which can surface default telemetry broadcasts outside normal channel messages. Turning this on can create duplicate vessels if the same data is also delivered as a channel/contact message.",
        default: false
      }
    }
  };

  // ---------------------------------------------------------------------
  // Persistent node database
  // ---------------------------------------------------------------------
  // Keeps last-known name/position/timestamp for every node seen, so the
  // list survives a SignalK restart (mirrors signalk-meshtastic's
  // "persistent database of all seen nodes" behaviour).
  let nodeDb = {};
  let nodeDbPath = null;

  function nodeDbFilePath() {
    if (!nodeDbPath) {
      const dataDir = app.getDataDirPath ? app.getDataDirPath() : path.join(__dirname, "data");
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch (err) {
        // ignore, write will fail loudly below if this is a real problem
      }
      nodeDbPath = path.join(dataDir, "meshcore-nodes.json");
    }
    return nodeDbPath;
  }

  function loadNodeDb() {
    try {
      const raw = fs.readFileSync(nodeDbFilePath(), "utf8");
      nodeDb = JSON.parse(raw);
      app.debug(`Loaded ${Object.keys(nodeDb).length} known MeshCore node(s) from disk`);
    } catch (err) {
      nodeDb = {};
    }
  }

  function saveNodeDb() {
    try {
      fs.writeFileSync(nodeDbFilePath(), JSON.stringify(nodeDb, null, 2));
    } catch (err) {
      app.debug(`Failed to persist MeshCore node database: ${err.message}`);
    }
  }

  function recordNodeSeen(hexId, displayName, tel) {
    nodeDb[hexId] = {
      name: displayName,
      latitude: tel.latitude,
      longitude: tel.longitude,
      batteryMv: tel.batteryMv,
      lastSeen: new Date().toISOString()
    };
    if (pluginOptions.persistNodes !== false) {
      saveNodeDb();
    }
  }

  // ---------------------------------------------------------------------
  // #TEL: decoder, as supplied: 11 raw bytes -> lat, lon, battery, etc.
  // ---------------------------------------------------------------------
  function decodeTEL(message) {
    if (typeof message !== "string" || !message.startsWith("#TEL:")) {
      return null;
    }

    const b64 = message.substring(5);
    let raw;
    try {
      raw = Buffer.from(b64, "base64");
    } catch (err) {
      app.debug(`Failed to base64-decode TEL payload: ${err.message}`);
      return null;
    }

    if (raw.length !== 11) {
      app.debug(`Invalid TEL length: ${raw.length} (expected 11)`);
      return null;
    }

    const latInt = raw.readInt32BE(0);
    const lonInt = raw.readInt32BE(4);
    const latitude = latInt / 10000000;
    const longitude = lonInt / 10000000;

    let batteryMv = null;
    if (raw[8] >= 2) {
      batteryMv = (raw[8] - 2) * 6 + 2750;
    }

    return {
      latitude,
      longitude,
      batteryMv,
      phoneBattery: raw[9],
      forwardStatus: raw[10]
    };
  }

  // Inverse of decodeTEL(): builds a "#TEL:<base64>" string from
  // lat/lon/battery values, so this vessel can broadcast its own
  // telemetry in the same format other MeshCore nodes use.
  function encodeTEL({ latitude, longitude, batteryMv, phoneBattery, forwardStatus }) {
    const raw = Buffer.alloc(11);
    raw.writeInt32BE(Math.round(latitude * 10000000), 0);
    raw.writeInt32BE(Math.round(longitude * 10000000), 4);

    let batteryByte = 0;
    if (typeof batteryMv === "number") {
      batteryByte = Math.max(0, Math.min(255, Math.round((batteryMv - 2750) / 6) + 2));
    }
    raw[8] = batteryByte;
    raw[9] = typeof phoneBattery === "number" ? Math.max(0, Math.min(255, phoneBattery)) : 0xfe;
    raw[10] = typeof forwardStatus === "number" ? Math.max(0, Math.min(255, forwardStatus)) : 0;

    return `#TEL:${raw.toString("base64")}`;
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  // Turn a 6-byte pubKeyPrefix Buffer into a stable hex string id, and a
  // SignalK-safe vessel context, e.g.
  //   vessels.urn:mrn:signalk:uuid:meshcore-aabbccddeeff
  function prefixToHex(pubKeyPrefix) {
    return Buffer.from(pubKeyPrefix).toString("hex");
  }

  function contextForNode(hexId) {
    return `vessels.urn:mrn:signalk:uuid:meshcore-${hexId}`;
  }

  // If the node's display name matches the "DE <callsign>" convention
  // (mirroring signalk-meshtastic's vessel-association feature) and an
  // existing AIS/SignalK vessel with that callsign can be found, return
  // its context so the MeshCore data is merged onto that vessel instead
  // of creating a separate target.
  function findAssociatedVesselContext(displayName) {
    if (!displayName) return null;
    const match = displayName.match(/^DE\s+([A-Za-z0-9]+)$/i);
    if (!match) return null;

    const callsign = match[1].toUpperCase();
    try {
      const fullData = app.signalk.retrieve();
      const vessels = (fullData && fullData.vessels) || {};
      for (const [uuid, vessel] of Object.entries(vessels)) {
        const vesselCallsign =
          (vessel.communication && vessel.communication.callsignVhf) ||
          vessel.mmsi ||
          null;
        if (vesselCallsign && vesselCallsign.toString().toUpperCase() === callsign) {
          return `vessels.${uuid}`;
        }
      }
    } catch (err) {
      app.debug(`Vessel association lookup failed: ${err.message}`);
    }
    return null;
  }

  // Deterministically derive a 9-digit pseudo-MMSI from the node id.
  // Prefix 99 = "other" ITU range, then 7 more digits from a hash.
  // MUST be exactly 9 digits - freeboard-sk validates the length.
  function pseudoMmsi(hexId) {
    let hash = 0;
    for (let i = 0; i < hexId.length; i++) {
      hash = (hash * 31 + hexId.charCodeAt(i)) >>> 0;
    }
    return Number(`99${(hash % 10000000).toString().padStart(7, "0")}`);
  }

  // AIS ship type id -> human label for the subset freeboard-sk icons support.
  const AIS_TYPE_NAMES = {
    36: "Sailing Vessel",
    37: "Pleasure Craft",
    35: "Military Ops",
    51: "Search and Rescue",
    52: "Tug",
    58: "Medical Transport",
    90: "Other",
    99: "Other"
  };

  function isMeaningfulDisplayName(displayName, hexId) {
    if (!displayName) {
      return false;
    }
    const normalized = normalizeDisplayName(displayName);
    if (!normalized) {
      return false;
    }
    if (hexId && normalized.toLowerCase() === hexId.toLowerCase()) {
      return false;
    }
    if (/^channel\d+$/i.test(normalized)) {
      return false;
    }
    return true;
  }

  function publishTelemetry(hexId, displayName, tel) {
    let context = contextForNode(hexId);
    if (pluginOptions.associateWithAisVessels) {
      const associated = findAssociatedVesselContext(displayName);
      if (associated) {
        app.debug(`Associated node "${displayName}" with existing vessel ${associated}`);
        context = associated;
      }
    }
    const timestamp = new Date().toISOString();
    const mmsi = pseudoMmsi(hexId);
    const shipTypeId = pluginOptions.vesselTypeId || 37;
    const shipTypeName = AIS_TYPE_NAMES[shipTypeId] || "Other";
    const label = isMeaningfulDisplayName(displayName, hexId) ? normalizeDisplayName(displayName) : null;

    const values = [
      { path: "navigation.position", value: { latitude: tel.latitude, longitude: tel.longitude } },
      { path: "mmsi", value: mmsi },
      { path: "design.aisShipType", value: { id: shipTypeId, name: shipTypeName } },
      { path: "sensors.meshcore.forwardStatus", value: tel.forwardStatus },
      { path: "sensors.meshcore.phoneBattery", value: tel.phoneBattery }
    ];

    if (label) {
      values.push({ path: "name", value: label });
      values.push({ path: "communication.callsignVhf", value: label });
    }

    if (tel.batteryMv !== null) {
      values.push({
        path: "electrical.batteries.meshcore.voltage",
        value: tel.batteryMv / 1000
      });
    }

    const delta = {
      context,
      updates: [
        {
          $source: plugin.id,
          timestamp,
          values
        }
      ]
    };

    app.handleMessage(plugin.id, delta);
    app.debug(
      `Published MeshCore TEL for ${label || hexId} (mmsi=${mmsi}): lat=${tel.latitude} lon=${tel.longitude} knownContact=${knownContacts.get(hexId) || ''} contactNameKey=${label ? contactNameToHexId.get(normalizeDisplayName(label)) || '' : ''}`
    );
    recordNodeSeen(hexId, displayName, tel);
  }

  function publishAdvertLocation(hexId, displayName, latitude, longitude) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return;
    }

    const context = contextForNode(hexId);
    const timestamp = new Date().toISOString();
    const label = isMeaningfulDisplayName(displayName, hexId) ? normalizeDisplayName(displayName) : null;
    if (label) {
      knownContacts.set(hexId, label);
      contactNameToHexId.set(label, hexId);
    }
    const mmsi = pseudoMmsi(hexId);
    const shipTypeId = pluginOptions.vesselTypeId || 37;
    const shipTypeName = AIS_TYPE_NAMES[shipTypeId] || "Other";
    const delta = {
      context,
      updates: [
        {
          $source: plugin.id,
          timestamp,
          values: [
            { path: "navigation.position", value: { latitude, longitude } },
            { path: "mmsi", value: mmsi },
            { path: "design.aisShipType", value: { id: shipTypeId, name: shipTypeName } },
            ...(label ? [{ path: "name", value: label }, { path: "communication.callsignVhf", value: label }] : [])
          ]
        }
      ]
    };

    app.handleMessage(plugin.id, delta);
    app.debug(`Published MeshCore advert location for ${label || hexId}: lat=${latitude} lon=${longitude}`);
    recordNodeSeen(hexId, displayName, { latitude, longitude, batteryMv: null });
  }

  function parseLocationAdvertCoordinates(message) {
    if (!message) {
      return null;
    }

    if (!Number.isFinite(message.advLat) || !Number.isFinite(message.advLon)) {
      return null;
    }

    return {
      latitude: message.advLat / 1000000,
      longitude: message.advLon / 1000000
    };
  }

  function hexIdFromAdvert(message) {
    const publicKey = message && message.publicKey;
    if (!publicKey) {
      return null;
    }
    return prefixToHex(Buffer.from(publicKey).subarray(0, 6));
  }

  function handleLocationAdvert(message) {
    if (!pluginOptions.captureLocationAdverts) {
      return;
    }

    if (Number(message.type) === 2) {
      return;
    }

    const location = parseLocationAdvertCoordinates(message);
    if (!location) {
      return;
    }

    const hexId = hexIdFromAdvert(message);
    if (!hexId) {
      return;
    }

    const displayName = isMeaningfulDisplayName(message.advName, hexId)
      ? message.advName
      : isMeaningfulDisplayName(knownContacts.get(hexId), hexId)
        ? knownContacts.get(hexId)
        : null;
    if (displayName) {
      knownContacts.set(hexId, displayName);
      contactNameToHexId.set(normalizeDisplayName(displayName), hexId);
    }
    publishAdvertLocation(hexId, displayName, location.latitude, location.longitude);
  }

  // ---------------------------------------------------------------------
  // MeshCore connection handling
  // ---------------------------------------------------------------------
  let pluginOptions = {};

  function parseAllowedChannels(options) {
    if (options.listenOnAllChannels !== false) {
      return null; // null = no filtering, allow everything
    }
    const raw = (options.channelIndexes || "0").toString();
    const indexes = raw
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n));
    return new Set(indexes.length ? indexes : [0]);
  }

  function isChannelAllowed(channelIdx) {
    const allowed = parseAllowedChannels(pluginOptions);
    return allowed === null || allowed.has(channelIdx);
  }

  function normalizeDisplayName(name) {
    return typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  }

  async function handleChannelMessage(message) {
    if (!isChannelAllowed(message.channelIdx)) {
      app.debug(`Ignoring message on channel ${message.channelIdx} (not in configured channel list)`);
      return;
    }

    // Channel/broadcast messages have no sender identity (no pubKeyPrefix)
    // in meshcore.js's parsed object - only a channelIdx. If your nodes
    // prefix their text with a name (e.g. "NodeName: #TEL:...") we try to
    // pull that out so different nodes don't collapse onto one target;
    // otherwise we fall back to a generic per-channel id.
    let text = message.text;
    let senderName = null;

    const prefixMatch = text.match(/^([^:]{1,32}):\s*(#TEL:.+)$/);
    if (prefixMatch) {
      senderName = prefixMatch[1].trim();
      text = prefixMatch[2].trim();
    }

    const tel = decodeTEL(text);
    if (!tel) return;

    // Prefer the stable contact-derived id if this sender name matches a
    // known contact, so this node doesn't get a second, separate vessel
    // when it also talks via direct/contact messages.
    const normalizedSenderName = normalizeDisplayName(senderName);
    const hexId = normalizedSenderName
      ? contactNameToHexId.get(normalizedSenderName) || Buffer.from(normalizedSenderName).toString("hex")
      : `channel${message.channelIdx}`;
    const displayName = senderName || `Channel ${message.channelIdx} node`;

    app.debug(
      `MeshCore channel #${message.channelIdx} TEL message${displayName ? ` from ${displayName}` : " (no sender id available)"}: ${message.text}`
    );

    publishTelemetry(hexId, displayName, tel);
  }

  async function handleContactMessage(meshcore, message) {
    const hexId = prefixToHex(message.pubKeyPrefix);

    // Resolve a friendly name for this contact, looking it up (and
    // caching) from the device's contact list if we haven't seen it yet.
    let displayName = knownContacts.get(hexId);
    if (!isMeaningfulDisplayName(displayName, hexId)) {
      try {
        const contact = await connection.findContactByPublicKeyPrefix(message.pubKeyPrefix);
        displayName = contact && isMeaningfulDisplayName(contact.advName, hexId) ? contact.advName : null;
      } catch (err) {
        app.debug(`Could not resolve contact name for ${hexId}: ${err.message}`);
        displayName = null;
      }
      if (displayName) {
        knownContacts.set(hexId, displayName);
        contactNameToHexId.set(normalizeDisplayName(displayName), hexId);
      }
    }

    app.debug(`MeshCore message from ${displayName} (${hexId}): ${message.text}`);

    const tel = decodeTEL(message.text);
    if (tel) {
      publishTelemetry(hexId, displayName, tel);
    }
    // Non-#TEL: messages are ignored for now; extend here if you also
    // want to surface plain chat text, e.g. as a notification.
  }

  // ---------------------------------------------------------------------
  // Raw frame logging + fallback #TEL: recovery
  // ---------------------------------------------------------------------

  // Render a frame's bytes as printable text for logging, replacing
  // non-printable bytes with '.' so binary header bytes don't break
  // the log line.
  function frameToReadableText(frame) {
    return Buffer.from(frame)
      .toString("latin1")
      .replace(/[^\x20-\x7e]/g, ".");
  }

  function frameToHex(frame) {
    return Buffer.from(frame).toString("hex").match(/.{1,2}/g)?.join(" ") || "";
  }

  function frameToAscii(frame) {
    return Buffer.from(frame)
      .toString("latin1")
      .replace(/[^\x20-\x7e]/g, ".");
  }

  function frameNameFromCode(code, Constants) {
    const entries = [
      ...Object.entries(Constants.ResponseCodes),
      ...Object.entries(Constants.PushCodes)
    ];
    const match = entries.find(([, value]) => value === code);
    return match ? match[0] : `0x${code.toString(16)}`;
  }

  function bufferToHex(value, maxBytes = null) {
    if (!value) return "";
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const slice = maxBytes === null ? bytes : bytes.subarray(0, maxBytes);
    const hex = slice.toString("hex");
    return hex.match(/.{1,2}/g)?.join("") || "";
  }

  function bufferToShortHex(value, maxBytes = 6) {
    const hex = bufferToHex(value, maxBytes);
    return hex ? `0x${hex}` : "";
  }

  function formatNumber(value, digits = 6) {
    return typeof value === "number" ? Number(value.toFixed(digits)).toString() : "n/a";
  }

  function formatFlags(flags) {
    return typeof flags === "number" ? `0x${flags.toString(16).padStart(2, "0")}` : "n/a";
  }

  function formatPathLen(pathLen) {
    return typeof pathLen === "number" ? pathLen.toString() : "n/a";
  }

  function describeAdvert(payload) {
    return [
      `name=${payload.advName || ""}`,
      `type=${payload.type}`,
      `flags=${formatFlags(payload.flags)}`,
      `lat=${formatNumber(payload.advLat / 1000000)}`,
      `lon=${formatNumber(payload.advLon / 1000000)}`,
      `lastAdvert=${payload.lastAdvert}`,
      `pubkey=${bufferToShortHex(payload.publicKey)}`
    ].join(" ");
  }

  function describeContact(payload) {
    return [
      `name=${payload.advName || ""}`,
      `type=${payload.type}`,
      `flags=${formatFlags(payload.flags)}`,
      `lat=${formatNumber(payload.advLat / 1000000)}`,
      `lon=${formatNumber(payload.advLon / 1000000)}`,
      `lastAdvert=${payload.lastAdvert}`,
      `pubkey=${bufferToShortHex(payload.publicKey)}`
    ].join(" ");
  }

  function describeTextMessage(payload) {
    return [
      `pathLen=${formatPathLen(payload.pathLen)}`,
      `txtType=${payload.txtType}`,
      `ts=${payload.senderTimestamp}`,
      `text=${payload.text}`
    ].join(" ");
  }

  function describeChannelMessage(payload) {
    return [
      `channel=${payload.channelIdx}`,
      `pathLen=${formatPathLen(payload.pathLen)}`,
      `txtType=${payload.txtType}`,
      `ts=${payload.senderTimestamp}`,
      `text=${payload.text}`
    ].join(" ");
  }

  function describeTelemetryResponse(payload) {
    return [
      `pubkey=${bufferToShortHex(payload.pubKeyPrefix)}`,
      `lppBytes=${payload.lppSensorData ? Buffer.from(payload.lppSensorData).length : 0}`
    ].join(" ");
  }

  function describeStats(payload) {
    return `type=${payload.type} data=${formatLogValue(payload.data)}`;
  }

  function describeChannelData(payload) {
    return [
      `snr=${typeof payload.snr === "number" ? payload.snr.toFixed(2) : "n/a"}`,
      `channel=${payload.channelIdx}`,
      `pathLen=${formatPathLen(payload.pathLen)}`,
      `dataType=${payload.dataType}`,
      `dataLen=${payload.data ? Buffer.from(payload.data).length : 0}`,
      `data=0x${bufferToHex(payload.data)}`
    ].join(" ");
  }

  function describeTraceData(payload) {
    return [
      `pathLen=${payload.pathLen}`,
      `flags=${payload.flags}`,
      `tag=${payload.tag}`,
      `authCode=${payload.authCode}`,
      `lastSnr=${payload.lastSnr}`
    ].join(" ");
  }

  function describeBinaryResponse(payload) {
    return [
      `tag=${payload.tag}`,
      `bytes=${payload.responseData ? Buffer.from(payload.responseData).length : 0}`,
      `data=0x${bufferToHex(payload.responseData)}`
    ].join(" ");
  }

  function describeGenericPayload(payload) {
    return formatLogValue(payload);
  }

  function formatEventPayload(label, payload) {
    if (!payload) {
      return `${label}: {}`;
    }

    if (payload.advName !== undefined && payload.publicKey !== undefined) {
      return `${label}: ${describeAdvert(payload)}`;
    }

    if (payload.channelIdx !== undefined && payload.text !== undefined) {
      return `${label}: ${describeChannelMessage(payload)}`;
    }

    if (payload.pubKeyPrefix !== undefined && payload.text !== undefined) {
      return `${label}: ${describeTextMessage(payload)}`;
    }

    if (payload.lppSensorData !== undefined) {
      return `${label}: ${describeTelemetryResponse(payload)}`;
    }

    if (payload.data !== undefined && payload.type !== undefined) {
      return `${label}: ${describeStats(payload)}`;
    }

    if (payload.dataType !== undefined) {
      return `${label}: ${describeChannelData(payload)}`;
    }

    if (payload.pathLen !== undefined && payload.tag !== undefined && payload.authCode !== undefined) {
      return `${label}: ${describeTraceData(payload)}`;
    }

    if (payload.responseData !== undefined) {
      return `${label}: ${describeBinaryResponse(payload)}`;
    }

    if (payload.publicKey !== undefined && payload.advLat !== undefined && payload.advLon !== undefined) {
      return `${label}: ${describeContact(payload)}`;
    }

    return `${label}: ${describeGenericPayload(payload)}`;
  }

  function formatRawFrame(frame, Constants) {
    const bytes = Buffer.from(frame);
    const code = bytes.length ? bytes[0] : null;
    const name = code === null ? "empty" : frameNameFromCode(code, Constants);
    return `RX frame ${name} (code=${code}, len=${bytes.length}) hex=[${frameToHex(bytes)}] ascii=[${frameToAscii(bytes)}]`;
  }

  function formatLogValue(value) {
    return JSON.stringify(value, (_key, currentValue) => {
      if (Buffer.isBuffer(currentValue)) {
        return `0x${currentValue.toString("hex")}`;
      }
      if (currentValue instanceof Uint8Array) {
        return `0x${Buffer.from(currentValue).toString("hex")}`;
      }
      return currentValue;
    });
  }

  function logFrameEvent(label, payload) {
    app.debug(formatEventPayload(label, payload));
  }

  function buildKnownCodesSet(Constants) {
    return new Set([
      ...Object.values(Constants.ResponseCodes),
      ...Object.values(Constants.PushCodes)
    ]);
  }

  function attachFrameHandlers(connection, Constants) {
    const eventHandlers = new Map([
      [Constants.PushCodes.Advert, "MeshCore advert push"],
      [Constants.PushCodes.PathUpdated, "MeshCore path updated push"],
      [Constants.PushCodes.SendConfirmed, "MeshCore send confirmed push"],
      [Constants.PushCodes.MsgWaiting, "MeshCore msg waiting push"],
      [Constants.PushCodes.RawData, "MeshCore raw data push"],
      [Constants.PushCodes.LoginSuccess, "MeshCore login success push"],
      [Constants.PushCodes.LoginFail, "MeshCore login fail push"],
      [Constants.PushCodes.StatusResponse, "MeshCore status response push"],
      [Constants.PushCodes.LogRxData, "MeshCore rx log push"],
      [Constants.PushCodes.TraceData, "MeshCore trace data push"],
      [Constants.PushCodes.NewAdvert, "MeshCore new advert push"],
      [Constants.PushCodes.TelemetryResponse, "MeshCore telemetry response push"],
      [Constants.PushCodes.BinaryResponse, "MeshCore binary response push"],
      [Constants.ResponseCodes.Ok, "MeshCore ok response"],
      [Constants.ResponseCodes.Err, "MeshCore error response"],
      [Constants.ResponseCodes.ContactsStart, "MeshCore contacts start response"],
      [Constants.ResponseCodes.Contact, "MeshCore contact response"],
      [Constants.ResponseCodes.EndOfContacts, "MeshCore end of contacts response"],
      [Constants.ResponseCodes.SelfInfo, "MeshCore self info response"],
      [Constants.ResponseCodes.Sent, "MeshCore sent response"],
      [Constants.ResponseCodes.ContactMsgRecv, "MeshCore contact message recv"],
      [Constants.ResponseCodes.ChannelMsgRecv, "MeshCore channel message recv"],
      [Constants.ResponseCodes.CurrTime, "MeshCore current time response"],
      [Constants.ResponseCodes.NoMoreMessages, "MeshCore no more messages response"],
      [Constants.ResponseCodes.ExportContact, "MeshCore export contact response"],
      [Constants.ResponseCodes.BatteryVoltage, "MeshCore battery voltage response"],
      [Constants.ResponseCodes.DeviceInfo, "MeshCore device info response"],
      [Constants.ResponseCodes.PrivateKey, "MeshCore private key response"],
      [Constants.ResponseCodes.Disabled, "MeshCore disabled response"],
      [Constants.ResponseCodes.ChannelInfo, "MeshCore channel info response"],
      [Constants.ResponseCodes.SignStart, "MeshCore sign start response"],
      [Constants.ResponseCodes.Signature, "MeshCore signature response"],
      [Constants.ResponseCodes.Stats, "MeshCore stats response"],
      [Constants.ResponseCodes.ChannelDataRecv, "MeshCore channel data recv"]
    ]);

    for (const [eventCode, label] of eventHandlers.entries()) {
      connection.on(eventCode, (payload) => logFrameEvent(label, payload));
    }
  }

  // For frames the library doesn't structurally recognise (e.g. custom
  // firmware push types), we don't get a clean text/contact/channel
  // field to work with - so fall back to scanning the raw decoded text
  // for a #TEL: payload and decoding it directly. There's no reliable
  // sender identity in this case, so it's published under a generic id
  // built from the frame's response code.
  function tryRecoverTelFromRawFrame(frame, code) {
    const text = frameToReadableText(frame);
    const match = text.match(/#TEL:[A-Za-z0-9+/=]+/);
    if (!match) return;

    const tel = decodeTEL(match[0]);
    if (!tel) return;

    const hexId = `raw-frame-${code}`;
    app.debug(`Recovered #TEL: message from otherwise-unhandled frame (code=${code}): ${match[0]}`);
    publishTelemetry(hexId, `MeshCore (frame code ${code})`, tel);
  }

  async function connectToMeshCore(options) {
    if (stopped) return;

    // meshcore.js is an ESM-only package; dynamic import works from this
    // CommonJS plugin file.
    const { TCPConnection, NodeJSSerialConnection, Constants } = await import("@liamcottle/meshcore.js");

    const isSerial = options.connectionType === "serial";
    const connectionLabel = isSerial
      ? `USB serial port ${options.serialPort || "/dev/ttyUSB0"}`
      : `${options.host}:${options.port}`;

    app.setPluginStatus(`Connecting to MeshCore via ${connectionLabel}...`);

    if (isSerial) {
      const portPath = options.serialPort || "/dev/ttyUSB0";
      connection = new NodeJSSerialConnection(portPath);
    } else {
      connection = new TCPConnection(options.host, options.port);
    }

    const knownCodes = buildKnownCodesSet(Constants);
    attachFrameHandlers(connection, Constants);

    // Fires for every frame received, before the library decides whether
    // it knows how to parse it. Used to (a) log a human-readable decode
    // of every incoming frame, and (b) catch #TEL: payloads inside frame
    // types the library doesn't structurally support yet.
    connection.on("rx", (frame) => {
      const code = frame && frame.length ? frame[0] : null;
      app.debug(formatRawFrame(frame, Constants));

      if (code !== null && pluginOptions.recoverTelFromUnknownFrames && !knownCodes.has(code)) {
        tryRecoverTelFromRawFrame(frame, code);
      }
    });

    connection.on("connected", async () => {
      app.setPluginStatus(`Connected to MeshCore via ${connectionLabel}`);
      app.debug("MeshCore connection established");
      try {
        // Pre-warm the contact list/cache so names are available
        // immediately instead of after the first lookup.
        const contacts = await connection.getContacts();
        for (const contact of contacts) {
          const hexId = prefixToHex(contact.publicKey.subarray(0, 6));
          if (isMeaningfulDisplayName(contact.advName, hexId)) {
            knownContacts.set(hexId, contact.advName);
            contactNameToHexId.set(normalizeDisplayName(contact.advName), hexId);
                }
          if (Number(contact.type) === 2) {
            continue;
          }
          if (pluginOptions.captureLocationAdverts && Number.isFinite(contact.advLat) && Number.isFinite(contact.advLon)) {
            const latitude = contact.advLat / 1000000;
            const longitude = contact.advLon / 1000000;
            publishAdvertLocation(hexId, contact.advName || hexId, latitude, longitude);
          }
        }
      } catch (err) {
        app.debug(`Failed to pre-load MeshCore contacts: ${err.message}`);
      }
      startOwnPositionSharing(options);
      startAlertRelay(options);
    });

    connection.on(Constants.PushCodes.NewAdvert, async (message) => {
      try {
        handleLocationAdvert(message);
      } catch (err) {
        app.debug(`Failed to process MeshCore new-advert message: ${err.message}`);
      }
    });

    connection.on("disconnected", () => {
      app.setPluginStatus(`Disconnected from MeshCore (${connectionLabel}), will retry...`);
      stopOwnPositionSharing();
      stopAlertRelay();
      scheduleReconnect(options);
    });

    connection.on(Constants.PushCodes.MsgWaiting, async () => {
      try {
        const waitingMessages = await connection.getWaitingMessages();
        for (const message of waitingMessages) {
          if (message.contactMessage) {
            await handleContactMessage(connection, message.contactMessage);
          } else if (message.channelMessage) {
            await handleChannelMessage(message.channelMessage);
          }
        }
      } catch (err) {
        app.error(`Error processing MeshCore message: ${err.message}`);
      }
    });

    try {
      await connection.connect();
    } catch (err) {
      app.setPluginStatus(`Failed to connect to MeshCore (${connectionLabel}): ${err.message}`);
      scheduleReconnect(options);
    }
  }

  // Hard rule: never transmit on channel 0 ("public"), even if a config
  // value somehow resolves to it (bad input, leftover default, etc).
  function isBlockedPublicChannel(channelIdx) {
    return channelIdx === 0 || channelIdx === null || typeof channelIdx === "undefined";
  }

  async function sendOnChannelSafely(channelIdx, text, label) {
    if (isBlockedPublicChannel(channelIdx)) {
      app.debug(`Refusing to send ${label} on channel 0 (public) - choose a different channel in settings`);
      return;
    }
    try {
      await connection.sendChannelTextMessage(channelIdx, text);
      app.debug(`Sent ${label} on channel ${channelIdx}: ${text}`);
    } catch (err) {
      app.debug(`Failed to send ${label} on channel ${channelIdx}: ${err.message}`);
    }
  }

  function scheduleReconnect(options) {
    if (stopped || reconnectTimer) return;
    const delayMs = (options.reconnectDelaySeconds || 10) * 1000;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectToMeshCore(options);
    }, delayMs);
  }

  // ---------------------------------------------------------------------
  // Share this vessel's own position with the MeshCore device
  // ---------------------------------------------------------------------
  let ownPositionTimer = null;

  function startOwnPositionSharing(options) {
    if (!options.shareOwnPosition) return;
    stopOwnPositionSharing();

    const intervalMs = Math.max(1, options.shareOwnPositionIntervalMinutes || 15) * 60 * 1000;
    const pushOwnPosition = async () => {
      if (!connection) return;
      const position = app.getSelfPath("navigation.position");
      const value = position && position.value;
      if (!value || typeof value.latitude !== "number" || typeof value.longitude !== "number") {
        app.debug("No own navigation.position available yet, skipping MeshCore position share");
        return;
      }
      try {
        await connection.setAdvertLatLong(value.latitude, value.longitude);
        app.debug(`Shared own position with MeshCore device: ${value.latitude}, ${value.longitude}`);
      } catch (err) {
        app.debug(`Failed to share own position with MeshCore device: ${err.message}`);
      }

      if (options.sendOwnTelToMesh) {
        const batteryPath = app.getSelfPath("electrical.batteries.house.voltage");
        const batteryVolts = batteryPath && typeof batteryPath.value === "number" ? batteryPath.value : null;

        const telText = encodeTEL({
          latitude: value.latitude,
          longitude: value.longitude,
          batteryMv: batteryVolts !== null ? Math.round(batteryVolts * 1000) : null,
          phoneBattery: null,
          forwardStatus: 0
        });

        await sendOnChannelSafely(options.ownTelChannelIndex, telText, "own #TEL: telemetry");
      }
    };

    ownPositionTimer = setInterval(pushOwnPosition, intervalMs);
    pushOwnPosition();
  }

  function stopOwnPositionSharing() {
    if (ownPositionTimer) {
      clearInterval(ownPositionTimer);
      ownPositionTimer = null;
    }
  }

  // ---------------------------------------------------------------------
  // Relay SignalK alerts to the mesh as text messages
  // ---------------------------------------------------------------------
  let alertUnsubscribe = null;
  const SEVERITY_RANK = { nominal: 0, normal: 0, alert: 1, warn: 2, alarm: 3, emergency: 4 };

  function startAlertRelay(options) {
    if (!options.relayAlertsToMesh) return;
    stopAlertRelay();

    const minRank = SEVERITY_RANK[options.alertMinSeverity || "alarm"] || 3;
    const channelIdx = typeof options.alertChannelIndex === "number" ? options.alertChannelIndex : 0;
    const lastSentState = new Map();

    const handleDelta = (delta) => {
      if (!connection || !delta.updates) return;
      for (const update of delta.updates) {
        for (const value of update.values || []) {
          if (!value.path || !value.path.startsWith("notifications.")) continue;
          const notification = value.value;
          if (!notification || !notification.state) continue;

          const rank = SEVERITY_RANK[notification.state] || 0;
          if (rank < minRank) continue;

          const key = value.path;
          if (lastSentState.get(key) === notification.state) continue; // already sent this state
          lastSentState.set(key, notification.state);

          const text = `[${notification.state.toUpperCase()}] ${value.path.replace("notifications.", "")}: ${notification.message || ""}`.trim();
          sendOnChannelSafely(channelIdx, text.substring(0, 160), "alert");
        }
      }
    };

    app.signalk.on("delta", handleDelta);
    alertUnsubscribe = () => app.signalk.removeListener("delta", handleDelta);
  }

  function stopAlertRelay() {
    if (alertUnsubscribe) {
      alertUnsubscribe();
      alertUnsubscribe = null;
    }
  }

  // ---------------------------------------------------------------------
  // SignalK plugin lifecycle
  // ---------------------------------------------------------------------
  plugin.start = function (options) {
    stopped = false;
    pluginOptions = options || {};
    if (pluginOptions.persistNodes !== false) {
      loadNodeDb();
    }
    connectToMeshCore(options).catch((err) => {
      app.error(`MeshCore plugin failed to start: ${err.message}`);
    });
  };

  plugin.stop = function () {
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    stopOwnPositionSharing();
    stopAlertRelay();
    if (connection) {
      try {
        connection.close();
      } catch (err) {
        // ignore
      }
      connection = null;
    }
    app.setPluginStatus("Stopped");
  };

  return plugin;
};
