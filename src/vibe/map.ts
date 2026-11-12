import type { BleSighting } from '../signals/types'

/** Default “near Mac” gate (dBm). Above = unlock paint. */
export const DEFAULT_NEAR_RSSI = -65

/** Soft ramp width above the gate (dBm). */
export const NEAR_RAMP_DB = 20

/** How fast smoothed RSSI follows raw (0–1). Higher = snappier. */
export const RSSI_EMA = 0.35

/** Must stay at/above gate this long before counting as near. */
export const NEAR_ENTER_MS = 300

/** Must stay below gate this long before counting as far. */
export const NEAR_LEAVE_MS = 700

/** Drop tracker state if device unseen this long. */
const PROX_STALE_MS = 8000

export type HslColor = {
  h: number
  s: number
  l: number
}

export type VibeState = {
  /** 0 = cool/quiet, 1 = warm/crowded (near devices only) */
  warmth: number
  deviceCount: number
  nearCount: number
  nearRssi: number
  averageRssi: number
  /** Per-device breath factor from proximity (0 = too far) */
  breathByDevice: Map<string, number>
}

type ProxState = {
  smoothRssi: number
  near: boolean
  /** Timestamp when smoothed RSSI first crossed above the gate (while far). */
  aboveSince: number | null
  /** Timestamp when smoothed RSSI first crossed below the gate (while near). */
  belowSince: number | null
  lastSeen: number
}

/** Per-device EMA + hysteresis. Shared across computeVibe calls. */
const proxById = new Map<string, ProxState>()

/** Quiet → cool; crowded → warm. Cap-aware. */
export function warmthFromCount(count: number, cap: number): number {
  if (cap <= 0) return 0
  return Math.min(1, count / cap)
}

/** Instant RSSI vs gate (no smoothing). Prefer vibe / isDeviceNear for UI. */
export function isNear(rssi: number, nearRssi = DEFAULT_NEAR_RSSI): boolean {
  return rssi >= nearRssi
}

/** True when hysteretic tracker currently counts this device as near. */
export function isDeviceNear(vibe: VibeState, deviceId: string): boolean {
  return (vibe.breathByDevice.get(deviceId) ?? 0) > 0
}

/**
 * Map RSSI to fill/breath strength with a soft near gate.
 * Below nearRssi → 0; ramps to 1 over NEAR_RAMP_DB above the gate.
 */
export function strengthFromRssi(
  rssi: number,
  nearRssi = DEFAULT_NEAR_RSSI,
): number {
  if (rssi < nearRssi) return 0
  return Math.max(0, Math.min(1, (rssi - nearRssi) / NEAR_RAMP_DB))
}

/** Clear EMA / hysteresis (tests or full reset). */
export function resetProximityTracking(): void {
  proxById.clear()
}

function touchProx(
  id: string,
  rawRssi: number,
  nearRssi: number,
  now: number,
): ProxState {
  let p = proxById.get(id)
  if (!p) {
    p = {
      smoothRssi: rawRssi,
      near: false,
      aboveSince: null,
      belowSince: null,
      lastSeen: now,
    }
    proxById.set(id, p)
  } else {
    p.smoothRssi = p.smoothRssi + (rawRssi - p.smoothRssi) * RSSI_EMA
    p.lastSeen = now
  }

  const above = p.smoothRssi >= nearRssi

  if (above) {
    p.belowSince = null
    if (p.near) {
      p.aboveSince = null
    } else {
      if (p.aboveSince == null) p.aboveSince = now
      if (now - p.aboveSince >= NEAR_ENTER_MS) {
        p.near = true
        p.aboveSince = null
      }
    }
  } else {
    p.aboveSince = null
    if (!p.near) {
      p.belowSince = null
    } else {
      if (p.belowSince == null) p.belowSince = now
      if (now - p.belowSince >= NEAR_LEAVE_MS) {
        p.near = false
        p.belowSince = null
      }
    }
  }

  return p
}

/**
 * Advance leave timers for devices that dropped out of the sighting list.
 * Missing ads count as “below gate” so near does not stick forever.
 */
/** Breath while hysteretically near — floor so brief dips under the gate stay “near”. */
function breathWhileNear(p: ProxState, nearRssi: number): number {
  if (!p.near) return 0
  return Math.max(0.12, strengthFromRssi(p.smoothRssi, nearRssi))
}

function ageMissing(activeIds: Set<string>, nearRssi: number, now: number): void {
  for (const [id, p] of proxById) {
    if (activeIds.has(id)) continue

    // No new sample — ease smooth RSSI downward so leave can complete.
    const phantom = Math.min(p.smoothRssi, nearRssi - 4)
    p.smoothRssi = p.smoothRssi + (phantom - p.smoothRssi) * RSSI_EMA
    p.aboveSince = null

    if (p.near) {
      if (p.belowSince == null) p.belowSince = now
      if (now - p.belowSince >= NEAR_LEAVE_MS) {
        p.near = false
        p.belowSince = null
      }
    }

    if (now - p.lastSeen > PROX_STALE_MS) {
      proxById.delete(id)
    }
  }
}

export function computeVibe(
  sightings: BleSighting[],
  deviceCap: number,
  nearRssi = DEFAULT_NEAR_RSSI,
  now = Date.now(),
): VibeState {
  const deviceCount = sightings.length
  const activeIds = new Set<string>()
  const breathByDevice = new Map<string, number>()
  let smoothSum = 0
  let nearCount = 0

  for (const s of sightings) {
    activeIds.add(s.id)
    const p = touchProx(s.id, s.rssi, nearRssi, now)
    const breath = breathWhileNear(p, nearRssi)
    breathByDevice.set(s.id, breath)
    if (p.near) {
      nearCount++
      smoothSum += p.smoothRssi
    }
  }

  ageMissing(activeIds, nearRssi, now)

  // Still-near devices briefly missing from this packet keep breath for leave window
  for (const [id, p] of proxById) {
    if (activeIds.has(id) || !p.near) continue
    const breath = breathWhileNear(p, nearRssi)
    if (breath <= 0) continue
    breathByDevice.set(id, breath)
    nearCount++
    smoothSum += p.smoothRssi
  }

  const warmth = warmthFromCount(nearCount, deviceCap)
  const averageRssi = nearCount === 0 ? -90 : smoothSum / nearCount

  return {
    warmth,
    deviceCount,
    nearCount,
    nearRssi,
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
