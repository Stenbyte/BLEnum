# BLEnum BLE bridge

Local helper: scan BLE, push devices to the browser over WebSocket.

```
phones / watches (BLE ads)
        ↓
  bridge (this folder)
        ↓  ws://127.0.0.1:8787
  BLEnum web app → Bridge → Connect
```

## Run (recommended — Python / bleak)

Works well on modern macOS.

```bash
# from repo root
npm run bridge:install   # once
npm run bridge
```

Or:

```bash
cd bridge
chmod +x start.sh
./start.sh
```

Leave it running. In the app: **Bridge** → **Connect**.

## Optional — Node / noble

Native module; needs working `node-gyp` (Xcode CLT). Often painful on Node 22.

```bash
npm run bridge:node:install
npm run bridge:node
```

## Requirements

- Bluetooth on
- macOS: System Settings → Privacy & Security → Bluetooth → allow **Terminal** (or iTerm)
- Python 3.10+ for the default bridge

## Env (optional)

| Variable | Default |
|----------|---------|
| `BLENUM_BRIDGE_PORT` | `8787` |
| `BLENUM_BRIDGE_HOST` | `127.0.0.1` |
| `BLENUM_DEVICE_CAP` | `20` |
| `BLENUM_STALE_MS` | `6000` |
