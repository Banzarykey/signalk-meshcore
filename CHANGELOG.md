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
