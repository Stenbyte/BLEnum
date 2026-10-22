import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

/** Current test model in public/models/ */
export const FUTURE_MODEL_URL = '/models/Aero_Airship_01.glb'
export const FUTURE_MODEL_URL_2 = '/models/zombie.glb'
export const FUTURE_MODEL_URL_3 = '/models/wavenew.glb'
export const RUNNER_MODEL_URL = '/models/runner.glb'

/** Height of runner vs normalized Wave (~1 unit). */
export const RUNNER_TARGET_HEIGHT = 0.05

export type LoadedFutureModel = {
  root: THREE.Group
  animations: THREE.AnimationClip[]
}

function enableShadows(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true
      obj.receiveShadow = true
    }
  })
}

/**
 * Load a GLB, center at origin, normalize scale so framing is stable.
 */
export async function loadFutureModel(
  url = FUTURE_MODEL_URL_3,
): Promise<LoadedFutureModel> {
  const loader = new GLTFLoader()
  const gltf = await loader.loadAsync(url)
  const root = new THREE.Group()
  root.name = 'future-glb'
  root.add(gltf.scene)
  enableShadows(root)

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

/**
 * Load quay runner: feet on y=0, scaled to sit beside normalized Wave.
 */
export async function loadRunnerModel(
  url = RUNNER_MODEL_URL,
  targetHeight = RUNNER_TARGET_HEIGHT,
): Promise<LoadedFutureModel> {
  const loader = new GLTFLoader()
  const gltf = await loader.loadAsync(url)
  const root = new THREE.Group()
  root.name = 'quay-runner'
  root.add(gltf.scene)
  enableShadows(root)

  const size = new THREE.Vector3()
  new THREE.Box3().setFromObject(root).getSize(size)
  const h = Math.max(size.y, 0.001)
  root.scale.setScalar(targetHeight / h)

  // After scale: center XZ, plant feet on y = 0
  const box = new THREE.Box3().setFromObject(root)
  const center = new THREE.Vector3()
  box.getCenter(center)
  root.position.x -= center.x
  root.position.z -= center.z
  root.position.y -= box.min.y

  return {
    root,
    animations: gltf.animations ?? [],
  }
}
