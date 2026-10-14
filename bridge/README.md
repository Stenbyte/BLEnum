# BLEnum BLE bridge

Local helper: scan BLE, push devices to the browser over WebSocket.

```
phones / watches (BLE ads)
        ↓
  bridge (Python / bleak)
        ↓  ws://127.0.0.1:8787
  BLEnum web app → Bridge → Connect
```

## Run

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

## Requirements

- Bluetooth on
- macOS: System Settings → Privacy & Security → Bluetooth → allow **Terminal** (or iTerm)
- Python 3.10+
- `pip` with `--uploaded-prior-to` (install script upgrades pip if needed)

`npm run bridge:install` / auto-install in `start.sh` read root `.npmrc` `min-release-age` (days) and pass the same window to pip as `--uploaded-prior-to P{N}D`.

## Env (optional)

| Variable | Default |
|----------|---------|
| `BLENUM_BRIDGE_PORT` | `8787` |
| `BLENUM_BRIDGE_HOST` | `127.0.0.1` |
| `BLENUM_DEVICE_CAP` | `20` |
| `BLENUM_STALE_MS` | `6000` |
