# BLEnum — Unseen Frequencies

Render invisible Bluetooth Low Energy (BLE) advertising signatures as visible paint-by-numbers art in the browser.

Nearby phones and wearables emit BLE packets. Those signals unlock regions of an image: the art starts as black-and-white numbered outlines, then fills with its real palette colors as devices appear. A crowd collaboratively reveals the picture just by moving through the space.

## Reveal model

Colors come from the **artwork palette** (later: parsed from an uploaded SVG). The app does not invent random hues per device.

1. Load art with regions that already have paint numbers + base colors.
2. Display **B&W / outlines + numbers** only.
3. Each live device unlocks **multiple regions** (hash → paint bucket / region set).
4. Unlocked regions animate toward their **true palette colors**.
5. **RSSI** (plus shimmer/noise) makes fills vivid and “breathing.”
6. **Crowd warmth** is a global cool→warm grade on top — mood, not identity overwrite.
7. Overlap = shared strength on the same region; no recolor fights. Sticky once claimed.

### Signal → visual mapping

| Input | Visual |
|--------|--------|
| Device identity (name / manufacturer / id) | Which paint numbers / region set unlock |
| RSSI + shimmer | Fill strength, saturation, living breath |
| Device count (capped) | Global warmth grade (quiet → cool, crowded → warm) |
| Artwork palette | Actual fill colors for each numbered block |

**Device cap (Step 1):** about 12 live devices, matched to the experiment layout. Raise later when SVG region count grows (often 10–20 for an install).

## Roadmap

### Step 1 — Localhost + fake signals *(current)*

Browser-only experiment. No real BLE yet. Fake “SVG palette” on abstract regions.

- [x] Vite + TypeScript canvas app
- [x] Shared `BleSighting` signal shape
- [x] Fake signal source (crowd, RSSI shimmer, walk-past)
- [x] Fixed per-region palette colors (stand-in for SVG paints)
- [x] Start blank: B&W outlines + numbers
- [x] One device unlocks multiple regions via hash
- [x] Fill toward palette color; RSSI shimmer = breath
- [x] Warmth as global grade; device cap ~12
- [x] Dev controls (crowd size, RSSI shimmer, walk-past, reset)

### Step 2 — Real BLE (Chrome experimental)

Same reveal pipeline. Swap fake source for Web Bluetooth Scanning.

- [ ] `navigator.bluetooth.requestLEScan()` behind the same signal interface
- [ ] Enable `chrome://flags/#enable-experimental-web-platform-features`
- [ ] User-gesture start/stop scan
- [ ] Soft identity from name / manufacturer / service UUIDs (MAC often opaque)
- [ ] Fallback path: native BLE bridge → WebSocket if browser scan is too flaky for install

### Later (optional)

- [ ] Real SVG upload/parse (`data-paint` / fills → region map + palette)
- [ ] PixiJS for heavier 2D effects, or Three.js for projected 3D stage
- [ ] Physical install: wall projection, blank → filled live reveal
- [ ] License + public docs polish

## Architecture

```
SignalSource  →  ClaimMap  →  VibeMod  →  RegionPainter  →  Canvas
  fake | ble     which paints   warmth/     B&W → palette
                 unlock         RSSI breath
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

Open the local URL Vite prints (usually `http://localhost:5173`).

## License

TBD (MIT likely if the repo goes public).
