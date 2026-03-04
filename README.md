# SmartEmergency Server (Realtime + History + Per-device Thresholds + Alarm Events)

## What this does
- ESP8266 sends sensor readings via HTTP POST JSON.
- Server stores readings in MySQL.
- Server computes alarm state based on per-device thresholds (gas/temp/flame/humidity range).
- Server creates alarm events with start/end/duration + triggers + peak values.
- Web dashboard shows:
  - Realtime device cards + online/offline
  - Realtime chart
  - History chart (load range)
  - Readings history table
  - Alarm history table
  - Threshold editing per device

## Prerequisites
- Node.js 18+ (works with Node 20/22/24)
- MySQL 8+

## Setup (Windows PowerShell)
1) Install dependencies:
   npm install

2) Create MySQL user (recommended) and database:
   - Run `db/schema.sql` in MySQL (or copy/paste into your MySQL client).

3) Configure environment:
   - Copy `.env.example` to `.env`
   - Set DB_USER / DB_PASS / IOT_API_KEY

4) Start server:
   npm start

Open:
- http://localhost:3000
- http://localhost:3000/health

## ESP
- Use the sketch at: `esp/ESP8266_FULL.ino`
- Change:
  - `serverBase` to your server IP (e.g. http://192.168.1.10:3000)
  - `apiKey` to match IOT_API_KEY in `.env`
  - `deviceLabel` per device (room1/room2/...)

## API endpoints
- POST /api/ingest (ESP -> server)
- GET  /api/device-config/:uid?label=room1  (ESP pulls thresholds)
- GET  /api/devices
- GET  /api/devices/:uid/latest
- GET  /api/devices/:uid/history?limit=500&from=YYYY-MM-DD HH:MM:SS&to=...
- GET  /api/devices/:uid/thresholds
- PUT  /api/devices/:uid/thresholds
- GET  /api/devices/:uid/alarms
- GET  /api/devices/:uid/alarms/active
- GET  /api/alarms (all devices)

## Notes
- Online/offline: based on `devices.last_seen` compared to `DEVICE_ONLINE_SECONDS`.
- CSP: Helmet is enabled but allows jsdelivr CDN for Bootstrap + Chart.js.
