import type { HslColor } from '../../vibe/map'

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  gray: '#808080',
  grey: '#808080',
  orange: '#ffa500',
  purple: '#800080',
  pink: '#ffc0cb',
  brown: '#a52a2a',
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function rgbToHsl(r: number, g: number, b: number): HslColor {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: l * 100 }

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  switch (max) {
    case R:
      h = ((G - B) / d + (G < B ? 6 : 0)) / 6
      break
    case G:
      h = ((B - R) / d + 2) / 6
      break
    default:
      h = ((R - G) / d + 4) / 6
      break
  }
  return { h: h * 360, s: s * 100, l: l * 100 }
}

/** Coarse key — merges near-identical SVG fills (skin/hair shading). */
export function colorKey(c: HslColor): string {
  if (c.l >= 93) return 'white'
  if (c.l <= 7) return 'black'
  if (c.s < 10) return `gray:${Math.round(c.l / 8) * 8}`
  const h = Math.round(c.h / 15) * 15
  const s = Math.round(c.s / 12) * 12
  const l = Math.round(c.l / 8) * 8
  return `${h}:${s}:${l}`
}

/** Parse common SVG fill strings into HSL. Returns null if none / unusable. */
export function parseFillColor(raw: string | null | undefined): HslColor | null {
  if (!raw) return null
  const fill = raw.trim().toLowerCase()
  if (!fill || fill === 'none' || fill === 'transparent' || fill.startsWith('url(')) {
    return null
  }

  if (fill.startsWith('#')) {
    let hex = fill.slice(1)
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map((ch) => ch + ch)
        .join('')
    }
    if (hex.length === 8) hex = hex.slice(0, 6)
    if (!/^[0-9a-f]{6}$/.test(hex)) return null
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    return rgbToHsl(r, g, b)
  }

  const rgb = fill.match(
    /^rgba?\(\s*([0-9.]+%?)\s*,\s*([0-9.]+%?)\s*,\s*([0-9.]+%?)/,
  )
  if (rgb) {
    const to255 = (v: string) =>
      v.endsWith('%') ? (parseFloat(v) / 100) * 255 : parseFloat(v)
    return rgbToHsl(to255(rgb[1]), to255(rgb[2]), to255(rgb[3]))
  }

  const named = NAMED[fill]
  if (named) return parseFillColor(named)

  return null
}

export function hslCss({ h, s, l }: HslColor): string {
  return `hsl(${h.toFixed(1)}, ${clamp(s, 0, 100).toFixed(1)}%, ${clamp(l, 0, 100).toFixed(1)}%)`
}
