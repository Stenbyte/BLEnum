import * as THREE from 'three'
import {
  assignPaintsToDevices,
  type PaintShareMode,
} from '../art/regions'

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

type MeshRevealEntry = {
  mesh: THREE.Mesh
  paintNumber: number
  slots: MaterialSlot[]
  contour: number
  reveal: number
}

/**
 * Per-mesh reveal like 2D: blank white → ink contours → color.
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
  /** Min color reveal 0–1 (contours alone do not count). */
  readonly minReveal: number
  /** Min of contour progress — drives early mood / visibility. */
  readonly minContour: number
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

/**
 * contour 0 + reveal 0 → invisible (true white canvas).
 * contour up → gray ink silhouette.
 * reveal up → original paint + textures.
 */
function applyStage(slot: MaterialSlot, contour: number, reveal: number): void {
  const mat = slot.material
  const visible = Math.max(contour, reveal)

  if (visible < 0.01) {
    // Blank canvas — nothing drawn
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
    // Contour / ink only — flat gray form, no textures
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
    // Color paint over ink
    mat.color.copy(INK).lerp(slot.baseColor, reveal)
    mat.emissive.copy(slot.baseEmissive).multiplyScalar(reveal)
    mat.emissiveIntensity = slot.baseEmissiveIntensity * reveal
    mat.opacity =
      slot.baseOpacity *
      Math.min(1, 0.55 + contour * 0.2 + reveal * 0.45)
    mat.transparent = slot.baseTransparent || mat.opacity < 0.99
    mat.depthWrite = mat.opacity > 0.85
    mat.roughness =
      1 + (slot.baseRoughness - 1) * reveal
    mat.metalness = slot.baseMetalness * reveal
    if (reveal > 0.15) restoreMaps(mat, slot.maps)
    else stripMaps(mat)
  }

  mat.needsUpdate = true
}

export function createMeshReveal(): MeshRevealController {
  let entries: MeshRevealEntry[] = []
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
      const meshes: THREE.Mesh[] = []
      root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) meshes.push(obj)
      })

      meshes.forEach((mesh, index) => {
        const list = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material]
        const slots: MaterialSlot[] = []

        for (const raw of list) {
          const clone = toStandardClone(raw)
          if (!clone) continue
          const maps = collectMaps(clone)
          slots.push({
            material: clone,
            baseColor: clone.color.clone(),
            baseEmissive: clone.emissive.clone(),
            baseEmissiveIntensity: clone.emissiveIntensity,
            baseOpacity: clone.opacity,
            baseTransparent: clone.transparent,
            baseRoughness: clone.roughness,
            baseMetalness: clone.metalness,
            maps,
          })
          applyStage(slots[slots.length - 1], 0, 0)
        }

        if (slots.length === 0) return

        mesh.material =
          slots.length === 1
            ? slots[0].material
            : slots.map((s) => s.material)

        // Hide until first contour — avoids one-frame flash of gray
        mesh.visible = false

        entries.push({
          mesh,
          paintNumber: index + 1,
          slots,
          contour: 0,
          reveal: 0,
        })
      })
    },
    tick(dt, nearKeys, shareMode, breathByDeviceId) {
      if (entries.length === 0) {
        minReveal = 0
        minContour = 0
        return 0
      }

      const paintNumbers = entries.map((e) => e.paintNumber)
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

        entry.mesh.visible = entry.contour > 0.01 || entry.reveal > 0.01
        for (const slot of entry.slots) {
          applyStage(slot, entry.contour, entry.reveal)
        }
        minR = Math.min(minR, entry.reveal)
        minC = Math.min(minC, entry.contour)
      }

      minReveal = entries.length ? minR : 0
      minContour = entries.length ? minC : 0
      return minReveal
    },
  }
}
