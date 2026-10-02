import { deviceToRegionIndex, REGION_VIEW, type Region } from './regions'
import { hslToCss, type VibeState } from '../vibe/map'
import type { BleSighting } from '../signals/types'

export type PaintState = {
  /** region id → fill progress 0..1 */
  fills: Map<number, number>
  /** region id → css color */
  colors: Map<number, string>
}

export function createEmptyPaint(regions: Region[]): PaintState {
  const fills = new Map<number, number>()
  const colors = new Map<number, string>()
  for (const r of regions) {
    fills.set(r.id, 0)
    colors.set(r.id, 'transparent')
  }
  return { fills, colors }
}

/** Collaborative: paint stays once filled; color updates while device present. */
export function updatePaint(
  paint: PaintState,
  regions: Region[],
  sightings: BleSighting[],
  vibe: VibeState,
  dt: number,
): void {
  const activeRegions = new Set<number>()

  for (const s of sightings) {
    const idx = deviceToRegionIndex(s.id, regions.length)
    const region = regions[idx]
    const color = vibe.colorsByDevice.get(s.id)
    if (!color) continue

    activeRegions.add(region.id)
    paint.colors.set(region.id, hslToCss(color, 0.92))

    const strength = Math.max(0, Math.min(1, (s.rssi + 95) / 50))
    const current = paint.fills.get(region.id) ?? 0
    const next = Math.min(1, current + dt * (0.15 + strength * 0.55))
    paint.fills.set(region.id, next)
  }

  // Soft fade only if never fully painted; fully painted stays
  for (const r of regions) {
    const fill = paint.fills.get(r.id) ?? 0
    if (fill >= 1) continue
    if (activeRegions.has(r.id)) continue
    paint.fills.set(r.id, Math.max(0, fill - dt * 0.08))
  }
}

export function drawCanvas(
  ctx: CanvasRenderingContext2D,
  regions: Region[],
  paint: PaintState,
  wash: string,
): void {
  const { width, height } = ctx.canvas
  ctx.clearRect(0, 0, width, height)

  ctx.fillStyle = wash
  ctx.fillRect(0, 0, width, height)

  const sx = width / REGION_VIEW.w
  const sy = height / REGION_VIEW.h
  ctx.save()
  ctx.scale(sx, sy)

  for (const r of regions) {
    const fill = paint.fills.get(r.id) ?? 0
    const color = paint.colors.get(r.id) ?? 'transparent'

    if (fill > 0.01) {
      ctx.globalAlpha = fill
      ctx.fillStyle = color
      ctx.fill(r.path)
      ctx.globalAlpha = 1
    }

    ctx.strokeStyle = 'rgba(20, 24, 32, 0.55)'
    ctx.lineWidth = 2.5
    ctx.stroke(r.path)

    ctx.fillStyle = fill > 0.45 ? 'rgba(255,255,255,0.85)' : 'rgba(20,24,32,0.55)'
    ctx.font = '600 28px "IBM Plex Sans", system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(r.label, r.cx, r.cy)
  }

  ctx.restore()
}
