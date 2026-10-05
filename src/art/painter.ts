import {
  assignPaintsToDevices,
  deviceKey,
  listPaintNumbers,
  type Artwork,
  type PaintShareMode,
  type Region,
  type ViewBox,
} from './regions'
import {
  gradePaletteColor,
  hslToCss,
  type VibeState,
} from '../vibe/map'
import type { BleSighting } from '../signals/types'

/** Contour must reach this before color starts filling. */
const COLOR_AFTER_CONTOUR = 0.35

export type RegionPaint = {
  /** 0–1 ink contours */
  contour: number
  /** 0–1 color fill */
  reveal: number
  breath: number
  claimed: boolean
  /** True while a live device is unlocking this region */
  inRange: boolean
}

export type PaintState = {
  byRegion: Map<number, RegionPaint>
}

export function createEmptyPaint(regions: Region[]): PaintState {
  const byRegion = new Map<number, RegionPaint>()
  for (const r of regions) {
    byRegion.set(r.id, {
      contour: 0,
      reveal: 0,
      breath: 0,
      claimed: false,
      inRange: false,
    })
  }
  return { byRegion }
}

type RegionEnergy = {
  breath: number
  devices: number
}

function nearSightings(
  sightings: BleSighting[],
  vibe: VibeState,
): BleSighting[] {
  return sightings.filter((s) => (vibe.breathByDevice.get(s.id) ?? 0) > 0)
}

function energyByRegion(
  regions: Region[],
  sightings: BleSighting[],
  vibe: VibeState,
  shareMode: PaintShareMode,
): Map<number, RegionEnergy> {
  const paintNumbers = listPaintNumbers(regions)
  const near = nearSightings(sightings, vibe)
  const keys = near.map((s) => deviceKey(s.id, s.manufacturerId))
  const assigned = assignPaintsToDevices(keys, paintNumbers, shareMode)
  const energy = new Map<number, RegionEnergy>()

  for (const s of near) {
    const breath = vibe.breathByDevice.get(s.id) ?? 0
    const paints = assigned.get(deviceKey(s.id, s.manufacturerId)) ?? []
    for (const r of regions) {
      if (!paints.includes(r.paintNumber)) continue
      const prev = energy.get(r.id) ?? { breath: 0, devices: 0 }
      energy.set(r.id, {
        breath: Math.max(prev.breath, breath),
        devices: prev.devices + 1,
      })
    }
  }
  return energy
}

export function updatePaint(
  paint: PaintState,
  regions: Region[],
  sightings: BleSighting[],
  vibe: VibeState,
  dt: number,
  shareMode: PaintShareMode = 'cover',
): void {
  const energy = energyByRegion(regions, sightings, vibe, shareMode)

  for (const r of regions) {
    const state = paint.byRegion.get(r.id)!
    const live = energy.get(r.id)
    state.inRange = !!live

    if (live) {
      const boost = live.devices > 1 ? 1.4 : 1
      // Floor rate so weak RSSI still completes unlock in a few seconds
      const rate = Math.max(0.55, 0.35 + live.breath * 1.1) * boost
      state.contour = Math.min(1, state.contour + dt * rate * 1.6)
      if (state.contour >= COLOR_AFTER_CONTOUR) {
        state.reveal = Math.min(1, state.reveal + dt * rate * 1.8)
      }
      state.breath += (live.breath - state.breath) * Math.min(1, dt * 8)
      if (state.contour > 0.12 || state.reveal > 0.15) state.claimed = true
    } else {
      const fade =
        (state.claimed ? 0.18 : 0.4) + (1 - state.breath) * 0.15
      if (state.reveal > 0) {
        state.reveal = Math.max(0, state.reveal - dt * fade)
      } else {
        state.contour = Math.max(0, state.contour - dt * fade * 0.65)
      }
      state.breath += (0.05 - state.breath) * Math.min(1, dt * 3)
      if (state.contour < 0.05 && state.reveal < 0.05) state.claimed = false
    }
  }
}

function setupView(ctx: CanvasRenderingContext2D, viewBox: ViewBox): void {
  const { width, height } = ctx.canvas
  const sx = width / viewBox.w
  const sy = height / viewBox.h
  const scale = Math.min(sx, sy)
  const ox = (width - viewBox.w * scale) / 2
  const oy = (height - viewBox.h * scale) / 2
  ctx.translate(ox, oy)
  ctx.scale(scale, scale)
  ctx.translate(-viewBox.x, -viewBox.y)
}

export function drawArtwork(
  ctx: CanvasRenderingContext2D,
  artwork: Artwork,
  paint: PaintState,
  vibe: VibeState,
): void {
  const { width, height } = ctx.canvas
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  ctx.save()
  setupView(ctx, artwork.viewBox)

  if (artwork.mode === 'raster') {
    drawRaster(ctx, artwork, paint)
  } else {
    drawVector(ctx, artwork.regions, paint, vibe, artwork.viewBox)
  }

  ctx.restore()
}

function drawRaster(
  ctx: CanvasRenderingContext2D,
  artwork: Artwork,
  paint: PaintState,
): void {
  const { w, h } = artwork.viewBox

  // Phase 1 — contours (breath only softens ink, never blocks)
  for (const r of artwork.regions) {
    const state = paint.byRegion.get(r.id)!
    if (state.contour <= 0.01 || !r.edgeLayer) continue
    ctx.globalAlpha = Math.min(1, state.contour * (0.85 + state.breath * 0.15))
    ctx.drawImage(r.edgeLayer, 0, 0, w, h)
    ctx.globalAlpha = 1
  }

  // Phase 2 — color: opacity follows reveal only (breath must NOT cap color)
  for (const r of artwork.regions) {
    const state = paint.byRegion.get(r.id)!
    if (state.reveal <= 0.01 || !r.colorLayer) continue
    ctx.globalAlpha = Math.min(1, state.reveal)
    ctx.drawImage(r.colorLayer, 0, 0, w, h)
    ctx.globalAlpha = 1
  }

  // When every paint is unlocked, blend in the true photo so it reads “complete”
  if (artwork.sourceCanvas && artwork.regions.length > 0) {
    let minReveal = 1
    for (const r of artwork.regions) {
      minReveal = Math.min(minReveal, paint.byRegion.get(r.id)!.reveal)
    }
    if (minReveal > 0.82) {
      ctx.globalAlpha = Math.min(1, (minReveal - 0.82) / 0.18)
      ctx.drawImage(artwork.sourceCanvas, 0, 0, w, h)
      ctx.globalAlpha = 1
    }
  }
}

function drawVector(
  ctx: CanvasRenderingContext2D,
  regions: Region[],
  paint: PaintState,
  vibe: VibeState,
  viewBox: ViewBox,
): void {
  const strokeW = Math.max(0.8, viewBox.w / 420)

  for (const r of regions) {
    if (!r.path) continue
    const state = paint.byRegion.get(r.id)!
    const graded = gradePaletteColor(
      r.baseColor,
      vibe.warmth * 0.35,
      Math.max(state.breath, state.reveal),
    )

    if (state.contour > 0.01) {
      ctx.globalAlpha = Math.min(0.95, state.contour * (0.85 + state.breath * 0.15))
      ctx.strokeStyle = 'rgba(24, 28, 36, 0.85)'
      ctx.lineWidth = strokeW
      ctx.lineJoin = 'round'
      ctx.stroke(r.path)
      ctx.globalAlpha = 1
    }

    if (state.reveal > 0.01) {
      ctx.globalAlpha = Math.min(1, state.reveal)
      ctx.fillStyle = hslToCss(graded, 1)
      ctx.fill(r.path)
      ctx.globalAlpha = 1
    }
  }
}

export function deviceSwatch(
  regions: Region[],
  sighting: BleSighting,
  vibe: VibeState,
  allSightings: BleSighting[],
  shareMode: PaintShareMode = 'cover',
): string {
  const breath = vibe.breathByDevice.get(sighting.id) ?? 0
  if (breath <= 0) return '#bbb'
  const paintNumbers = listPaintNumbers(regions)
  const near = nearSightings(allSightings, vibe)
  const keys = near.map((s) => deviceKey(s.id, s.manufacturerId))
  const paints =
    assignPaintsToDevices(keys, paintNumbers, shareMode).get(
      deviceKey(sighting.id, sighting.manufacturerId),
    ) ?? []
  const region = regions.find((r) => r.paintNumber === paints[0])
  if (!region) return '#999'
  return hslToCss(
    gradePaletteColor(region.baseColor, vibe.warmth * 0.35, Math.max(breath, 0.5)),
  )
}
