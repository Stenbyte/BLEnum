export type SvgValidationResult = {
  ok: boolean
  errors: string[]
  warnings: string[]
  doc: Document | null
}

export const SVG_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  minShapes: 3,
  maxShapes: 500,
  minPaintBuckets: 2,
}

const PAINTABLE = new Set(['path', 'polygon', 'rect', 'circle', 'ellipse'])

export function countPaintable(doc: Document): number {
  let n = 0
  for (const tag of PAINTABLE) {
    n += doc.getElementsByTagName(tag).length
  }
  return n
}

export function validateSvgText(
  text: string,
  opts: { fileName?: string; byteLength?: number } = {},
): SvgValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (opts.fileName && !opts.fileName.toLowerCase().endsWith('.svg')) {
    errors.push('File must be an .svg')
  }

  const bytes = opts.byteLength ?? new TextEncoder().encode(text).length
  if (bytes <= 0) errors.push('File is empty')
  if (bytes > SVG_LIMITS.maxBytes) {
    errors.push(`File too large (max ${SVG_LIMITS.maxBytes / 1024 / 1024} MB)`)
  }

  if (errors.length) return { ok: false, errors, warnings, doc: null }

  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    errors.push('SVG XML could not be parsed')
    return { ok: false, errors, warnings, doc: null }
  }

  const svg = doc.documentElement
  if (!svg || svg.tagName.toLowerCase() !== 'svg') {
    errors.push('Root element must be <svg>')
    return { ok: false, errors, warnings, doc: null }
  }

  if (doc.getElementsByTagName('script').length > 0) {
    errors.push('SVG must not contain <script>')
  }
  if (doc.getElementsByTagName('foreignObject').length > 0) {
    errors.push('SVG must not contain <foreignObject>')
  }

  const hrefs = [...doc.querySelectorAll('[href], [xlink\\:href]')]
  for (const el of hrefs) {
    const href =
      el.getAttribute('href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
    if (href && /^(https?:|\/\/)/i.test(href)) {
      errors.push('SVG must not reference external URLs')
      break
    }
  }

  const viewBox = svg.getAttribute('viewBox')
  const width = svg.getAttribute('width')
  const height = svg.getAttribute('height')
  if (!viewBox && !(width && height)) {
    errors.push('SVG needs a viewBox (or width and height)')
  }

  const shapeCount = countPaintable(doc)
  if (shapeCount < SVG_LIMITS.minShapes) {
    errors.push(`Need at least ${SVG_LIMITS.minShapes} paintable shapes (path/polygon/rect/…)`)
  }
  if (shapeCount > SVG_LIMITS.maxShapes) {
    errors.push(`Too many shapes (max ${SVG_LIMITS.maxShapes})`)
  }

  if (doc.getElementsByTagName('image').length > 0) {
    warnings.push('Embedded <image> elements are ignored — only vector shapes paint')
  }
  const onlyPatternFills =
    countPaintable(doc) > 0 &&
    [...doc.querySelectorAll('path, polygon, rect, circle, ellipse')].every((el) => {
      const fill = (el.getAttribute('fill') || '').trim().toLowerCase()
      return !fill || fill === 'none' || fill.startsWith('url(')
    })
  if (onlyPatternFills && doc.getElementsByTagName('image').length > 0) {
    errors.push(
      'This SVG is a raster wrapper (embedded image), not vector paints. Export path/polygon/rect shapes with solid fills, or use a traced SVG.',
    )
  }
  if (doc.querySelector('[transform]')) {
    warnings.push('Some shapes use transform — centroids/paths may be approximate')
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    doc: errors.length === 0 ? doc : null,
  }
}
