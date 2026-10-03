export type Region = {
  id: number
  /** Paint-by-numbers label */
  label: string
  /** Shared paint bucket — same number can appear on many regions later in SVG art */
  paintNumber: number
  /** True artwork color (from SVG palette later) */
  baseColor: { h: number; s: number; l: number }
  path: Path2D
  cx: number
  cy: number
}

const VIEW_W = 1000
const VIEW_H = 700

export const REGION_VIEW = { w: VIEW_W, h: VIEW_H }

/** Max live devices for this experiment layout. */
export const DEVICE_CAP = 12

/** How many paint buckets one device unlocks. */
export const PAINTS_PER_DEVICE = 2

/**
 * Stand-in “SVG palette”: each paint number has a fixed color.
 * Later this comes from parsed SVG fills / data-paint attrs.
 */
const PALETTE: Record<number, { h: number; s: number; l: number }> = {
  1: { h: 210, s: 42, l: 52 }, // steel blue
  2: { h: 28, s: 55, l: 54 }, // clay
  3: { h: 155, s: 35, l: 42 }, // moss
  4: { h: 340, s: 40, l: 50 }, // rose
  5: { h: 45, s: 60, l: 55 }, // sand
  6: { h: 265, s: 28, l: 48 }, // slate violet
}

/** Simple abstract paint-by-numbers layout for experiments. */
export function createRegions(): Region[] {
  const specs: Array<{
    id: number
    paintNumber: number
    d: string
    cx: number
    cy: number
  }> = [
    { id: 1, paintNumber: 1, d: 'M 40 40 H 320 V 280 H 40 Z', cx: 180, cy: 160 },
    { id: 2, paintNumber: 2, d: 'M 320 40 H 680 V 200 H 320 Z', cx: 500, cy: 120 },
    { id: 3, paintNumber: 3, d: 'M 680 40 H 960 V 280 H 680 Z', cx: 820, cy: 160 },
    { id: 4, paintNumber: 4, d: 'M 40 280 H 220 V 520 H 40 Z', cx: 130, cy: 400 },
    { id: 5, paintNumber: 1, d: 'M 220 200 H 500 V 420 H 220 Z', cx: 360, cy: 310 },
    { id: 6, paintNumber: 5, d: 'M 500 200 H 780 V 420 H 500 Z', cx: 640, cy: 310 },
    { id: 7, paintNumber: 6, d: 'M 780 280 H 960 V 520 H 780 Z', cx: 870, cy: 400 },
    { id: 8, paintNumber: 3, d: 'M 40 520 H 360 V 660 H 40 Z', cx: 200, cy: 590 },
    { id: 9, paintNumber: 2, d: 'M 360 420 H 640 V 660 H 360 Z', cx: 500, cy: 540 },
    { id: 10, paintNumber: 5, d: 'M 640 520 H 960 V 660 H 640 Z', cx: 800, cy: 590 },
    { id: 11, paintNumber: 4, d: 'M 220 420 H 360 V 520 H 220 Z', cx: 290, cy: 470 },
    { id: 12, paintNumber: 6, d: 'M 640 420 H 780 V 520 H 640 Z', cx: 710, cy: 470 },
  ]

  return specs.map((s) => ({
    id: s.id,
    label: String(s.paintNumber),
    paintNumber: s.paintNumber,
    baseColor: { ...PALETTE[s.paintNumber] },
    path: new Path2D(s.d),
    cx: s.cx,
    cy: s.cy,
  }))
}

function hashString(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Unique paint numbers present in the artwork. */
export function listPaintNumbers(regions: Region[]): number[] {
  return [...new Set(regions.map((r) => r.paintNumber))].sort((a, b) => a - b)
}

/**
 * One device unlocks several paint buckets (all regions sharing those numbers).
 * Stable for a given device id + manufacturer.
 */
export function paintsForDevice(
  deviceId: string,
  manufacturerId: number | undefined,
  paintNumbers: number[],
  count = PAINTS_PER_DEVICE,
): number[] {
  if (paintNumbers.length === 0) return []
  const seed = hashString(`${deviceId}:${manufacturerId ?? 0}`)
  const picks: number[] = []
  let x = seed
  const pool = [...paintNumbers]

  const n = Math.min(count, pool.length)
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    const idx = x % pool.length
    picks.push(pool[idx])
    pool.splice(idx, 1)
  }
  return picks
}
