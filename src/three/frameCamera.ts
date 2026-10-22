import * as THREE from 'three'

/** Wave / architecture: mostly front, clearly from above. */
export const WAVE_VIEW_DIR = new THREE.Vector3(0.12, 0.55, 1.0)

/**
 * Fit a perspective camera so `object` fills the view with padding.
 * Default viewDir = Wave hero angle (front + elevated).
 */
export function frameCameraToObject(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  padding = 1.35,
  viewDir: THREE.Vector3 = WAVE_VIEW_DIR,
): { position: THREE.Vector3; target: THREE.Vector3 } {
  const box = new THREE.Box3().setFromObject(object)
  const size = new THREE.Vector3()
  const target = new THREE.Vector3()
  box.getSize(size)
  box.getCenter(target)

  // Prefer fitting by the larger of width/height needs for this aspect
  const vFov = THREE.MathUtils.degToRad(camera.fov)
  const fitH = size.y / (2 * Math.tan(vFov / 2))
  const fitW = size.x / (2 * Math.tan(vFov / 2) * Math.max(camera.aspect, 0.001))
  // Depth also matters for long models (airship)
  const fitD = size.z / (2 * Math.tan(vFov / 2))

  const distance = padding * Math.max(fitH, fitW, fitD, 0.5)
  const dir = viewDir.clone().normalize()
  const position = target.clone().addScaledVector(dir, distance)

  camera.near = Math.max(0.05, distance / 100)
  camera.far = Math.max(50, distance * 20)
  camera.position.copy(position)
  camera.lookAt(target)
  camera.updateProjectionMatrix()

  return { position, target }
}
