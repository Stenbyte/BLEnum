# BLEnum — Unseen Frequencies

Render invisible Bluetooth Low Energy (BLE) advertising signatures as visible paint-by-numbers art in the browser.

Load your artwork → it starts **grayscale** → live devices unlock colors.

## Reveal model

1. Load **SVG** (vector fills or embedded photo), **JPG**, or **PNG**.
2. Gray base + paint buckets from colors / fills.
3. Devices unlock paint buckets → color areas reveal.
4. RSSI shimmer = breath. Crowd warmth = global mood.

## Roadmap

### Step 1 — Localhost + fake signals + art load *(current)*

- [x] Fake BLE + vibe / breath
- [x] Image / SVG load + grayscale reveal
- [x] Upload SVG / JPG / PNG

### Step 2 — Real BLE

- [ ] `requestLEScan` + Fake/BLE toggle

## Run

```bash
npm install
npm run dev
```

Load an artwork from the panel — nothing is bundled by default.

## License

TBD
