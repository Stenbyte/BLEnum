import type { HslColor } from '../../vibe/map'
import { rgbToHsl } from '../svg/color'
import type { Artwork, Region } from '../regions'

export type RasterLoadResult =
  | { ok: true; artwork: Artwork }
  | { ok: false; errors: string[]; warnings: string[] }

export const RASTER_LIMITS = {
  maxBytes: 8 * 1024 * 1024,
  maxDimension: 2048,
  minPaints: 2,
  maxPaints: 24,
  /** Drop colors covering fewer than this fraction of pixels */
  minCoverage: 0.002,
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode image'))
    img.src = src
  })
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function toGray(source: HTMLCanvasElement): HTMLCanvasElement {
  const gray = makeCanvas(source.width, source.height)
  const ctx = gray.getContext('2d')!
  ctx.drawImage(source, 0, 0)
  const data = ctx.getImageData(0, 0, gray.width, gray.height)
  const d = data.data
  for (let i = 0; i < d.length; i += 4) {
    const y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
    d[i] = y
    d[i + 1] = y
    d[i + 2] = y
  }
  ctx.putImageData(data, 0, 0)
  return gray
}

/** Sobel-ish edge ink on transparent — dark lines where contrast is high. */
function toEdges(gray: HTMLCanvasElement): HTMLCanvasElement {
  const w = gray.width
  const h = gray.height
  const gctx = gray.getContext('2d', { willReadFrequently: true })!
  const src = gctx.getImageData(0, 0, w, h).data
  const out = makeCanvas(w, h)
  const octx = out.getContext('2d')!
  const id = octx.createImageData(w, h)
  const d = id.data

  const lum = (x: number, y: number) => {
    const i = (y * w + x) * 4
    return src[i]
  }

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx =
        -lum(x - 1, y - 1) +
        lum(x + 1, y - 1) +
        -2 * lum(x - 1, y) +
        2 * lum(x + 1, y) +
        -lum(x - 1, y + 1) +
        lum(x + 1, y + 1)
      const gy =
        -lum(x - 1, y - 1) -
        2 * lum(x, y - 1) -
        lum(x + 1, y - 1) +
        lum(x - 1, y + 1) +
        2 * lum(x, y + 1) +
        lum(x + 1, y + 1)
      const mag = Math.min(255, Math.hypot(gx, gy))
      if (mag < 28) continue
      const i = (y * w + x) * 4
      d[i] = 28
      d[i + 1] = 30
      d[i + 2] = 36
      d[i + 3] = Math.min(220, 40 + mag)
    }
  }
  octx.putImageData(id, 0, 0)
  return out
}

function maskLayer(
  ink: HTMLCanvasElement,
  mask: HTMLCanvasElement,
): HTMLCanvasElement {
  const c = makeCanvas(ink.width, ink.height)
  const ctx = c.getContext('2d')!
  ctx.drawImage(ink, 0, 0)
  ctx.globalCompositeOperation = 'destination-in'
  ctx.drawImage(mask, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  return c
}

/** Quantize channel to reduce JPEG noise into paint buckets. */
function q8(v: number): number {
  return Math.min(255, Math.round(v / 24) * 24)
}

function colorKey(r: number, g: number, b: number): string {
  return `${q8(r)},${q8(g)},${q8(b)}`
}

type Bucket = {
  key: string
  r: number
  g: number
  b: number
  count: number
  sumR: number
  sumG: number
  sumB: number
  sumX: number
  sumY: number
}

/**
 * Build paint regions from a raster image.
 * Same colors → same paint number. White canvas; contours then color unlock.
 */
export function artworkFromImageBitmap(
  img: CanvasImageSource & { width: number; height: number },
  name: string,
): RasterLoadResult {
  const warnings: string[] = []
  let w = 'naturalWidth' in img ? (img as HTMLImageElement).naturalWidth || img.width : img.width
  let h =
    'naturalHeight' in img ? (img as HTMLImageElement).naturalHeight || img.height : img.height

  if (!(w > 0 && h > 0)) {
    return { ok: false, errors: ['Image has no dimensions'], warnings }
  }

  if (w > RASTER_LIMITS.maxDimension || h > RASTER_LIMITS.maxDimension) {
    const scale = RASTER_LIMITS.maxDimension / Math.max(w, h)
    w = Math.round(w * scale)
    h = Math.round(h * scale)
    warnings.push(`Image scaled down to ${w}×${h} for performance`)
  }

  const sourceCanvas = makeCanvas(w, h)
  const sctx = sourceCanvas.getContext('2d', { willReadFrequently: true })!
  sctx.drawImage(img as CanvasImageSource, 0, 0, w, h)
  const imageData = sctx.getImageData(0, 0, w, h)
  const px = imageData.data

  const buckets = new Map<string, Bucket>()
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const a = px[i + 3]
      if (a < 16) continue
      const key = colorKey(px[i], px[i + 1], px[i + 2])
      let b = buckets.get(key)
      if (!b) {
        b = {
          key,
          r: q8(px[i]),
          g: q8(px[i + 1]),
          b: q8(px[i + 2]),
          count: 0,
          sumR: 0,
          sumG: 0,
          sumB: 0,
          sumX: 0,
          sumY: 0,
        }
        buckets.set(key, b)
      }
      b.count++
      b.sumR += px[i]
      b.sumG += px[i + 1]
      b.sumB += px[i + 2]
      b.sumX += x
      b.sumY += y
    }
  }

  const total = w * h
  let list = [...buckets.values()]
    .filter((b) => b.count / total >= RASTER_LIMITS.minCoverage)
    .sort((a, b) => b.count - a.count)

  if (list.length > RASTER_LIMITS.maxPaints) {
    warnings.push(`Palette capped to ${RASTER_LIMITS.maxPaints} colors (was ${list.length})`)
    list = list.slice(0, RASTER_LIMITS.maxPaints)
  }

  if (list.length < RASTER_LIMITS.minPaints) {
    return {
      ok: false,
      errors: ['Need at least 2 distinct color areas in the image'],
      warnings,
    }
  }

  const keyToPaint = new Map<string, number>()
  list.forEach((b, idx) => keyToPaint.set(b.key, idx + 1))

  // Nearest-bucket remap for dropped tiny colors
  const paintKeys = list.map((b) => b.key)
  function nearestPaint(r: number, g: number, b: number): number {
    const key = colorKey(r, g, b)
    const direct = keyToPaint.get(key)
    if (direct) return direct
    let best = 1
    let bestD = Infinity
    for (let i = 0; i < list.length; i++) {
      const buck = list[i]
      const dr = q8(r) - buck.r
      const dg = q8(g) - buck.g
      const db = q8(b) - buck.b
      const d = dr * dr + dg * dg + db * db
      if (d < bestD) {
        bestD = d
        best = i + 1
      }
    }
    void paintKeys
    return best
  }

  const layers = new Map<number, ImageData>()
  const layerCtx = new Map<number, CanvasRenderingContext2D>()
  for (const b of list) {
    const paint = keyToPaint.get(b.key)!
    const c = makeCanvas(w, h)
    const cctx = c.getContext('2d', { willReadFrequently: true })!
    const id = cctx.createImageData(w, h)
    layers.set(paint, id)
    layerCtx.set(paint, cctx)
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (px[i + 3] < 16) continue
      const paint = nearestPaint(px[i], px[i + 1], px[i + 2])
      const id = layers.get(paint)!
      id.data[i] = px[i]
      id.data[i + 1] = px[i + 1]
      id.data[i + 2] = px[i + 2]
      id.data[i + 3] = 255
    }
  }

  const grayCanvas = toGray(sourceCanvas)
  const edgeCanvas = toEdges(grayCanvas)

  const regions: Region[] = []
  for (const b of list) {
    const paintNumber = keyToPaint.get(b.key)!
    const avgR = Math.round(b.sumR / b.count)
    const avgG = Math.round(b.sumG / b.count)
    const avgB = Math.round(b.sumB / b.count)
    const baseColor: HslColor = rgbToHsl(avgR, avgG, avgB)
    const layer = makeCanvas(w, h)
    const lctx = layer.getContext('2d')!
    lctx.putImageData(layers.get(paintNumber)!, 0, 0)

    regions.push({
      id: paintNumber,
      label: String(paintNumber),
      paintNumber,
      baseColor,
      cx: b.sumX / b.count,
      cy: b.sumY / b.count,
      colorLayer: layer,
      edgeLayer: maskLayer(edgeCanvas, layer),
    })
  }

  return {
    ok: true,
    artwork: {
      name,
      viewBox: { x: 0, y: 0, w, h },
      regions,
      warnings,
      sourceCanvas,
      grayCanvas,
      edgeCanvas,
      mode: 'raster',
    },
  }
}

export async function loadRasterFromUrl(
  url: string,
  name?: string,
): Promise<RasterLoadResult> {
  try {
    const img = await loadHtmlImage(url)
    return artworkFromImageBitmap(img, name || url.split('/').pop() || 'Artwork')
  } catch {
    return { ok: false, errors: [`Failed to load image: ${url}`], warnings: [] }
  }
}

export async function loadRasterFromFile(file: File): Promise<RasterLoadResult> {
  if (file.size > RASTER_LIMITS.maxBytes) {
    return {
      ok: false,
      errors: [`File too large (max ${RASTER_LIMITS.maxBytes / 1024 / 1024} MB)`],
      warnings: [],
    }
  }

  const lower = file.name.toLowerCase()
  const isSvg = lower.endsWith('.svg') || file.type === 'image/svg+xml'

  try {
    if (isSvg) {
      const text = await file.text()
      const embedded = extractEmbeddedImageDataUrl(text)
      if (!embedded) {
        return {
          ok: false,
          errors: [
            'This SVG has no embedded photo. Use a JPG/PNG, or a vector SVG with filled shapes.',
          ],
          warnings: [],
        }
      }
      const img = await loadHtmlImage(embedded)
      return artworkFromImageBitmap(img, file.name.replace(/\.svg$/i, ''))
    }

    const url = URL.createObjectURL(file)
    try {
      const img = await loadHtmlImage(url)
      return artworkFromImageBitmap(img, file.name.replace(/\.[^.]+$/, ''))
    } finally {
      URL.revokeObjectURL(url)
    }
  } catch {
    return { ok: false, errors: ['Could not read image file'], warnings: [] }
  }
}

/** Pull data:image/... out of SVG wrappers like Figma/export “SVG”. */
export function extractEmbeddedImageDataUrl(svgText: string): string | null {
  const m = svgText.match(/data:image\/(?:jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\s]+/i)
  if (!m) return null
  return m[0].replace(/\s+/g, '')
}
