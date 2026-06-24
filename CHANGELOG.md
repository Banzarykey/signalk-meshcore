## v0.0.18 - 2026-06-24

### 📦 Other
- 0.0.18 (0d11010)
- fixed names for freeboard (5a32122)


## v0.0.17 - 2026-06-24

### 📦 Other
- 0.0.17 (478fcb5)
- fixed names for freeboard (ec4fa84)


## v0.0.16 - 2026-06-24

### 📦 Other
- 0.0.16 (d459aa0)
- fixed paths for position (8a03092)


## v0.0.15 - 2026-06-24

### 📦 Other
- 0.0.15 (8199ad5)
- fixed channel telemetry names (a567137)


## v0.0.14 - 2026-06-24

### 📦 Other
- 0.0.14 (7312536)
- fixed channel telemetry names (abad3a8)


## v0.0.13 - 2026-06-24

### 📦 Other
- 0.0.13 (e5e29b8)
- 0.0.12 (5c5ef84)


## v0.0.12 - 2026-06-24

### 📦 Other
- Add NODE_AUTH_TOKEN to npm publish step (73e72b4)


## v0.0.11 - 2026-06-24

### 📦 Other
- 0.0.11 (96d3a27)
- Update release.yml (f894ec4)


## v0.0.8 - 2026-06-24

### 🧹 Chores
- update CHANGELOG.md for v0.0.8 (6603f2c)

### 📦 Other
- Add NODE_AUTH_TOKEN to npm publish step (ec3d34d)
- 0.0.8 (12e0b65)
- fixed filtering error in packets (b009de8)


## v0.0.8 - 2026-06-24

### 📦 Other
- Add NODE_AUTH_TOKEN to npm publish step (ec3d34d)


## v0.0.6 - 2026-06-24

### 🐛 Fixes
- remove rebase from release changelog commit (fd9aacc)

### 🧹 Chores
- update CHANGELOG.md for v0.0.6 (ccbc8bb)

### 📦 Other
- 0.0.6 (a02a4fa)
- add option to listen to location adverts (3d8e331)
- patch worker (0eb9e5d)


## v0.0.6 - 2026-06-24


## v0.0.3 - 2026-06-23

### 🧹 Chores
- update CHANGELOG.md for v0.0.3 (abb9827)
- update CHANGELOG.md for v0.0.3 (a2d5dc1)
- update CHANGELOG.md for v0.0.2 (9f65edd)

### 📦 Other
- change node version (055bdaa)


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
