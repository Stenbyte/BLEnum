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
  /** Grayscale of source (raster mode) — “colors removed” */
  grayCanvas?: HTMLCanvasElement
  mode: 'raster' | 'vector'
}

/** Max live devices for Step 1. */
export const DEVICE_CAP = 20

export function listPaintNumbers(regions: Region[]): number[] {
  return [...new Set(regions.map((r) => r.paintNumber))].sort((a, b) => a - b)
}

/**
 * Spread paints across live devices with no gaps.
 * Round-robin so the union of assignments always covers every paint
 * whenever at least one device is present (fixes permanent gray holes).
 */
export function assignPaintsToDevices(
  deviceKeys: string[],
  paintNumbers: number[],
): Map<string, number[]> {
  const map = new Map<string, number[]>()
  if (deviceKeys.length === 0 || paintNumbers.length === 0) return map

  const devices = [...deviceKeys].sort()
  for (const id of devices) map.set(id, [])

  const paints = [...paintNumbers].sort((a, b) => a - b)
  paints.forEach((paint, i) => {
    const id = devices[i % devices.length]
    map.get(id)!.push(paint)
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
): number[] {
  if (paintNumbers.length === 0) return []
  const key = deviceKey(deviceId, manufacturerId)
  const keys =
    allDeviceKeys && allDeviceKeys.length > 0 ? allDeviceKeys : [key]
  return assignPaintsToDevices(keys, paintNumbers).get(key) ?? []
}
