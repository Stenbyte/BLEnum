import type { BleSighting } from '../signals/types'

export type HslColor = {
  h: number
  s: number
  l: number
}

export type VibeState = {
  warmth: number
  deviceCount: number
  averageRssi: number
  globalSaturation: number
  colorsByDevice: Map<string, HslColor>
}

function hashHue(id: string, manufacturerId?: number): number {
  let h = manufacturerId ?? 0
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0
  }
  return h % 360
}

/** Quiet → cool blues; crowded → warm reds/oranges. */
function warmthFromCount(count: number): number {
  return Math.min(1, count / 12)
}

/** Weak RSSI → muted; strong → vivid. */
function saturationFromRssi(rssi: number): number {
  const t = (rssi + 100) / 60
  return 20 + Math.max(0, Math.min(1, t)) * 70
}

function lerpHue(a: number, b: number, t: number): number {
  const diff = ((b - a + 540) % 360) - 180
  return (a + diff * t + 360) % 360
}

export function computeVibe(sightings: BleSighting[]): VibeState {
  const deviceCount = sightings.length
  const warmth = warmthFromCount(deviceCount)
  const averageRssi =
    deviceCount === 0
      ? -90
      : sightings.reduce((sum, s) => sum + s.rssi, 0) / deviceCount
  const globalSaturation = saturationFromRssi(averageRssi)

  const cool = 210
  const warm = 15
  const colorsByDevice = new Map<string, HslColor>()

  for (const s of sightings) {
    const baseHue = hashHue(s.id, s.manufacturerId)
    const biased = lerpHue(baseHue, warmth < 0.5 ? cool : warm, warmth * 0.35)
    colorsByDevice.set(s.id, {
      h: biased,
      s: saturationFromRssi(s.rssi),
      l: 42 + (s.rssi + 100) * 0.25,
    })
  }

  return {
    warmth,
    deviceCount,
    averageRssi,
    globalSaturation,
    colorsByDevice,
  }
}

export function hslToCss({ h, s, l }: HslColor, alpha = 1): string {
  return `hsla(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%, ${alpha})`
}

/** Background wash from vibe warmth. */
export function vibeWash(vibe: VibeState): string {
  const h = 210 - vibe.warmth * 195
  const s = 18 + vibe.globalSaturation * 0.25
  const l = 92 - vibe.warmth * 8
  return `hsl(${h}, ${s}%, ${l}%)`
}
