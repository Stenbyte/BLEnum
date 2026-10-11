import * as THREE from 'three'
import type { VibeState } from '../vibe/map'

/**
 * Three.js Future stage scene — Phase 2 stub (primitives).
 * Swap stub root for a GLB in Phase 4.
 */
export type FutureScene = {
  mount: (host: HTMLElement) => void
  unmount: () => void
  resize: () => void
  tick: (dt: number, vibe: VibeState) => void
  readonly mounted: boolean
}

export function createFutureScene(): FutureScene {
  let host: HTMLElement | null = null
  let renderer: THREE.WebGLRenderer | null = null
  let camera: THREE.PerspectiveCamera | null = null
  let scene: THREE.Scene | null = null
  let stubRoot: THREE.Group | null = null
  let resizeObs: ResizeObserver | null = null
  let mounted = false
  let elapsed = 0

  function buildStubCity(): THREE.Group {
    const root = new THREE.Group()

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 12),
      new THREE.MeshStandardMaterial({
        color: 0x2a3340,
        roughness: 0.92,
        metalness: 0.05,
      }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    root.add(ground)

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 3.2),
      new THREE.MeshStandardMaterial({
        color: 0x3d6e8c,
        roughness: 0.35,
        metalness: 0.2,
      }),
    )
    water.rotation.x = -Math.PI / 2
    water.position.set(0, 0.02, 3.4)
    root.add(water)

    const buildingMat = new THREE.MeshStandardMaterial({
      color: 0xc4b8a4,
      roughness: 0.75,
      metalness: 0.08,
    })
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0xc45c26,
      roughness: 0.55,
      metalness: 0.15,
    })

    const blocks: Array<[number, number, number, number, number, boolean]> = [
      // x, z, w, h, d, accent?
      [-3.2, -1.2, 1.4, 2.2, 1.2, false],
      [-1.4, -1.5, 1.1, 3.4, 1.1, true],
      [0.2, -1.0, 1.6, 1.6, 1.4, false],
      [2.2, -1.4, 1.2, 2.8, 1.2, false],
      [3.5, -0.6, 0.9, 1.9, 0.9, true],
      [-2.5, 0.6, 1.3, 1.4, 1.0, false],
      [1.0, 0.4, 1.5, 2.1, 1.1, false],
    ]

    for (const [x, z, w, h, d, accent] of blocks) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        accent ? accentMat : buildingMat,
      )
      mesh.position.set(x, h / 2, z)
      mesh.castShadow = true
      mesh.receiveShadow = true
      root.add(mesh)
    }

    return root
  }

  function resize() {
    if (!host || !renderer || !camera) return
    const w = Math.max(1, host.clientWidth)
    const h = Math.max(1, host.clientHeight)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(w, h, false)
  }

  return {
    get mounted() {
      return mounted
    },
    mount(nextHost) {
      if (mounted && host === nextHost) {
        resize()
        return
      }
      this.unmount()

      host = nextHost
      host.innerHTML = ''
      host.hidden = false

      scene = new THREE.Scene()
      scene.background = new THREE.Color(0x0e1218)
      scene.fog = new THREE.Fog(0x0e1218, 10, 28)

      camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80)
      camera.position.set(7.5, 5.2, 9.5)
      camera.lookAt(0, 0.8, 0)

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.PCFSoftShadowMap
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.domElement.style.display = 'block'
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
      host.appendChild(renderer.domElement)

      const hemi = new THREE.HemisphereLight(0xb8c8e0, 0x2a241c, 0.85)
      scene.add(hemi)

      const key = new THREE.DirectionalLight(0xfff2e0, 1.15)
      key.position.set(6, 10, 4)
      key.castShadow = true
      key.shadow.mapSize.set(1024, 1024)
      scene.add(key)

      const fill = new THREE.DirectionalLight(0x6a8cff, 0.25)
      fill.position.set(-5, 3, -2)
      scene.add(fill)

      stubRoot = buildStubCity()
      scene.add(stubRoot)

      resizeObs = new ResizeObserver(() => resize())
      resizeObs.observe(host)
      resize()
      mounted = true
    },
    unmount() {
      resizeObs?.disconnect()
      resizeObs = null

      if (renderer) {
        renderer.dispose()
        renderer.domElement.remove()
      }
      if (stubRoot) {
        stubRoot.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry.dispose()
            const mat = obj.material
            if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
            else mat.dispose()
          }
        })
      }
      if (host) {
        host.innerHTML = ''
        host.hidden = true
      }

      host = null
      renderer = null
      camera = null
      scene = null
      stubRoot = null
      mounted = false
      elapsed = 0
    },
    resize,
    tick(dt, vibe) {
      if (!mounted || !renderer || !scene || !camera || !stubRoot) return
      elapsed += dt

      // Slow orbit + warmth-driven spin boost (crowd later)
      const spin = 0.12 + vibe.warmth * 0.35
      stubRoot.rotation.y = elapsed * spin

      const breath = 1 + Math.sin(elapsed * 1.6) * 0.015 * (0.4 + vibe.warmth)
      stubRoot.scale.setScalar(breath)

      renderer.render(scene, camera)
    },
  }
}
