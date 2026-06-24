# signalk-meshcore

[![npm](https://img.shields.io/npm/v/signalk-meshcore)](https://www.npmjs.com/package/signalk-meshcore)
[![license](https://img.shields.io/badge/license-GPL--3.0-blue)](./LICENSE)

A [SignalK Node Server](https://github.com/SignalK/signalk-server) plugin that integrates [MeshCore](https://meshcore.dev/) LoRa mesh radio devices as AIS-style vessel targets — so crew nodes, tenders, and shore stations appear on your chart plotter / freeboard-sk with position, tracks, and battery data, exactly like AIS targets.

Connects to a MeshCore companion radio over **TCP/WiFi** or **USB serial**, using the official [`@liamcottle/meshcore.js`](https://www.npmjs.com/package/@liamcottle/meshcore.js) library.

Development of this plugin was aided by AI-assisted coding tools.

> **See also:** [`@meri-imperiumi/signalk-meshtastic`](https://github.com/meri-imperiumi/signalk-meshtastic) — the equivalent plugin for [Meshtastic](https://meshtastic.org/) LoRa devices. This plugin follows the same design principles and SignalK data model, making MeshCore and Meshtastic targets interoperable on the same chart.

---

## Features

- **TCP/WiFi and USB serial** connection support, switchable in settings
- **`#TEL:` telemetry decoding** — 11-byte base64 payload → lat/lon, battery voltage, phone battery %, forward status
- **Full AIS-compatible vessel metadata** for each node — `name`, `mmsi`, `design.aisShipType`, `communication.callsignVhf`, `navigation.position` — so freeboard-sk renders them with the correct icon and popup details
- **Channel filtering** — listen on all channels or a chosen set. Channel 0 ("public") is hard-blocked for sending, always
- **Persistent node database** — last-known name/position/battery/timestamp survives SignalK restarts
- **Vessel type selection** — choose the AIS type code (and therefore freeboard-sk icon) for all MeshCore nodes (default: 37 Pleasure Craft)
- **Share own position** — periodically pushes this vessel's SignalK GNSS position to the MeshCore device's advertised location, so crew ashore can see the boat
- **Broadcast own `#TEL:` telemetry** — encodes this vessel's position/battery as a `#TEL:` message and sends it on a configured channel, so other MeshCore boats running this plugin (or any `#TEL:`-aware node) can see it
- **Relay SignalK alerts to the mesh** — sends a text message on a configured channel when a notification hits your chosen severity threshold (alarm, emergency, etc.)
- **Associate nodes with existing AIS vessels** — `DE <callsign>` name convention merges a node's data onto a matching vessel already in SignalK
- **Auto-reconnect** on connection drop, configurable delay
- **Diagnostic frame logging** — every incoming frame decoded as readable text in debug output

---

## Requirements

- SignalK Node Server
- A MeshCore device running **Companion Radio firmware** (WiFi/TCP or USB serial variant)
- For MeshCore TEAM autonomous tracking, a companion radio running **custom MeshCore firmware** with GPS support. See the [MeshCore TEAM GitHub repository](https://github.com/tmacinc/MeshCore-TEAM) and [MeshCore firmware repository](https://github.com/tmacinc/MeshCore).
- Node.js 18+

---

## Install

### Via SignalK App Store (recommended)

1. Open your SignalK server admin UI.
2. Go to **App Store** → search for **MeshCore Telemetry**.
3. Install and restart.

### Manual install

```bash
cd ~/.signalk
npm install signalk-meshcore --save
# then restart SignalK
sudo systemctl restart signalk
```

---

## Configuration

Go to **Server → Plugin Config → MeshCore Telemetry** after installing.

### Connection

| Setting | Description | Default |
|---|---|---|
| Connection type | TCP/WiFi or USB Serial | TCP/WiFi |
| IP address | IP of the MeshCore device (TCP only) | 192.168.1.50 |
| Port | TCP port (TCP only) | 5000 |
| Serial port path | e.g. `/dev/ttyUSB0`, `/dev/ttyACM0` (USB only) | /dev/ttyUSB0 |
| Reconnect delay | Seconds before retrying after a drop | 10 |

> **USB serial note:** on Linux you may need to add the SignalK user to the `dialout` group:
> `sudo usermod -a -G dialout signalk`

### Receiving telemetry

| Setting | Description | Default |
|---|---|---|
| Listen on all channels | Receive `#TEL:` from every channel | On |
| Channel indexes | Comma-separated list of channels to listen on, e.g. `1,2` (when all-channels is off) | 0 |
| Vessel type | AIS ship type for MeshCore nodes. Controls the freeboard-sk icon. 37 = Pleasure Craft, 36 = Sailing Vessel, 51 = SAR, 52 = Tug, 90 = Other | 37 |
| Persistent node database | Save last-known data for all nodes to disk | On |

### Sending telemetry

| Setting | Description | Default |
|---|---|---|
| Share own position with mesh | Push this vessel's GNSS position to the MeshCore device's advertised location | Off |
| Broadcast own `#TEL:` to mesh | Encode this vessel's position/battery as a `#TEL:` message and transmit it on the telemetry channel | Off |
| Telemetry channel index | Channel to broadcast own `#TEL:` on. Never channel 0. | 1 |
| Position share interval | How often to update (minutes) | 15 |

### Alerts

| Setting | Description | Default |
|---|---|---|
| Relay SignalK alerts to mesh | Send text messages on MeshCore when notifications fire | Off |
| Alert channel index | Channel to send alert messages on. Never channel 0. | 1 |
| Minimum severity | alert / warn / alarm / emergency | alarm |

### Advanced

| Setting | Description | Default |
|---|---|---|
| Associate nodes with AIS vessels | Match `DE <callsign>` node names to existing SignalK vessels | Off |
| Capture location adverts from non-Team nodes | Opt-in. Also listen for MeshCore node advertisements and capture location when lat/lon are present. Repeater adverts are ignored. | Off |

---

## How it works

Each MeshCore node that sends a `#TEL:` message gets its own SignalK vessel context:

```
vessels.urn:mrn:signalk:uuid:meshcore-<pubkey-prefix-hex>
```

The plugin publishes these SignalK paths for each node:

| Path | Value |
|---|---|
| `navigation.position` | lat/lon from TEL payload |
| `name` | Node's advertised name |
| `communication.callsignVhf` | Node's advertised name (doubles as callsign in freeboard-sk popup) |
| `mmsi` | Synthetic 9-digit id (prefix `99`) — not a real MMSI |
| `design.aisShipType` | `{ id, name }` — drives freeboard-sk icon |
| `electrical.batteries.meshcore.voltage` | Battery voltage in volts |
| `sensors.meshcore.phoneBattery` | Phone/companion app battery % |
| `sensors.meshcore.forwardStatus` | Forward status byte from TEL payload |

SignalK stores position history per vessel context automatically, so tracks appear in freeboard-sk with no extra configuration — the same way real AIS targets do.

### MeshCore TEAM autonomous mode

MeshCore TEAM's autonomous mode moves location tracking onto the companion radio itself. With custom firmware and a valid GPS fix, the radio keeps broadcasting telemetry even if the phone app is disconnected or out of range. The MeshCore TEAM app is available at [tmacinc/MeshCore-TEAM](https://github.com/tmacinc/MeshCore-TEAM).

For this plugin, that means the radio's `#TEL:` messages are the source of truth: it listens for those packets on the mesh, decodes the location/battery fields, and publishes them into SignalK as vessel targets with tracks.

### `#TEL:` payload format

The 11-byte binary payload, base64-encoded after `#TEL:`:

| Bytes | Field |
|---|---|
| 0–3 | Latitude as Int32BE × 10,000,000 |
| 4–7 | Longitude as Int32BE × 10,000,000 |
| 8 | Battery encoding: `mV = ((byte − 2) × 6) + 2750` |
| 9 | Phone/app battery % |
| 10 | Forward status |

---

## Relation to signalk-meshtastic

[`@meri-imperiumi/signalk-meshtastic`](https://github.com/meri-imperiumi/signalk-meshtastic) provides the same SignalK integration for [Meshtastic](https://meshtastic.org/) devices. This plugin follows the same data model and design principles, so MeshCore and Meshtastic nodes can coexist on the same SignalK server and appear together on freeboard-sk without conflict. Features like vessel association (`DE <callsign>`), persistent node database, own-position sharing, and alert relay are directly inspired by signalk-meshtastic.

---

## License

GPL-3.0 — see [LICENSE](./LICENSE) (GNU General Public License v3)
