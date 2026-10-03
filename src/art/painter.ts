import {
  listPaintNumbers,
  paintsForDevice,
  REGION_VIEW,
  type Region,
} from './regions'
import {
  gradePaletteColor,
  hslToCss,
  outlineWash,
  type VibeState,
} from '../vibe/map'
import type { BleSighting } from '../signals/types'

export type RegionPaint = {
  /** Reveal progress 0..1 (sticky — does not drop once high) */
  reveal: number
  /** Live breath 0..1 from active device RSSI */
  breath: number
  /** Soft lock once meaningfully painted */
  claimed: boolean
}

export type PaintState = {
  byRegion: Map<number, RegionPaint>
}

export function createEmptyPaint(regions: Region[]): PaintState {
  const byRegion = new Map<number, RegionPaint>()
  for (const r of regions) {
    byRegion.set(r.id, { reveal: 0, breath: 0, claimed: false })
  }
  return { byRegion }
}

type RegionEnergy = {
  breath: number
  devices: number
}

/** Aggregate which regions are energized by live devices (multi-block unlock). */
function energyByRegion(
  regions: Region[],
  sightings: BleSighting[],
  vibe: VibeState,
): Map<number, RegionEnergy> {
  const paintNumbers = listPaintNumbers(regions)
  const energy = new Map<number, RegionEnergy>()

  for (const s of sightings) {
    const paints = paintsForDevice(s.id, s.manufacturerId, paintNumbers)
    const breath = vibe.breathByDevice.get(s.id) ?? 0
    for (const r of regions) {
      if (!paints.includes(r.paintNumber)) continue
      const prev = energy.get(r.id) ?? { breath: 0, devices: 0 }
      // Shared strength: take max breath, count contributors
      energy.set(r.id, {
        breath: Math.max(prev.breath, breath),
        devices: prev.devices + 1,
      })
    }
  }
  return energy
}

/**
 * Collaborative reveal toward fixed palette colors.
 * Sticky: reveal only grows. Breath follows live RSSI (living picture).
 */
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

    if (live) {
      const boost = live.devices > 1 ? 1.25 : 1
      const rate = (0.2 + live.breath * 0.7) * boost
      state.reveal = Math.min(1, state.reveal + dt * rate)
      // Breath eases toward live signal (shimmer comes from RSSI jitter upstream)
      state.breath += (live.breath - state.breath) * Math.min(1, dt * 6)
      if (state.reveal > 0.15) state.claimed = true
    } else {
      // Idle: breath settles low so picture still soft-pulses when quiet
      state.breath += (0.08 - state.breath) * Math.min(1, dt * 2)
    }
  }
}

export function drawCanvas(
  ctx: CanvasRenderingContext2D,
  regions: Region[],
  paint: PaintState,
  vibe: VibeState,
): void {
  const { width, height } = ctx.canvas
  ctx.clearRect(0, 0, width, height)

  ctx.fillStyle = outlineWash(vibe.warmth)
  ctx.fillRect(0, 0, width, height)

  const sx = width / REGION_VIEW.w
  const sy = height / REGION_VIEW.h
  ctx.save()
  ctx.scale(sx, sy)

  for (const r of regions) {
    const state = paint.byRegion.get(r.id)!
    const graded = gradePaletteColor(r.baseColor, vibe.warmth, state.breath)

    // Unrevealed: faint gray plate (B&W boundaries)
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.fill(r.path)

    if (state.reveal > 0.01) {
      // Breath modulates alpha slightly so fills feel alive
      const pulse = 0.82 + state.breath * 0.18
      ctx.globalAlpha = state.reveal * pulse
      ctx.fillStyle = hslToCss(graded, 1)
      ctx.fill(r.path)
      ctx.globalAlpha = 1
    }

    ctx.strokeStyle = 'rgba(20, 24, 32, 0.6)'
    ctx.lineWidth = 2.5
    ctx.stroke(r.path)

    const numberColor =
      state.reveal > 0.4 ? 'rgba(255,255,255,0.9)' : 'rgba(20,24,32,0.55)'
    ctx.fillStyle = numberColor
    ctx.font = '600 28px "IBM Plex Sans", system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(r.label, r.cx, r.cy)
  }

  ctx.restore()
}

/** Swatch color for UI: palette graded by current vibe. */
export function deviceSwatch(
  regions: Region[],
  sighting: BleSighting,
  vibe: VibeState,
): string {
  const paints = paintsForDevice(
    sighting.id,
    sighting.manufacturerId,
    listPaintNumbers(regions),
  )
  const region = regions.find((r) => r.paintNumber === paints[0])
  if (!region) return '#999'
  const breath = vibe.breathByDevice.get(sighting.id) ?? 0.5
  return hslToCss(gradePaletteColor(region.baseColor, vibe.warmth, breath))
}
