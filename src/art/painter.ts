import {
  assignPaintsToDevices,
  deviceKey,
  listPaintNumbers,
  type Artwork,
  type Region,
  type ViewBox,
} from './regions'
import {
  gradePaletteColor,
  hslToCss,
  outlineWash,
  type VibeState,
} from '../vibe/map'
import type { BleSighting } from '../signals/types'

export type RegionPaint = {
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
    byRegion.set(r.id, { reveal: 0, breath: 0, claimed: false, inRange: false })
  }
  return { byRegion }
}

type RegionEnergy = {
  breath: number
  devices: number
}

function energyByRegion(
  regions: Region[],
  sightings: BleSighting[],
  vibe: VibeState,
): Map<number, RegionEnergy> {
  const paintNumbers = listPaintNumbers(regions)
  const keys = sightings.map((s) => deviceKey(s.id, s.manufacturerId))
  const assigned = assignPaintsToDevices(keys, paintNumbers)
  const energy = new Map<number, RegionEnergy>()

  for (const s of sightings) {
    const paints = assigned.get(deviceKey(s.id, s.manufacturerId)) ?? []
    const breath = vibe.breathByDevice.get(s.id) ?? 0
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
): void {
  const energy = energyByRegion(regions, sightings, vibe)

  for (const r of regions) {
    const state = paint.byRegion.get(r.id)!
    const live = energy.get(r.id)
    state.inRange = !!live

    if (live) {
      const boost = live.devices > 1 ? 1.25 : 1
      const rate = (0.25 + live.breath * 0.75) * boost
      state.reveal = Math.min(1, state.reveal + dt * rate)
      state.breath += (live.breath - state.breath) * Math.min(1, dt * 8)
      if (state.reveal > 0.15) state.claimed = true
    } else {
      // Device left range — fade color back toward gray
      const fade = 0.45 + (1 - state.breath) * 0.25
      state.reveal = Math.max(0, state.reveal - dt * fade)
      state.breath += (0.05 - state.breath) * Math.min(1, dt * 3)
      if (state.reveal < 0.05) state.claimed = false
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
  ctx.fillStyle = outlineWash(vibe.warmth)
  ctx.fillRect(0, 0, width, height)

  ctx.save()
  setupView(ctx, artwork.viewBox)

  if (artwork.mode === 'raster' && artwork.grayCanvas) {
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
  ctx.drawImage(artwork.grayCanvas!, 0, 0, w, h)

  for (const r of artwork.regions) {
    const state = paint.byRegion.get(r.id)!
    if (state.reveal > 0.01 && r.colorLayer) {
      const pulse = 0.55 + state.breath * 0.45
      ctx.globalAlpha = Math.min(1, state.reveal * pulse)
      ctx.drawImage(r.colorLayer, 0, 0, w, h)
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
  const strokeW = Math.max(0.5, viewBox.w / 500)

  for (const r of regions) {
    if (!r.path) continue
    const state = paint.byRegion.get(r.id)!
    // Prefer true SVG color; light warmth/breath only
    const graded = gradePaletteColor(r.baseColor, vibe.warmth * 0.35, state.breath)

    ctx.fillStyle = 'rgba(240,240,240,0.5)'
    ctx.fill(r.path)

    if (state.reveal > 0.01) {
      const pulse = 0.55 + state.breath * 0.45
      ctx.globalAlpha = Math.min(1, state.reveal * pulse)
      ctx.fillStyle = hslToCss(graded, 1)
      ctx.fill(r.path)
      ctx.globalAlpha = 1
    }

    ctx.strokeStyle = 'rgba(20, 24, 32, 0.2)'
    ctx.lineWidth = strokeW
    ctx.stroke(r.path)
  }
}

export function deviceSwatch(
  regions: Region[],
  sighting: BleSighting,
  vibe: VibeState,
  allSightings: BleSighting[],
): string {
  const paintNumbers = listPaintNumbers(regions)
  const keys = allSightings.map((s) => deviceKey(s.id, s.manufacturerId))
  const paints =
    assignPaintsToDevices(keys, paintNumbers).get(
      deviceKey(sighting.id, sighting.manufacturerId),
    ) ?? []
  const region = regions.find((r) => r.paintNumber === paints[0])
  if (!region) return '#999'
  const breath = vibe.breathByDevice.get(sighting.id) ?? 0.5
  return hslToCss(gradePaletteColor(region.baseColor, vibe.warmth * 0.35, breath))
}
