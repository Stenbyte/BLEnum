import type { BleSighting } from '../signals/types'

export type HslColor = {
  h: number
  s: number
  l: number
}

export type VibeState = {
  /** 0 = cool/quiet, 1 = warm/crowded */
  warmth: number
  deviceCount: number
  averageRssi: number
  /** Per-device breath factor from RSSI (0..1+) */
  breathByDevice: Map<string, number>
}

/** Quiet → cool; crowded → warm. Cap-aware. */
export function warmthFromCount(count: number, cap: number): number {
  if (cap <= 0) return 0
  return Math.min(1, count / cap)
}

/** Map RSSI to fill/breath strength. */
export function strengthFromRssi(rssi: number): number {
  // -100..-40 → 0..1
  return Math.max(0, Math.min(1, (rssi + 100) / 60))
}

export function computeVibe(sightings: BleSighting[], deviceCap: number): VibeState {
  const deviceCount = sightings.length
  const warmth = warmthFromCount(deviceCount, deviceCap)
  const averageRssi =
    deviceCount === 0
      ? -90
      : sightings.reduce((sum, s) => sum + s.rssi, 0) / deviceCount

  const breathByDevice = new Map<string, number>()
  for (const s of sightings) {
    breathByDevice.set(s.id, strengthFromRssi(s.rssi))
  }

  return {
    warmth,
    deviceCount,
    averageRssi,
    breathByDevice,
  }
}

/**
 * Apply global warmth grade to a fixed palette color.
 * Identity stays; mood shifts cool↔warm.
 */
export function gradePaletteColor(
  base: HslColor,
  warmth: number,
  breath: number,
): HslColor {
  const coolPull = 210
  const warmPull = 18
  const target = warmth < 0.5 ? coolPull : warmPull
  const h = lerpHue(base.h, target, warmth * 0.18)
  const s = clamp(base.s * (0.55 + breath * 0.55) * (0.85 + warmth * 0.25), 8, 85)
  const l = clamp(base.l * (0.88 + breath * 0.2) - warmth * 4, 22, 72)
  return { h, s, l }
}

/** Desaturated outline fill for unrevealed look (near B&W). */
export function outlineWash(warmth: number): string {
  const h = 210 - warmth * 180
  const s = 6 + warmth * 8
  const l = 90 - warmth * 6
  return `hsl(${h}, ${s}%, ${l}%)`
}

export function hslToCss({ h, s, l }: HslColor, alpha = 1): string {
  return `hsla(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%, ${alpha})`
}

function lerpHue(a: number, b: number, t: number): number {
  const diff = ((b - a + 540) % 360) - 180
  return (a + diff * t + 360) % 360
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}
