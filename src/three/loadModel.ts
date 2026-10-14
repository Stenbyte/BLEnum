import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

/** Current test model in public/models/ */
export const FUTURE_MODEL_URL = '/models/Aero_Airship_01.glb'

/**
 * Load a GLB and normalize it (centered, grounded, scaled into a hero box).
 * Throws if the file is missing or fails.
 */
export async function loadFutureModel(
  url = FUTURE_MODEL_URL,
): Promise<THREE.Group> {
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

  const box = new THREE.Box3().setFromObject(root)
  const size = new THREE.Vector3()
  const center = new THREE.Vector3()
  box.getSize(size)
  box.getCenter(center)

  const maxDim = Math.max(size.x, size.y, size.z, 0.001)
  const scale = 8 / maxDim
  root.scale.setScalar(scale)

  box.setFromObject(root)
  box.getCenter(center)
  root.position.x -= center.x
  root.position.z -= center.z
  root.position.y -= box.min.y

  return root
}
