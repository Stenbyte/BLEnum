# BLEnum — Unseen Frequencies

Render invisible Bluetooth Low Energy (BLE) advertising signatures as visible paint-by-numbers art in the browser.

Load your artwork → grayscale → devices unlock colors (fake, local bridge, or experimental Chrome scan).

## Signal sources

| Mode | What |
|------|------|
| **Fake** | Simulated crowd (no Bluetooth) |
| **Bridge** | Local Python/bleak helper scans BLE → WebSocket → app (**reliable Live**) |
| **Chrome** | Experimental `requestLEScan` (often broken on Mac) |

### Bridge (recommended for real devices)

```bash
# terminal 1 — website
npm install
npm run dev

# terminal 2 — BLE helper (Python/bleak)
npm run bridge:install   # once
npm run bridge
```

In the UI: **Bridge** → **Connect** (`ws://127.0.0.1:8787`).

macOS: System Settings → Privacy & Security → Bluetooth → allow **Terminal**.

Details: [`bridge/README.md`](bridge/README.md).

### Chrome scan (optional)

Needs `chrome://flags/#enable-experimental-web-platform-features`. Prefer Bridge if Allow keeps failing.

## Reveal model

1. Load SVG / JPG / PNG  
2. Gray base + paint buckets  
3. Only **near** devices unlock color (default RSSI ≥ **−65 dBm**)  
4. Closer → stronger breath / faster reveal; walk away → fade  
5. Near crowd size = warmth (tune threshold in UI → Proximity)  


## Run (art only)

```bash
npm install
npm run dev
```

## License

TBD
