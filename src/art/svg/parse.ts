import type { Artwork, Region, ViewBox } from '../regions'
import { colorKey, parseFillColor } from './color'
import { SVG_LIMITS, validateSvgText } from './validate'

const PAINTABLE_SELECTOR = 'path, polygon, rect, circle, ellipse'

export type ParseSvgResult =
  | { ok: true; artwork: Artwork }
  | { ok: false; errors: string[]; warnings: string[] }

function parseViewBox(svg: SVGSVGElement): ViewBox | null {
  const vb = svg.getAttribute('viewBox')
  if (vb) {
    const parts = vb
      .trim()
      .split(/[\s,]+/)
      .map(Number)
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n)) && parts[2] > 0 && parts[3] > 0) {
      return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] }
    }
  }
  const width = parseFloat(svg.getAttribute('width') || '')
  const height = parseFloat(svg.getAttribute('height') || '')
  if (width > 0 && height > 0) return { x: 0, y: 0, w: width, h: height }
  return null
}

function elementToPath2D(el: Element): Path2D | null {
  const tag = el.tagName.toLowerCase()
  try {
    if (tag === 'path') {
      const d = el.getAttribute('d')
      if (!d) return null
      return new Path2D(d)
    }
    if (tag === 'rect') {
      const x = parseFloat(el.getAttribute('x') || '0')
      const y = parseFloat(el.getAttribute('y') || '0')
      const w = parseFloat(el.getAttribute('width') || '0')
      const h = parseFloat(el.getAttribute('height') || '0')
      if (!(w > 0 && h > 0)) return null
      const p = new Path2D()
      const rx = parseFloat(el.getAttribute('rx') || '0')
      const ry = parseFloat(el.getAttribute('ry') || el.getAttribute('rx') || '0')
      if (rx > 0 || ry > 0) {
        // Path2D has roundRect in modern browsers
        if (typeof (p as Path2D & { roundRect?: Function }).roundRect === 'function') {
          ;(p as Path2D & { roundRect: Function }).roundRect(x, y, w, h, [rx, ry])
        } else {
          p.rect(x, y, w, h)
        }
      } else {
        p.rect(x, y, w, h)
      }
      return p
    }
    if (tag === 'polygon') {
      const points = el.getAttribute('points')
      if (!points) return null
      const nums = points
        .trim()
        .split(/[\s,]+/)
        .map(Number)
        .filter((n) => Number.isFinite(n))
      if (nums.length < 6) return null
      let d = `M ${nums[0]} ${nums[1]}`
      for (let i = 2; i < nums.length; i += 2) {
        d += ` L ${nums[i]} ${nums[i + 1]}`
      }
      d += ' Z'
      return new Path2D(d)
    }
    if (tag === 'circle') {
      const cx = parseFloat(el.getAttribute('cx') || '0')
      const cy = parseFloat(el.getAttribute('cy') || '0')
      const r = parseFloat(el.getAttribute('r') || '0')
      if (!(r > 0)) return null
      const p = new Path2D()
      p.arc(cx, cy, r, 0, Math.PI * 2)
      return p
    }
    if (tag === 'ellipse') {
      const cx = parseFloat(el.getAttribute('cx') || '0')
      const cy = parseFloat(el.getAttribute('cy') || '0')
      const rx = parseFloat(el.getAttribute('rx') || '0')
      const ry = parseFloat(el.getAttribute('ry') || '0')
      if (!(rx > 0 && ry > 0)) return null
      const p = new Path2D()
      p.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
      return p
    }
  } catch {
    return null
  }
  return null
}

function measureCentroid(
  el: Element,
  viewBox: ViewBox,
): { cx: number; cy: number } {
  try {
    const geo = el as SVGGraphicsElement
    if (typeof geo.getBBox === 'function') {
      const box = geo.getBBox()
      if (box.width > 0 || box.height > 0) {
        return { cx: box.x + box.width / 2, cy: box.y + box.height / 2 }
      }
    }
  } catch {
    // fall through
  }
  return { cx: viewBox.x + viewBox.w / 2, cy: viewBox.y + viewBox.h / 2 }
}

function resolveFill(el: Element): ReturnType<typeof parseFillColor> {
  const attr = el.getAttribute('fill')
  if (attr) return parseFillColor(attr)
  const style = el.getAttribute('style')
  if (style) {
    const m = style.match(/fill\s*:\s*([^;]+)/i)
    if (m) return parseFillColor(m[1])
  }
  return null
}

function paintNumberFor(
  el: Element,
  fill: NonNullable<ReturnType<typeof parseFillColor>>,
  bucketMap: Map<string, number>,
  nextPaint: { n: number },
): number {
  const explicit = el.getAttribute('data-paint')
  if (explicit && /^\d+$/.test(explicit)) {
    return Number(explicit)
  }
  const key = colorKey(fill)
  const existing = bucketMap.get(key)
  if (existing !== undefined) return existing
  const n = nextPaint.n++
  bucketMap.set(key, n)
  return n
}

/**
 * Validate + parse SVG markup into Artwork regions.
 * Mounts a temporary SVG so getBBox works for label anchors.
 */
export function parseSvgArtwork(
  text: string,
  opts: { name?: string; fileName?: string; byteLength?: number } = {},
): ParseSvgResult {
  const validation = validateSvgText(text, opts)
  if (!validation.ok || !validation.doc) {
    return { ok: false, errors: validation.errors, warnings: validation.warnings }
  }

  const warnings = [...validation.warnings]
  const srcSvg = validation.doc.documentElement as unknown as SVGSVGElement
  const viewBox = parseViewBox(srcSvg)
  if (!viewBox) {
    return {
      ok: false,
      errors: ['Could not read viewBox / size'],
      warnings,
    }
  }

  // Live mount for accurate getBBox
  const mount = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  mount.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`)
  mount.style.cssText = 'position:absolute;left:-99999px;top:-99999px;width:0;height:0;overflow:hidden'
  mount.innerHTML = srcSvg.innerHTML
  document.body.appendChild(mount)

  try {
    const shapes = [...mount.querySelectorAll(PAINTABLE_SELECTOR)]
    const bucketMap = new Map<string, number>()
    const nextPaint = { n: 1 }
    // Prefer explicit data-paint max so auto ids don't collide
    for (const el of shapes) {
      const d = el.getAttribute('data-paint')
      if (d && /^\d+$/.test(d)) nextPaint.n = Math.max(nextPaint.n, Number(d) + 1)
    }

    const regions: Region[] = []
    let skipped = 0

    for (const el of shapes) {
      const fill = resolveFill(el)
      if (!fill) {
        skipped++
        continue
      }
      const path = elementToPath2D(el)
      if (!path) {
        skipped++
        continue
      }
      const paintNumber = paintNumberFor(el, fill, bucketMap, nextPaint)
      const { cx, cy } = measureCentroid(el, viewBox)
      const id = regions.length + 1
      regions.push({
        id,
        label: String(paintNumber),
        paintNumber,
        baseColor: fill,
        path,
        cx,
        cy,
      })
    }

    if (skipped > 0) {
      warnings.push(`Skipped ${skipped} shape(s) without usable fill/geometry`)
    }

    if (regions.length < SVG_LIMITS.minShapes) {
      return {
        ok: false,
        errors: [
          `Only ${regions.length} usable painted shapes (need ≥ ${SVG_LIMITS.minShapes})`,
        ],
        warnings,
      }
    }

    const paints = new Set(regions.map((r) => r.paintNumber))
    if (paints.size < SVG_LIMITS.minPaintBuckets) {
      warnings.push('Very few distinct paint colors — reveal may feel flat')
    }
    if (paints.size === 1) {
      return {
        ok: false,
        errors: ['Artwork needs more than one paint color'],
        warnings,
      }
    }

    const title =
      opts.name ||
      mount.querySelector('title')?.textContent?.trim() ||
      opts.fileName ||
      'Artwork'

    const artwork: Artwork = {
      name: title,
      viewBox,
      regions,
      warnings,
      mode: 'vector',
    }

    return { ok: true, artwork }
  } finally {
    mount.remove()
  }
}

export async function loadSvgFromUrl(url: string, name?: string): Promise<ParseSvgResult> {
  const res = await fetch(url)
  if (!res.ok) {
    return { ok: false, errors: [`Failed to fetch ${url} (${res.status})`], warnings: [] }
  }
  const text = await res.text()
  return parseSvgArtwork(text, { name, fileName: url.split('/').pop() })
}

export async function loadSvgFromFile(file: File): Promise<ParseSvgResult> {
  const text = await file.text()
  return parseSvgArtwork(text, {
    name: file.name.replace(/\.svg$/i, ''),
    fileName: file.name,
    byteLength: file.size,
  })
}
