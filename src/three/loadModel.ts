import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

/** Current test model in public/models/ */
export const FUTURE_MODEL_URL = '/models/Aero_Airship_01.glb'
export const FUTURE_MODEL_URL_2 = '/models/zombie.glb'

export type LoadedFutureModel = {
  root: THREE.Group
  animations: THREE.AnimationClip[]
}

/**
 * Load a GLB, center at origin, normalize scale so framing is stable.
 */
export async function loadFutureModel(
  url = FUTURE_MODEL_URL_2,
): Promise<LoadedFutureModel> {
  const loader = new GLTFLoader()
  const gltf = await loader.loadAsync(url)
  const root = new THREE.Group()
  root.name = 'future-glb'
  root.add(gltf.scene)

  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true
      obj.receiveShadow = true
    }
  })

  // Center on origin first
  const box = new THREE.Box3().setFromObject(root)
  const size = new THREE.Vector3()
  const center = new THREE.Vector3()
  box.getSize(size)
  box.getCenter(center)
  root.position.sub(center)

  // Normalize so largest axis ≈ 1 (camera framing does the rest)
  box.setFromObject(root)
  box.getSize(size)
  const maxDim = Math.max(size.x, size.y, size.z, 0.001)
  root.scale.setScalar(1 / maxDim)
  root.position.multiplyScalar(1 / maxDim)

  return {
    root,
    animations: gltf.animations ?? [],
  }
}
