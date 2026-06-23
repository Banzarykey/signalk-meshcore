## v0.0.3 - 2026-06-23

### 🧹 Chores
- update CHANGELOG.md for v0.0.3 (a2d5dc1)
- update CHANGELOG.md for v0.0.2 (9f65edd)

### 📦 Other
- change node version (055bdaa)


## v0.0.3 - 2026-06-23

### 🧹 Chores
- update CHANGELOG.md for v0.0.2 (9f65edd)


## v0.0.2 - 2026-06-23

### 🧹 Chores
- update CHANGELOG.md for v0.0.1 (7430dca)

### 📦 Other
- change node version (2af02c3)


## v0.0.1 - 2026-06-23

### 🧹 Chores
- update CHANGELOG.md for v0.0.1 (4b7ef85)

### 📦 Other
- change node version (2f93031)
- Add release workflow for GitHub and npm (496bf5e)
- Add package-lock.json (dea61b5)
- remove lock (c39ed00)
- Upgrade Node.js version from 20 to 24 (c7bdd7e)
- update node version (bba3f22)
- change package name (b9f3119)
- Use npm ci with lockfile in release workflow (f40bdb1)
- Fix npm publish workflow build job commands (0a66ae3)
- Initial plan (fb501e3)
- Add npm publish workflow for Node.js package (c662ee6)
- Initial commit (f94e19b)


## v0.0.1 - 2026-06-23

### 📦 Other
- Add release workflow for GitHub and npm (496bf5e)
- Add package-lock.json (dea61b5)
- remove lock (c39ed00)
- Upgrade Node.js version from 20 to 24 (c7bdd7e)
- update node version (bba3f22)
- change package name (b9f3119)
- Use npm ci with lockfile in release workflow (f40bdb1)
- Fix npm publish workflow build job commands (0a66ae3)
- Initial plan (fb501e3)
- Add npm publish workflow for Node.js package (c662ee6)
- Initial commit (f94e19b)


# Changelog

All notable changes to `signalk-meshcore` will be documented here.

## [0.0.1] — 2026

### Initial release

- TCP/WiFi and USB serial connection support via `@liamcottle/meshcore.js`
- Decodes `#TEL:` base64 telemetry payloads (lat/lon, battery voltage, phone battery, forward status)
- Publishes each MeshCore node as a SignalK vessel with full AIS-compatible metadata:
  - `navigation.position`, `name`, `mmsi`, `design.aisShipType`, `communication.callsignVhf`
  - Deterministic 9-digit synthetic MMSI (prefix `99`) for freeboard-sk compatibility
- Vessel type configurable (defaults to 37 — Pleasure Craft)
- Channel filtering — listen on all channels or a specific set; channel 0 ("public") is hard-blocked for sending
- Persistent node database (`meshcore-nodes.json`) survives server restarts
- Contact name/identity resolution — channel messages reuse contact-list identity to prevent duplicate vessels
- Associate MeshCore nodes with existing AIS vessels by `DE <callsign>` name convention
- Share own vessel position with the MeshCore device via `setAdvertLatLong`
- Broadcast own `#TEL:` telemetry on a configured channel (non-public)
- Relay SignalK alerts/notifications to the mesh as text messages
- Raw frame decode logging for diagnostics
- Auto-reconnect on disconnect
- Inspired by [`@meri-imperiumi/signalk-meshtastic`](https://github.com/meri-imperiumi/signalk-meshtastic) — the Meshtastic equivalent plugin
