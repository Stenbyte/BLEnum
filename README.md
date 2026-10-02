# BLEnum — Unseen Frequencies

Render invisible Bluetooth Low Energy (BLE) advertising signatures as visible paint-by-numbers art in the browser.

Nearby phones and wearables emit BLE packets. This project maps those signals onto a canvas: signal strength, crowd density, and device identity become color, warmth, and which numbered regions fill in. A blank outlined canvas becomes a collaborative painting as people move through a space.

## Goals

1. **Dynamic palette (“vibe” map)** — live BLE-derived parameters drive color, not static paint codes.
2. **Live revealed canvas** — numbered outlines fill as devices appear and move.
3. **Collaborative painting** — a crowd paints by walking through the room with Bluetooth on.

### Signal → visual mapping

| Input | Visual |
|--------|--------|
| RSSI (signal strength) | Saturation / contrast |
| Device count | Warmth (quiet → cool blues, crowded → warm reds) |
| Device name / manufacturer ID | Paint number / shade in the palette |
| Stable device identity | Which numbered region fills |

## Roadmap

### Step 1 — Localhost + fake signals *(current)*

Browser-only experiment. No real BLE yet.

- [x] Vite + TypeScript canvas app
- [x] Paint-by-numbers regions (outlined, numbered, blank at start)
- [x] Shared `BleSighting` signal shape
- [x] Fake signal source (spawn devices, walk RSSI, enter/leave)
- [x] Vibe map (count → warmth, RSSI → saturation, id → paint hue)
- [x] Region painter (device presence fills regions)
- [x] Dev controls (crowd size, RSSI noise, walk-past)

### Step 2 — Real BLE (Chrome experimental)

Same canvas and vibe map. Swap fake source for Web Bluetooth Scanning.

- [ ] `navigator.bluetooth.requestLEScan()` behind the same signal interface
- [ ] Enable `chrome://flags/#enable-experimental-web-platform-features`
- [ ] User-gesture start/stop scan
- [ ] Soft identity from name / manufacturer / service UUIDs (MAC often opaque)
- [ ] Fallback path: native BLE bridge → WebSocket if browser scan is too flaky for install

### Later (optional)

- [ ] PixiJS for heavier 2D effects, or Three.js for projected 3D stage
- [ ] Physical install: wall projection, blank → filled live reveal
- [ ] License + public docs polish

## Architecture

```
SignalSource  →  VibeMap  →  RegionPainter  →  Canvas
  fake | ble      colors      fill regions
```

Art code never cares which source produces sightings.

```ts
type BleSighting = {
  id: string;
  name?: string;
  manufacturerId?: number;
  rssi: number;
  seenAt: number;
};
```

## Stack (Step 1)

- Vite
- TypeScript
- Canvas 2D (no art library yet — add Pixi/Three later if needed)

## Run

```bash
npm install
npm run dev
```
