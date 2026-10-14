import * as THREE from 'three'
import {
  assignPaintsToDevices,
  type PaintShareMode,
} from '../art/regions'

/** Same bar as 2D photo blend — mesh “colored enough”. */
export const MESH_COLOR_COMPLETE = 0.82

const MUTED = new THREE.Color(0x9a9a9a)

type MeshRevealEntry = {
  mesh: THREE.Mesh
  paintNumber: number
  materials: THREE.MeshStandardMaterial[]
  baseColors: THREE.Color[]
  baseEmissive: THREE.Color[]
  baseEmissiveIntensity: number[]
  reveal: number
}

/**
 * Per-mesh color reveal for a GLB.
 * Cover / Crowd assign paint slots like 2D; materials lerp muted → original.
 */
export type MeshRevealController = {
  reset: (root: THREE.Object3D) => void
  clear: () => void
  /** Update reveals from near device keys; returns min reveal 0–1. */
  tick: (
    dt: number,
    nearKeys: string[],
    shareMode: PaintShareMode,
    breathByDeviceId: Map<string, number>,
  ) => number
  readonly colorComplete: boolean
  readonly minReveal: number
  readonly meshCount: number
}

function asStandardMaterials(
  mat: THREE.Material | THREE.Material[],
): THREE.MeshStandardMaterial[] {
  const list = Array.isArray(mat) ? mat : [mat]
  return list.filter(
    (m): m is THREE.MeshStandardMaterial =>
      m instanceof THREE.MeshStandardMaterial ||
      m instanceof THREE.MeshPhysicalMaterial,
  )
}

export function createMeshReveal(): MeshRevealController {
  let entries: MeshRevealEntry[] = []
  let minReveal = 0

  return {
    get colorComplete() {
      return entries.length > 0 && minReveal >= MESH_COLOR_COMPLETE
    },
    get minReveal() {
      return minReveal
    },
    get meshCount() {
      return entries.length
    },
    clear() {
      entries = []
      minReveal = 0
    },
    reset(root) {
      entries = []
      minReveal = 0
      const meshes: THREE.Mesh[] = []
      root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) meshes.push(obj)
      })

      meshes.forEach((mesh, index) => {
        const materials = asStandardMaterials(mesh.material).map((m) => {
          const clone = m.clone()
          return clone
        })
        if (materials.length === 0) return

        // Swap mesh to clones so we can mutate without touching shared GLB mats
        mesh.material =
          materials.length === 1 ? materials[0] : materials

        const baseColors = materials.map((m) => m.color.clone())
        const baseEmissive = materials.map((m) => m.emissive.clone())
        const baseEmissiveIntensity = materials.map((m) => m.emissiveIntensity)

        for (const m of materials) {
          m.color.copy(MUTED)
          m.emissive.setRGB(0, 0, 0)
          m.emissiveIntensity = 0
          m.needsUpdate = true
        }

        entries.push({
          mesh,
          paintNumber: index + 1,
          materials,
          baseColors,
          baseEmissive,
          baseEmissiveIntensity,
          reveal: 0,
        })
      })
    },
    tick(dt, nearKeys, shareMode, breathByDeviceId) {
      if (entries.length === 0) {
        minReveal = 0
        return 0
      }

      const paintNumbers = entries.map((e) => e.paintNumber)
      const assigned = assignPaintsToDevices(nearKeys, paintNumbers, shareMode)

      // paintNumber → max breath among devices that own it
      const energy = new Map<number, number>()
      for (const key of nearKeys) {
        const paints = assigned.get(key) ?? []
        // breath map is keyed by device id without manufacturer — match prefix
        const id = key.split(':')[0] ?? key
        const breath = breathByDeviceId.get(id) ?? 0.35
        for (const p of paints) {
          energy.set(p, Math.max(energy.get(p) ?? 0, breath))
        }
      }

      let min = 1
      for (const entry of entries) {
        const live = energy.get(entry.paintNumber)
        if (live !== undefined && live > 0) {
          const rate = 0.45 + live * 1.1
          entry.reveal = Math.min(1, entry.reveal + dt * rate)
        } else {
          entry.reveal = Math.max(0, entry.reveal - dt * 0.35)
        }

        const t = entry.reveal
        for (let i = 0; i < entry.materials.length; i++) {
          const mat = entry.materials[i]
          mat.color.copy(MUTED).lerp(entry.baseColors[i], t)
          mat.emissive.copy(entry.baseEmissive[i]).multiplyScalar(t)
          mat.emissiveIntensity = entry.baseEmissiveIntensity[i] * t
        }
        min = Math.min(min, entry.reveal)
      }

      minReveal = entries.length ? min : 0
      return minReveal
    },
  }
}
