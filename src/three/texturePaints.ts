import * as THREE from 'three'
import { DEVICE_CAP } from '../art/regions'

/** Soft quantize — same idea as 2D raster paints. */
function q8(v: number): number {
  return Math.min(255, Math.round(v / 24) * 24)
}

export function colorKey(r: number, g: number, b: number): string {
  return `${q8(r)},${q8(g)},${q8(b)}`
}

export function colorKeyFromThree(c: THREE.Color): string {
  return colorKey(
    Math.round(c.r * 255),
    Math.round(c.g * 255),
    Math.round(c.b * 255),
  )
}

const SAMPLE_MAX = 512
const MIN_FACE_FRAC = 0.004

/**
 * Pull CPU pixels from a Three texture (after GLTF load).
 * Returns null if image not ready / not sampleable.
 */
export function readTexturePixels(
  tex: THREE.Texture | null | undefined,
): { pixels: Uint8ClampedArray; w: number; h: number; flipY: boolean } | null {
  if (!tex?.image) return null
  const img = tex.image as {
    width?: number
    height?: number
    naturalWidth?: number
    naturalHeight?: number
  }
  const iw = img.naturalWidth || img.width || 0
  const ih = img.naturalHeight || img.height || 0
  if (!(iw > 0 && ih > 0)) return null

  const scale = Math.min(1, SAMPLE_MAX / Math.max(iw, ih))
  const w = Math.max(1, Math.round(iw * scale))
  const h = Math.max(1, Math.round(ih * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  try {
    ctx.drawImage(tex.image as CanvasImageSource, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h)
    return { pixels: data.data, w, h, flipY: tex.flipY }
  } catch {
    // CORS / tainted canvas
    return null
  }
}

function samplePixel(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  u: number,
  v: number,
  flipY: boolean,
): [number, number, number, number] {
  let uu = u - Math.floor(u)
  let vv = v - Math.floor(v)
  if (uu < 0) uu += 1
  if (vv < 0) vv += 1
  if (flipY) vv = 1 - vv
  const x = Math.min(w - 1, Math.max(0, Math.floor(uu * w)))
  const y = Math.min(h - 1, Math.max(0, Math.floor(vv * h)))
  const i = (y * w + x) * 4
  return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]]
}

type FacePaint = {
  i0: number
  i1: number
  i2: number
  key: string
}

/**
 * Build contiguous geometry.groups by texture color (or solid material color).
 * Mutates geometry index order so each paint is one draw group.
 * Returns paint color-keys in material-index order (1 key per group).
 */
export function regroupGeometryByPaint(
  geometry: THREE.BufferGeometry,
  opts: {
    mapPixels: ReturnType<typeof readTexturePixels>
    solidKey: string
    maxPaints?: number
  },
): string[] {
  const maxPaints = opts.maxPaints ?? DEVICE_CAP
  const uvAttr = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute
  if (!posAttr) return [opts.solidKey]

  const indexed = geometry.index !== null
  const triCount = indexed
    ? Math.floor(geometry.index!.count / 3)
    : Math.floor(posAttr.count / 3)
  if (triCount <= 0) return [opts.solidKey]

  const faces: FacePaint[] = []
  const counts = new Map<string, number>()

  for (let t = 0; t < triCount; t++) {
    let i0: number
    let i1: number
    let i2: number
    if (indexed) {
      const idx = geometry.index!
      i0 = idx.getX(t * 3)
      i1 = idx.getX(t * 3 + 1)
      i2 = idx.getX(t * 3 + 2)
    } else {
      i0 = t * 3
      i1 = t * 3 + 1
      i2 = t * 3 + 2
    }

    let key = opts.solidKey
    if (opts.mapPixels && uvAttr) {
      const u =
        (uvAttr.getX(i0) + uvAttr.getX(i1) + uvAttr.getX(i2)) / 3
      const v =
        (uvAttr.getY(i0) + uvAttr.getY(i1) + uvAttr.getY(i2)) / 3
      const [r, g, b, a] = samplePixel(
        opts.mapPixels.pixels,
        opts.mapPixels.w,
        opts.mapPixels.h,
        u,
        v,
        opts.mapPixels.flipY,
      )
      if (a >= 16) key = colorKey(r, g, b)
    }

    faces.push({ i0, i1, i2, key })
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  // Keep largest regions; tiny face clusters merge into nearest kept key
  let kept = [...counts.entries()]
    .filter(([, n]) => n / triCount >= MIN_FACE_FRAC)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)

  if (kept.length === 0) kept = [opts.solidKey]
  if (kept.length > maxPaints) kept = kept.slice(0, maxPaints)
  const keptSet = new Set(kept)

  const fallback = kept[0]
  for (const face of faces) {
    if (!keptSet.has(face.key)) face.key = fallback
  }

  // Contiguous groups: reorder faces by paint key order
  const byKey = new Map<string, FacePaint[]>()
  for (const k of kept) byKey.set(k, [])
  for (const face of faces) {
    const list = byKey.get(face.key) ?? byKey.get(fallback)!
    list.push(face)
  }

  const orderedKeys = kept.filter((k) => (byKey.get(k)?.length ?? 0) > 0)
  const newIndices: number[] = []
  geometry.clearGroups()
  let start = 0
  orderedKeys.forEach((key, materialIndex) => {
    const list = byKey.get(key)!
    for (const f of list) {
      newIndices.push(f.i0, f.i1, f.i2)
    }
    const count = list.length * 3
    geometry.addGroup(start, count, materialIndex)
    start += count
  })

  geometry.setIndex(newIndices)
  geometry.index!.needsUpdate = true

  return orderedKeys
}
