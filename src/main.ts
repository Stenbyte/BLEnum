import './style.css'
import { createFakeSignalSource } from './signals/fake'
import {
  createBridgeSignalSource,
  DEFAULT_BRIDGE_URL,
} from './signals/bridge'
import type { BleSighting, SignalSource } from './signals/types'
import {
  computeVibe,
  DEFAULT_NEAR_RSSI,
  hslToCss,
  isNear,
} from './vibe/map'
import {
  assignPaintsToDevices,
  DEVICE_CAP,
  deviceKey,
  listPaintNumbers,
  type Artwork,
  type PaintShareMode,
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
import type { Stage } from './stages/types'
import { createFutureStage } from './stages/future'
import { isRevealComplete, minReveal } from './stages/unlock'

type SignalMode = 'fake' | 'bridge'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('#app missing')

app.innerHTML = `
  <header class="top">
    <div class="brand">
      <h1>BLEnum</h1>
      <p>Unseen Frequencies — grayscale art revealed by BLE.</p>
    </div>
    <div class="stats">
      <div><span>Seen</span><strong id="stat-count">0</strong> / ${DEVICE_CAP}</div>
      <div><span>Near</span><strong id="stat-near">0</strong></div>
      <div><span>Warmth</span><strong id="stat-warmth">0%</strong></div>
      <div><span>Near RSSI</span><strong id="stat-rssi">—</strong></div>
    </div>
  </header>
  <div class="stage">
    <div class="canvas-wrap" id="canvas-wrap" data-stage="reveal">
      <canvas id="paint" width="1000" height="700" aria-label="Paint by numbers canvas"></canvas>
      <div id="future-host" hidden></div>
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
      <p class="hint">Load SVG / JPG / PNG. White start; near devices reveal contours, then color.</p>

      <h2>Stage</h2>
      <p class="art-name" id="stage-label">reveal</p>
      <div class="actions">
        <button type="button" id="force-future">Force Future</button>
        <button type="button" class="secondary" id="back-reveal">Back to Reveal</button>
      </div>
      <p class="hint" id="stage-hint">Future unlocks when the palette is complete, or use Force Future.</p>

      <h2>Signal source</h2>
      <div class="actions mode-toggle" role="group" aria-label="Signal source">
        <button type="button" id="mode-fake" class="mode-btn is-active">Fake</button>
        <button type="button" id="mode-bridge" class="mode-btn secondary">Bridge</button>
      </div>
      <p class="hint" id="mode-hint">Fake: simulated crowd.</p>

      <h2>Proximity</h2>
      <div class="control">
        <label>Near threshold <strong id="near-val">${DEFAULT_NEAR_RSSI}</strong> dBm</label>
        <input id="near" type="range" min="-85" max="-45" step="1" value="${DEFAULT_NEAR_RSSI}" />
      </div>
      <p class="hint">
        Only devices at/above this RSSI unlock color. Right = must get closer.
        Default ${DEFAULT_NEAR_RSSI} dBm ≈ same table.
      </p>

      <h2>Paint share</h2>
      <div class="actions mode-toggle" role="group" aria-label="Paint share">
        <button type="button" id="share-cover" class="mode-btn is-active">Cover</button>
        <button type="button" id="share-crowd" class="mode-btn secondary">Crowd</button>
      </div>
      <p class="hint" id="share-hint">Cover: any near device unlocks the full palette.</p>

      <div id="fake-controls">
        <h2>Fake signals</h2>
        <div class="control">
          <label>Crowd size <strong id="crowd-val">0</strong></label>
          <input id="crowd" type="range" min="0" max="${DEVICE_CAP}" value="0" />
        </div>
        <div class="control">
          <label>RSSI shimmer <strong id="noise-val">8</strong></label>
          <input id="noise" type="range" min="0" max="25" step="0.5" value="8" />
        </div>
        <div class="actions">
          <button type="button" id="walk">Walk past</button>
          <button type="button" class="secondary" id="reset">Reset paint</button>
        </div>
      </div>

      <div id="bridge-controls" hidden>
        <h2>BLE bridge</h2>
        <p class="hint" id="bridge-hint">
          Run <code>npm run bridge</code> in a terminal, then Connect.
        </p>
        <p class="art-name" id="bridge-url">${DEFAULT_BRIDGE_URL}</p>
        <div class="actions">
          <button type="button" id="bridge-connect">Connect</button>
          <button type="button" class="secondary" id="bridge-disconnect">Disconnect</button>
          <button type="button" class="secondary" id="reset-bridge">Reset paint</button>
        </div>
      </div>

      <h2>Palette</h2>
      <ul class="device-list" id="palette"></ul>
      <h2>Live devices</h2>
      <ul class="device-list" id="devices"></ul>
    </aside>
  </div>
`

const canvasWrap = document.querySelector<HTMLElement>('#canvas-wrap')!
const canvas = document.querySelector<HTMLCanvasElement>('#paint')!
const futureHost = document.querySelector<HTMLElement>('#future-host')!
const ctx = canvas.getContext('2d')!
const statusEl = document.querySelector<HTMLParagraphElement>('#status')!
const artNameEl = document.querySelector('#art-name')!
const paletteEl = document.querySelector('#palette')!
const devicesEl = document.querySelector('#devices')!
const crowdInput = document.querySelector<HTMLInputElement>('#crowd')!
const noiseInput = document.querySelector<HTMLInputElement>('#noise')!
const nearInput = document.querySelector<HTMLInputElement>('#near')!
const crowdVal = document.querySelector('#crowd-val')!
const noiseVal = document.querySelector('#noise-val')!
const nearVal = document.querySelector('#near-val')!
const statCount = document.querySelector('#stat-count')!
const statNear = document.querySelector('#stat-near')!
const statWarmth = document.querySelector('#stat-warmth')!
const statRssi = document.querySelector('#stat-rssi')!
const fileInput = document.querySelector<HTMLInputElement>('#art-file')!
const fakeControls = document.querySelector<HTMLElement>('#fake-controls')!
const bridgeControls = document.querySelector<HTMLElement>('#bridge-controls')!
const modeFakeBtn = document.querySelector<HTMLButtonElement>('#mode-fake')!
const modeBridgeBtn = document.querySelector<HTMLButtonElement>('#mode-bridge')!
const modeHint = document.querySelector('#mode-hint')!
const bridgeHint = document.querySelector('#bridge-hint')!
const shareCoverBtn = document.querySelector<HTMLButtonElement>('#share-cover')!
const shareCrowdBtn = document.querySelector<HTMLButtonElement>('#share-crowd')!
const shareHint = document.querySelector('#share-hint')!
const stageLabel = document.querySelector('#stage-label')!
const stageHint = document.querySelector('#stage-hint')!
const forceFutureBtn = document.querySelector<HTMLButtonElement>('#force-future')!
const backRevealBtn = document.querySelector<HTMLButtonElement>('#back-reveal')!

let artwork: Artwork | null = null
let paint: PaintState = createEmptyPaint([])
let sightings: BleSighting[] = []
let nearRssi = DEFAULT_NEAR_RSSI
let lastTs = performance.now()
let mode: SignalMode = 'fake'
let shareMode: PaintShareMode = 'cover'
let stage: Stage = 'reveal'
/** Prevents auto-unlock from re-firing until paint is reset. */
let autoUnlocked = false
let unsub: (() => void) | null = null

const future = createFutureStage()

const fake = createFakeSignalSource({
  crowdSize: 0,
  rssiNoise: 8,
  deviceCap: DEVICE_CAP,
})
const bridge = createBridgeSignalSource({
  url: DEFAULT_BRIDGE_URL,
  deviceCap: DEVICE_CAP,
})

function activeSource(): SignalSource {
  if (mode === 'bridge') return bridge
  return fake
}

function stopAllSources() {
  fake.stop()
  bridge.stop()
}

function bindSource(src: SignalSource) {
  unsub?.()
  unsub = src.subscribe((next) => {
    sightings = next
  })
}

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

function updateStageHint() {
  if (stage === 'future') {
    stageHint.textContent =
      'Future stage (placeholder). Back to Reveal returns to the 2D canvas.'
    return
  }
  if (!artwork) {
    stageHint.textContent =
      'Load artwork to paint. Force Future skips unlock for testing.'
    return
  }
  const pct = Math.round(minReveal(paint) * 100)
  stageHint.textContent = `Reveal progress ${pct}% · unlocks Future at ~82%.`
}

function setStage(next: Stage, reason: 'auto' | 'force' | 'back' = 'force') {
  if (next === stage) {
    updateStageHint()
    return
  }

  stage = next
  canvasWrap.dataset.stage = next
  stageLabel.textContent = next

  if (next === 'future') {
    future.mount(futureHost)
    showStatus(
      reason === 'auto'
        ? 'Palette complete — entered Future stage'
        : 'Force Future — placeholder (Three.js next)',
      'ok',
    )
  } else {
    future.unmount()
    if (reason === 'back') {
      showStatus(
        artwork ? '' : 'Load an SVG or image to start. For real BLE use Bridge.',
        artwork ? 'ok' : 'warn',
      )
    }
  }

  forceFutureBtn.classList.toggle('is-active', next === 'future')
  forceFutureBtn.classList.toggle('secondary', next !== 'future')
  backRevealBtn.classList.toggle('is-active', next === 'reveal')
  backRevealBtn.classList.toggle('secondary', next !== 'reveal')
  updateStageHint()
}

function applyArtwork(next: Artwork) {
  artwork = next
  paint = createEmptyPaint(next.regions)
  autoUnlocked = false
  artNameEl.textContent = `${next.name} · ${listPaintNumbers(next.regions).length} paints · ${next.mode}`
  renderPalette()
  if (next.warnings.length) {
    showStatus(next.warnings.join(' · '), 'warn')
  } else if (mode === 'fake' && stage === 'reveal') {
    showStatus('')
  }
  resizeCanvas()
  updateStageHint()
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

function setModeUi(next: SignalMode) {
  mode = next
  modeFakeBtn.classList.toggle('is-active', next === 'fake')
  modeFakeBtn.classList.toggle('secondary', next !== 'fake')
  modeBridgeBtn.classList.toggle('is-active', next === 'bridge')
  modeBridgeBtn.classList.toggle('secondary', next !== 'bridge')

  fakeControls.hidden = next !== 'fake'
  bridgeControls.hidden = next !== 'bridge'

  if (next === 'fake') {
    modeHint.textContent = 'Fake: simulated crowd + shimmer.'
  } else {
    modeHint.textContent = 'Bridge: local BLE helper → WebSocket (Live).'
  }
}

function switchMode(next: SignalMode) {
  if (next === mode) return

  stopAllSources()
  sightings = []
  setModeUi(next)
  bindSource(activeSource())

  if (next === 'fake') {
    fake.start()
    if (stage === 'reveal') {
      showStatus(artwork ? '' : 'Load an SVG or image to start', artwork ? 'ok' : 'warn')
    }
  } else {
    bridgeHint.innerHTML =
      'Run <code>npm run bridge</code> in a terminal, then Connect.'
    if (stage === 'reveal') {
      showStatus('Bridge mode — start helper, then Connect', 'warn')
    }
  }
}

modeFakeBtn.addEventListener('click', () => switchMode('fake'))
modeBridgeBtn.addEventListener('click', () => switchMode('bridge'))

function setShareMode(next: PaintShareMode) {
  if (next === shareMode) return
  shareMode = next
  shareCoverBtn.classList.toggle('is-active', next === 'cover')
  shareCoverBtn.classList.toggle('secondary', next !== 'cover')
  shareCrowdBtn.classList.toggle('is-active', next === 'crowd')
  shareCrowdBtn.classList.toggle('secondary', next !== 'crowd')
  shareHint.textContent =
    next === 'cover'
      ? 'Cover: any near device unlocks the full palette.'
      : `Crowd: each near device unlocks a slice (max ${DEVICE_CAP}). Need people for full color.`
}

shareCoverBtn.addEventListener('click', () => setShareMode('cover'))
shareCrowdBtn.addEventListener('click', () => setShareMode('crowd'))

forceFutureBtn.addEventListener('click', () => {
  autoUnlocked = true
  setStage('future', 'force')
})

backRevealBtn.addEventListener('click', () => {
  setStage('reveal', 'back')
})

document.querySelector('#bridge-connect')!.addEventListener('click', () => {
  if (mode !== 'bridge') return
  bridge.connect()
  showStatus(`Connecting to ${bridge.url}…`, 'warn')
  window.setTimeout(() => {
    if (bridge.connected) {
      showStatus('Bridge connected — scanning via helper', 'ok')
      bridgeHint.textContent = 'Connected. Devices update from the helper.'
    } else {
      showStatus(
        bridge.lastError || `Cannot reach ${bridge.url}. Run npm run bridge.`,
        'error',
      )
    }
  }, 400)
})

document.querySelector('#bridge-disconnect')!.addEventListener('click', () => {
  bridge.disconnect()
  showStatus('Bridge disconnected', 'warn')
  bridgeHint.innerHTML =
    'Run <code>npm run bridge</code> in a terminal, then Connect.'
})

crowdInput.addEventListener('input', () => {
  const n = Number(crowdInput.value)
  crowdVal.textContent = String(n)
  fake.setCrowdSize(n)
})

noiseInput.addEventListener('input', () => {
  const n = Number(noiseInput.value)
  noiseVal.textContent = String(n)
  fake.setRssiNoise(n)
})

nearInput.addEventListener('input', () => {
  nearRssi = Number(nearInput.value)
  nearVal.textContent = String(nearRssi)
})

document.querySelector('#walk')!.addEventListener('click', () => fake.walkPast())

function resetPaint() {
  if (artwork) paint = createEmptyPaint(artwork.regions)
  autoUnlocked = false
  if (stage === 'future') setStage('reveal', 'back')
  updateStageHint()
}
document.querySelector('#reset')!.addEventListener('click', resetPaint)
document.querySelector('#reset-bridge')!.addEventListener('click', resetPaint)

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0]
  fileInput.value = ''
  if (!file) return

  const lower = file.name.toLowerCase()
  const looksRasterSvg =
    lower.endsWith('.svg') || file.type === 'image/svg+xml'

  const result = await loadRasterFromFile(file)
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

setModeUi('fake')
stage = 'reveal'
canvasWrap.dataset.stage = 'reveal'
stageLabel.textContent = 'reveal'
forceFutureBtn.classList.add('secondary')
backRevealBtn.classList.add('is-active')
updateStageHint()
bindSource(fake)
fake.start()

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

function renderDeviceList(vibe = computeVibe(sightings, DEVICE_CAP, nearRssi)) {
  if (!artwork) {
    devicesEl.innerHTML = ''
    return
  }
  const paintNumbers = listPaintNumbers(artwork.regions)
  const near = sightings.filter((s) => isNear(s.rssi, nearRssi))
  const keys = near.map((s) => deviceKey(s.id, s.manufacturerId))
  const assigned = assignPaintsToDevices(keys, paintNumbers, shareMode)
  devicesEl.innerHTML = sightings
    .slice()
    .sort((a, b) => b.rssi - a.rssi)
    .map((s) => {
      const close = isNear(s.rssi, nearRssi)
      const swatch = deviceSwatch(artwork!.regions, s, vibe, sightings, shareMode)
      const paints = assigned.get(deviceKey(s.id, s.manufacturerId)) ?? []
      const label = !close
        ? 'far'
        : paints.length === 0
          ? 'no slot'
          : paints.length <= 4
            ? paints.join(', ')
            : `${paints.slice(0, 3).join(', ')}…+${paints.length - 3}`
      return `<li class="${close ? 'is-near' : 'is-far'}">
        <i class="swatch" style="background:${swatch}"></i>
        <span>${s.name ?? s.id.slice(0, 12)} → ${label}</span>
        <span>${s.rssi.toFixed(0)} dBm</span>
      </li>`
    })
    .join('')
}

function frame(ts: number) {
  const dt = Math.min(0.05, (ts - lastTs) / 1000)
  lastTs = ts

  const vibe = computeVibe(sightings, DEVICE_CAP, nearRssi)

  if (stage === 'reveal') {
    if (artwork) {
      updatePaint(paint, artwork.regions, sightings, vibe, dt, shareMode)
      drawArtwork(ctx, artwork, paint, vibe)
      if (!autoUnlocked && isRevealComplete(paint)) {
        autoUnlocked = true
        setStage('future', 'auto')
      } else {
        updateStageHint()
      }
    }
  } else {
    future.tick(dt, vibe)
  }

  // Keep bridge status fresh while connecting
  if (mode === 'bridge' && bridge.connected && statusEl.dataset.kind === 'warn') {
    if (/Connecting/i.test(statusEl.textContent || '')) {
      showStatus('Bridge connected — scanning via helper', 'ok')
    }
  }

  // Stats stay live in both stages
  statCount.textContent = String(vibe.deviceCount)
  statNear.textContent = String(vibe.nearCount)
  statWarmth.textContent = `${Math.round(vibe.warmth * 100)}%`
  statRssi.textContent =
    vibe.nearCount === 0 ? '—' : `${vibe.averageRssi.toFixed(0)} dBm`

  renderDeviceList(vibe)
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
showStatus('Load an SVG or image to start. For real BLE use Bridge.', 'warn')
