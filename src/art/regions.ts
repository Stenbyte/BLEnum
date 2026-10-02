export type Region = {
  id: number
  label: string
  /** Path in viewBox units (0..1000 x 0..700) */
  path: Path2D
  /** Label anchor */
  cx: number
  cy: number
}

const VIEW_W = 1000
const VIEW_H = 700

export const REGION_VIEW = { w: VIEW_W, h: VIEW_H }

/** Simple abstract paint-by-numbers layout for experiments. */
export function createRegions(): Region[] {
  const specs: Array<{ id: number; d: string; cx: number; cy: number }> = [
    { id: 1, d: 'M 40 40 H 320 V 280 H 40 Z', cx: 180, cy: 160 },
    { id: 2, d: 'M 320 40 H 680 V 200 H 320 Z', cx: 500, cy: 120 },
    { id: 3, d: 'M 680 40 H 960 V 280 H 680 Z', cx: 820, cy: 160 },
    { id: 4, d: 'M 40 280 H 220 V 520 H 40 Z', cx: 130, cy: 400 },
    { id: 5, d: 'M 220 200 H 500 V 420 H 220 Z', cx: 360, cy: 310 },
    { id: 6, d: 'M 500 200 H 780 V 420 H 500 Z', cx: 640, cy: 310 },
    { id: 7, d: 'M 780 280 H 960 V 520 H 780 Z', cx: 870, cy: 400 },
    { id: 8, d: 'M 40 520 H 360 V 660 H 40 Z', cx: 200, cy: 590 },
    { id: 9, d: 'M 360 420 H 640 V 660 H 360 Z', cx: 500, cy: 540 },
    { id: 10, d: 'M 640 520 H 960 V 660 H 640 Z', cx: 800, cy: 590 },
    { id: 11, d: 'M 220 420 H 360 V 520 H 220 Z', cx: 290, cy: 470 },
    { id: 12, d: 'M 640 420 H 780 V 520 H 640 Z', cx: 710, cy: 470 },
  ]

  return specs.map((s) => ({
    id: s.id,
    label: String(s.id),
    path: new Path2D(s.d),
    cx: s.cx,
    cy: s.cy,
  }))
}

/** Map a stable device id to a region index (0-based). */
export function deviceToRegionIndex(deviceId: string, regionCount: number): number {
  let h = 0
  for (let i = 0; i < deviceId.length; i++) {
    h = (h * 33 + deviceId.charCodeAt(i)) >>> 0
  }
  return h % regionCount
}
