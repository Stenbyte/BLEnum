import './style.css'
import { createFakeSignalSource } from './signals/fake'
import type { BleSighting } from './signals/types'
import { computeVibe, hslToCss } from './vibe/map'
import {
  assignPaintsToDevices,
  DEVICE_CAP,
  deviceKey,
  listPaintNumbers,
  type Artwork,
} from './art/regions'
import {
  createEmptyPaint,
  deviceSwatch,
  drawArtwork,
  updatePaint,
  type PaintState,
} from './art/painter'
import { loadRasterFromFile } from './art/raster/parse'
import { loadSvgFromFile } from './art/svg/parse'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('#app missing')

app.innerHTML = `
  <header class="top">
    <div class="brand">
      <h1>BLEnum</h1>
      <p>Unseen Frequencies — your image, colors removed, revealed by fake BLE.</p>
    </div>
    <div class="stats">
      <div><span>Devices</span><strong id="stat-count">0</strong> / ${DEVICE_CAP}</div>
      <div><span>Warmth</span><strong id="stat-warmth">0%</strong></div>
      <div><span>Avg RSSI</span><strong id="stat-rssi">—</strong></div>
    </div>
  </header>
  <div class="stage">
    <div class="canvas-wrap">
      <canvas id="paint" width="1000" height="700" aria-label="Paint by numbers canvas"></canvas>
      <p class="status-banner" id="status" hidden></p>
    </div>
    <aside class="panel">
      <h2>Artwork</h2>
      <p class="art-name" id="art-name">No artwork loaded</p>
      <div class="actions">
        <label class="file-btn">
          Load image
          <input id="art-file" type="file" accept=".svg,.jpg,.jpeg,.png,image/*" hidden />
        </label>
      </div>
      <p class="hint">
        Load SVG / JPG / PNG. Gray start; devices unlock color regions.
      </p>

      <h2>Fake signals</h2>
      <div class="control">
        <label>Crowd size <strong id="crowd-val">0</strong></label>
        <input id="crowd" type="range" min="0" max="${DEVICE_CAP}" value="0" />
      </div>
      <div class="control">
        <label>RSSI shimmer <strong id="noise-val">25</strong></label>
        <input id="noise" type="range" min="0" max="25" step="0.5" value="25" />
      </div>
      <div class="actions">
        <button type="button" id="walk">Walk past</button>
        <button type="button" class="secondary" id="reset">Reset paint</button>
      </div>
      <p class="hint">
        Devices unlock paint numbers from colors found in the image.
      </p>
      <h2>Palette</h2>
      <ul class="device-list" id="palette"></ul>
      <h2>Live devices</h2>
      <ul class="device-list" id="devices"></ul>
    </aside>
  </div>
`

const canvas = document.querySelector<HTMLCanvasElement>('#paint')!
const ctx = canvas.getContext('2d')!
const statusEl = document.querySelector<HTMLParagraphElement>('#status')!
const artNameEl = document.querySelector('#art-name')!
const paletteEl = document.querySelector('#palette')!
const devicesEl = document.querySelector('#devices')!
const crowdInput = document.querySelector<HTMLInputElement>('#crowd')!
const noiseInput = document.querySelector<HTMLInputElement>('#noise')!
const crowdVal = document.querySelector('#crowd-val')!
const noiseVal = document.querySelector('#noise-val')!
const statCount = document.querySelector('#stat-count')!
const statWarmth = document.querySelector('#stat-warmth')!
const statRssi = document.querySelector('#stat-rssi')!
const fileInput = document.querySelector<HTMLInputElement>('#art-file')!

let artwork: Artwork | null = null
let paint: PaintState = createEmptyPaint([])
let sightings: BleSighting[] = []
let lastTs = performance.now()

const source = createFakeSignalSource({
  crowdSize: 0,
  rssiNoise: 25,
  deviceCap: DEVICE_CAP,
})

function showStatus(message: string, kind: 'error' | 'warn' | 'ok' = 'ok') {
  if (!message) {
    statusEl.hidden = true
    statusEl.textContent = ''
    statusEl.dataset.kind = ''
    return
  }
  statusEl.hidden = false
  statusEl.textContent = message
  statusEl.dataset.kind = kind
}

function applyArtwork(next: Artwork) {
  artwork = next
  paint = createEmptyPaint(next.regions)
  artNameEl.textContent = `${next.name} · ${listPaintNumbers(next.regions).length} paints · ${next.mode}`
  renderPalette()
  if (next.warnings.length) {
    showStatus(next.warnings.join(' · '), 'warn')
  } else {
    showStatus('')
  }
  resizeCanvas()
}

function renderPalette() {
  if (!artwork) {
    paletteEl.innerHTML = ''
    return
  }
  const paints = listPaintNumbers(artwork.regions)
  paletteEl.innerHTML = paints
    .map((n) => {
      const sample = artwork!.regions.find((r) => r.paintNumber === n)!
      const css = hslToCss(sample.baseColor)
      return `<li>
        <i class="swatch" style="background:${css}"></i>
        <span>Paint ${n}</span>
        <span></span>
      </li>`
    })
    .join('')
}

crowdInput.addEventListener('input', () => {
  const n = Number(crowdInput.value)
  crowdVal.textContent = String(n)
  source.setCrowdSize(n)
})

noiseInput.addEventListener('input', () => {
  const n = Number(noiseInput.value)
  noiseVal.textContent = String(n)
  source.setRssiNoise(n)
})

document.querySelector('#walk')!.addEventListener('click', () => source.walkPast())
document.querySelector('#reset')!.addEventListener('click', () => {
  if (artwork) paint = createEmptyPaint(artwork.regions)
})
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0]
  fileInput.value = ''
  if (!file) return

  const lower = file.name.toLowerCase()
  const looksRasterSvg =
    lower.endsWith('.svg') || file.type === 'image/svg+xml'

  // Prefer raster path (photo / SVG-with-embedded-jpeg). Fall back to vector SVG.
  let result = await loadRasterFromFile(file)
  if (!result.ok && looksRasterSvg) {
    const vector = await loadSvgFromFile(file)
    if (vector.ok) {
      applyArtwork(vector.artwork)
      return
    }
    showStatus([...result.errors, ...vector.errors].join(' · '), 'error')
    return
  }
  if (!result.ok) {
    showStatus(result.errors.join(' · '), 'error')
    return
  }
  applyArtwork(result.artwork)
})

source.subscribe((next) => {
  sightings = next
})
source.start()

function resizeCanvas() {
  const wrap = canvas.parentElement!
  const w = Math.max(1, wrap.clientWidth)
  const h = Math.max(1, wrap.clientHeight)
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  canvas.style.width = '100%'
  canvas.style.height = '100%'
}

resizeCanvas()
window.addEventListener('resize', resizeCanvas)

function renderDeviceList(vibe = computeVibe(sightings, DEVICE_CAP)) {
  if (!artwork) {
    devicesEl.innerHTML = ''
    return
  }
  const paintNumbers = listPaintNumbers(artwork.regions)
  const keys = sightings.map((s) => deviceKey(s.id, s.manufacturerId))
  const assigned = assignPaintsToDevices(keys, paintNumbers)
  devicesEl.innerHTML = sightings
    .slice()
    .sort((a, b) => b.rssi - a.rssi)
    .map((s) => {
      const swatch = deviceSwatch(artwork!.regions, s, vibe, sightings)
      const paints = assigned.get(deviceKey(s.id, s.manufacturerId)) ?? []
      const label =
        paints.length <= 4
          ? paints.join(', ')
          : `${paints.slice(0, 3).join(', ')}…+${paints.length - 3}`
      return `<li>
        <i class="swatch" style="background:${swatch}"></i>
        <span>${s.name ?? s.id} → ${label}</span>
        <span>${s.rssi.toFixed(0)} dBm</span>
      </li>`
    })
    .join('')
}

function frame(ts: number) {
  const dt = Math.min(0.05, (ts - lastTs) / 1000)
  lastTs = ts

  const vibe = computeVibe(sightings, DEVICE_CAP)
  if (artwork) {
    updatePaint(paint, artwork.regions, sightings, vibe, dt)
    drawArtwork(ctx, artwork, paint, vibe)
  }

  statCount.textContent = String(vibe.deviceCount)
  statWarmth.textContent = `${Math.round(vibe.warmth * 100)}%`
  statRssi.textContent =
    vibe.deviceCount === 0 ? '—' : `${vibe.averageRssi.toFixed(0)} dBm`

  renderDeviceList(vibe)
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
showStatus('Load an SVG or image to start', 'warn')
