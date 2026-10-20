import * as THREE from 'three'
import {
  assignPaintsToDevices,
  DEVICE_CAP,
  type PaintShareMode,
} from '../art/regions'
import {
  colorKeyFromThree,
  readTexturePixels,
  regroupGeometryByPaint,
} from './texturePaints'

/** Same bar as 2D photo blend — mesh “colored enough”. */
export const MESH_COLOR_COMPLETE = 0.82

/** Contour must reach this before color starts (same idea as 2D). */
const COLOR_AFTER_CONTOUR = 0.35

/** Ink gray for contour stage — form without paint. */
const INK = new THREE.Color(0x5a5a5a)
const WHITE = new THREE.Color(0xffffff)

type MapSlot = {
  key: 'map' | 'emissiveMap' | 'roughnessMap' | 'metalnessMap' | 'aoMap' | 'normalMap'
  tex: THREE.Texture | null
}

type MaterialSlot = {
  material: THREE.MeshStandardMaterial
  baseColor: THREE.Color
  baseEmissive: THREE.Color
  baseEmissiveIntensity: number
  baseOpacity: number
  baseTransparent: boolean
  baseRoughness: number
  baseMetalness: number
  maps: MapSlot[]
}

/** One paintable region = one material (texture color cluster or mat slot). */
type PaintEntry = {
  mesh: THREE.Mesh
  paintNumber: number
  slot: MaterialSlot
  contour: number
  reveal: number
}

/**
 * Per-region reveal like 2D: blank white → ink → color.
 * Paint slots come from materials / texture color regions (not whole meshes).
 */
export type MeshRevealController = {
  reset: (root: THREE.Object3D) => void
  clear: () => void
  tick: (
    dt: number,
    nearKeys: string[],
    shareMode: PaintShareMode,
    breathByDeviceId: Map<string, number>,
  ) => number
  readonly colorComplete: boolean
  readonly minReveal: number
  readonly minContour: number
  /** Paint region count (materials / texture clusters). */
  readonly meshCount: number
}

const MAP_KEYS: MapSlot['key'][] = [
  'map',
  'emissiveMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'normalMap',
]

function toStandardClone(mat: THREE.Material): THREE.MeshStandardMaterial | null {
  if (
    mat instanceof THREE.MeshStandardMaterial ||
    mat instanceof THREE.MeshPhysicalMaterial
  ) {
    return mat.clone()
  }
  if (
    mat instanceof THREE.MeshBasicMaterial ||
    mat instanceof THREE.MeshLambertMaterial ||
    mat instanceof THREE.MeshPhongMaterial
  ) {
    const std = new THREE.MeshStandardMaterial()
    std.color.copy(mat.color)
    std.map = mat.map
    std.transparent = mat.transparent
    std.opacity = mat.opacity
    std.side = mat.side
    std.alphaTest = mat.alphaTest
    if ('emissive' in mat && mat.emissive) {
      std.emissive.copy(mat.emissive as THREE.Color)
    }
    return std
  }
  return null
}

function collectMaps(mat: THREE.MeshStandardMaterial): MapSlot[] {
  return MAP_KEYS.map((key) => ({
    key,
    tex: (mat[key] as THREE.Texture | null) ?? null,
  }))
}

function stripMaps(mat: THREE.MeshStandardMaterial): void {
  for (const key of MAP_KEYS) mat[key] = null
}

function restoreMaps(mat: THREE.MeshStandardMaterial, maps: MapSlot[]): void {
  for (const { key, tex } of maps) mat[key] = tex
}

function makeSlot(clone: THREE.MeshStandardMaterial): MaterialSlot {
  return {
    material: clone,
    baseColor: clone.color.clone(),
    baseEmissive: clone.emissive.clone(),
    baseEmissiveIntensity: clone.emissiveIntensity,
    baseOpacity: clone.opacity,
    baseTransparent: clone.transparent,
    baseRoughness: clone.roughness,
    baseMetalness: clone.metalness,
    maps: collectMaps(clone),
  }
}

function applyStage(slot: MaterialSlot, contour: number, reveal: number): void {
  const mat = slot.material
  const visible = Math.max(contour, reveal)

  if (visible < 0.01) {
    mat.color.copy(WHITE)
    mat.emissive.setRGB(0, 0, 0)
    mat.emissiveIntensity = 0
    mat.opacity = 0
    mat.transparent = true
    mat.depthWrite = false
    mat.roughness = 1
    mat.metalness = 0
    stripMaps(mat)
    mat.needsUpdate = true
    return
  }

  if (reveal < 0.02) {
    mat.color.copy(INK)
    mat.emissive.setRGB(0, 0, 0)
    mat.emissiveIntensity = 0
    mat.opacity = Math.min(0.92, contour * 0.95)
    mat.transparent = true
    mat.depthWrite = mat.opacity > 0.5
    mat.roughness = 1
    mat.metalness = 0
    stripMaps(mat)
  } else {
    mat.color.copy(INK).lerp(slot.baseColor, reveal)
    mat.emissive.copy(slot.baseEmissive).multiplyScalar(reveal)
    mat.emissiveIntensity = slot.baseEmissiveIntensity * reveal
    mat.opacity =
      slot.baseOpacity *
      Math.min(1, 0.55 + contour * 0.2 + reveal * 0.45)
    mat.transparent = slot.baseTransparent || mat.opacity < 0.99
    mat.depthWrite = mat.opacity > 0.85
    mat.roughness = 1 + (slot.baseRoughness - 1) * reveal
    mat.metalness = slot.baseMetalness * reveal
    if (reveal > 0.15) restoreMaps(mat, slot.maps)
    else stripMaps(mat)
  }

  mat.needsUpdate = true
}

/**
 * Turn one mesh into one-or-more paint materials (texture clusters when possible).
 */
function paintsForMesh(
  mesh: THREE.Mesh,
  ensurePaint: (key: string) => number,
): PaintEntry[] {
  const rawList = Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material]
  const geo = mesh.geometry
  if (!geo) return []

  const multi =
    rawList.length > 1 && geo.groups.length >= rawList.length

  // Multi-material mesh: one paint per existing material slot (shared by color key)
  if (multi) {
    const slots: MaterialSlot[] = []
    const entries: PaintEntry[] = []
    rawList.forEach((raw, i) => {
      const clone = toStandardClone(raw)
      if (!clone) return
      // One Crowd slot per material on this mesh
      const key = `mesh:${mesh.uuid}:mat:${i}:${clone.name || colorKeyFromThree(clone.color)}`

      const slot = makeSlot(clone)
      applyStage(slot, 0, 0)
      slots.push(slot)
      entries.push({
        mesh,
        paintNumber: ensurePaint(key),
        slot,
        contour: 0,
        reveal: 0,
      })
    })
    if (slots.length === 0) return []
    mesh.material = slots.length === 1 ? slots[0].material : slots.map((s) => s.material)
    mesh.visible = false
    return entries
  }

  // Single material: split faces by texture color regions (zombie path)
  const raw = rawList[0]
  const baseClone = toStandardClone(raw)
  if (!baseClone) return []

  const mapPixels = readTexturePixels(baseClone.map)
  const solidKey = colorKeyFromThree(baseClone.color)
  const regionKeys = regroupGeometryByPaint(geo, {
    mapPixels,
    solidKey,
    maxPaints: DEVICE_CAP,
  })

  const slots: MaterialSlot[] = []
  const entries: PaintEntry[] = []
  for (const regionKey of regionKeys) {
    const clone = baseClone.clone()
    const slot = makeSlot(clone)
    applyStage(slot, 0, 0)
    slots.push(slot)
    entries.push({
      mesh,
      paintNumber: ensurePaint(regionKey),
      slot,
      contour: 0,
      reveal: 0,
    })
  }

  mesh.material =
    slots.length === 1 ? slots[0].material : slots.map((s) => s.material)
  mesh.visible = false
  return entries
}

export function createMeshReveal(): MeshRevealController {
  let entries: PaintEntry[] = []
  let minReveal = 0
  let minContour = 0

  return {
    get colorComplete() {
      return entries.length > 0 && minReveal >= MESH_COLOR_COMPLETE
    },
    get minReveal() {
      return minReveal
    },
    get minContour() {
      return minContour
    },
    get meshCount() {
      return entries.length
    },
    clear() {
      entries = []
      minReveal = 0
      minContour = 0
    },
    reset(root) {
      entries = []
      minReveal = 0
      minContour = 0

      const keyToPaint = new Map<string, number>()
      const ensurePaint = (key: string): number => {
        let n = keyToPaint.get(key)
        if (n === undefined) {
          n = keyToPaint.size + 1
          keyToPaint.set(key, n)
        }
        return n
      }

      const meshes: THREE.Mesh[] = []
      root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) meshes.push(obj)
      })

      for (const mesh of meshes) {
        entries.push(...paintsForMesh(mesh, ensurePaint))
      }
    },
    tick(dt, nearKeys, shareMode, breathByDeviceId) {
      if (entries.length === 0) {
        minReveal = 0
        minContour = 0
        return 0
      }

      const paintNumbers = [
        ...new Set(entries.map((e) => e.paintNumber)),
      ].sort((a, b) => a - b)
      const assigned = assignPaintsToDevices(nearKeys, paintNumbers, shareMode)

      const energy = new Map<number, number>()
      for (const key of nearKeys) {
        const paints = assigned.get(key) ?? []
        const id = key.split(':')[0] ?? key
        const breath = breathByDeviceId.get(id) ?? 0.35
        for (const p of paints) {
          energy.set(p, Math.max(energy.get(p) ?? 0, breath))
        }
      }

      const meshLive = new Map<THREE.Mesh, boolean>()
      let minR = 1
      let minC = 1

      for (const entry of entries) {
        const live = energy.get(entry.paintNumber)
        if (live !== undefined && live > 0) {
          const rate = Math.max(0.55, 0.35 + live * 1.1)
          entry.contour = Math.min(1, entry.contour + dt * rate * 1.6)
          if (entry.contour >= COLOR_AFTER_CONTOUR) {
            entry.reveal = Math.min(1, entry.reveal + dt * rate * 1.8)
          }
        } else {
          if (entry.reveal > 0) {
            entry.reveal = Math.max(0, entry.reveal - dt * 0.35)
          } else {
            entry.contour = Math.max(0, entry.contour - dt * 0.35 * 0.65)
          }
        }

        applyStage(entry.slot, entry.contour, entry.reveal)
        if (entry.contour > 0.01 || entry.reveal > 0.01) {
          meshLive.set(entry.mesh, true)
        } else if (!meshLive.has(entry.mesh)) {
          meshLive.set(entry.mesh, false)
        }

        minR = Math.min(minR, entry.reveal)
        minC = Math.min(minC, entry.contour)
      }

      for (const [mesh, live] of meshLive) {
        mesh.visible = live
      }

      minReveal = entries.length ? minR : 0
      minContour = entries.length ? minC : 0
      return minReveal
    },
  }
}
