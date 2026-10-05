import type { HslColor } from '../vibe/map'

export type Region = {
  id: number
  label: string
  paintNumber: number
  baseColor: HslColor
  /** Optional vector path (SVG mode). Raster mode uses colorLayer instead. */
  path?: Path2D
  cx: number
  cy: number
  /** Offscreen layer: colored pixels for this paint, transparent elsewhere */
  colorLayer?: HTMLCanvasElement
  /** Offscreen layer: ink contours for this paint (raster), transparent elsewhere */
  edgeLayer?: HTMLCanvasElement
}

export type ViewBox = {
  x: number
  y: number
  w: number
  h: number
}

export type Artwork = {
  name: string
  viewBox: ViewBox
  regions: Region[]
  warnings: string[]
  /** Full-color source (raster mode) */
  sourceCanvas?: HTMLCanvasElement
  /** Grayscale of source (raster mode) — optional / legacy */
  grayCanvas?: HTMLCanvasElement
  /** Full-image edge ink (raster mode) */
  edgeCanvas?: HTMLCanvasElement
  mode: 'raster' | 'vector'
}

/** Max live devices (and max crowd paint slots). */
export const DEVICE_CAP = 20

/** How paints are shared across near devices. */
export type PaintShareMode = 'cover' | 'crowd'

export function listPaintNumbers(regions: Region[]): number[] {
  return [...new Set(regions.map((r) => r.paintNumber))].sort((a, b) => a - b)
}

/**
 * Assign paints to near devices.
 * - cover: every near device unlocks every paint (1 person → full palette)
 * - crowd: partition into up to DEVICE_CAP slots; need people for full color
 */
export function assignPaintsToDevices(
  deviceKeys: string[],
  paintNumbers: number[],
  mode: PaintShareMode = 'cover',
): Map<string, number[]> {
  const map = new Map<string, number[]>()
  if (deviceKeys.length === 0 || paintNumbers.length === 0) return map

  const devices = [...deviceKeys].sort()
  const paints = [...paintNumbers].sort((a, b) => a - b)

  if (mode === 'cover') {
    for (const id of devices) map.set(id, [...paints])
    return map
  }

  for (const id of devices) map.set(id, [])

  const slotCount = Math.min(DEVICE_CAP, paints.length)
  paints.forEach((paint, i) => {
    const slot = i % slotCount
    // Only the device currently holding this slot unlocks the paint.
    // Extra devices beyond slotCount share earlier slots (same paints).
    if (slot < devices.length) {
      for (let d = slot; d < devices.length; d += slotCount) {
        map.get(devices[d])!.push(paint)
      }
    }
  })
  return map
}

/** Stable key for a sighting (id + manufacturer). */
export function deviceKey(id: string, manufacturerId?: number): string {
  return `${id}:${manufacturerId ?? 0}`
}

/**
 * Paints one device unlocks among the current crowd.
 * Prefer assignPaintsToDevices for full coverage; this keeps a stable solo API.
 */
export function paintsForDevice(
  deviceId: string,
  manufacturerId: number | undefined,
  paintNumbers: number[],
  allDeviceKeys?: string[],
  mode: PaintShareMode = 'cover',
): number[] {
  if (paintNumbers.length === 0) return []
  const key = deviceKey(deviceId, manufacturerId)
  const keys =
    allDeviceKeys && allDeviceKeys.length > 0 ? allDeviceKeys : [key]
  return assignPaintsToDevices(keys, paintNumbers, mode).get(key) ?? []
}
