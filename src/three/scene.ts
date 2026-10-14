import * as THREE from 'three'
import type { VibeState } from '../vibe/map'
import { disposeObject3D } from './dispose'
import { FUTURE_MODEL_URL, loadFutureModel } from './loadModel'

/** Locked hero framing — no free orbit. */
const HERO_POS = new THREE.Vector3(6.5, 3.8, 9.5)
const HERO_TARGET = new THREE.Vector3(0, 2.2, 0)

const DAY_BG = new THREE.Color(0xc5d4e0)
const NIGHT_BG = new THREE.Color(0x0e1218)
const DAY_FOG = new THREE.Color(0xb8c8d4)
const NIGHT_FOG = new THREE.Color(0x0e1218)

/**
 * Three.js Future stage — loads GLB only (no procedural stub).
 * Hero camera locked; warmth drives day→warm lighting.
 */
export type FutureScene = {
  mount: (host: HTMLElement) => void
  unmount: () => void
  resize: () => void
  tick: (dt: number, vibe: VibeState) => void
  readonly mounted: boolean
  readonly modelReady: boolean
  readonly lastError: string
}

export function createFutureScene(): FutureScene {
  let host: HTMLElement | null = null
  let renderer: THREE.WebGLRenderer | null = null
  let camera: THREE.PerspectiveCamera | null = null
  let scene: THREE.Scene | null = null
  let modelRoot: THREE.Group | null = null
  let hemi: THREE.HemisphereLight | null = null
  let key: THREE.DirectionalLight | null = null
  let fill: THREE.DirectionalLight | null = null
  let accent: THREE.PointLight | null = null
  let resizeObs: ResizeObserver | null = null
  let mounted = false
  let modelReady = false
  let lastError = ''
  let loadToken = 0
  let elapsed = 0
  let warmthSmoothed = 0

  const tmpBg = new THREE.Color()
  const tmpFog = new THREE.Color()

  function fitHeroCamera() {
    if (!camera) return
    camera.position.copy(HERO_POS)
    camera.lookAt(HERO_TARGET)
    camera.updateProjectionMatrix()
  }

  function applyMood(warmth: number) {
    if (!scene || !hemi || !key || !fill || !accent) return
    const t = Math.max(0, Math.min(1, warmth))
    warmthSmoothed += (t - warmthSmoothed) * 0.08

    tmpBg.copy(DAY_BG).lerp(NIGHT_BG, warmthSmoothed)
    tmpFog.copy(DAY_FOG).lerp(NIGHT_FOG, warmthSmoothed)
    scene.background = tmpBg
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.copy(tmpFog)
      scene.fog.near = 14 - warmthSmoothed * 2
      scene.fog.far = 40 - warmthSmoothed * 8
    }

    hemi.intensity = 0.95 - warmthSmoothed * 0.4
    key.intensity = 1.15 - warmthSmoothed * 0.3
    key.color.setHex(warmthSmoothed > 0.45 ? 0xffd4a8 : 0xfff2e0)
    fill.intensity = 0.22 + warmthSmoothed * 0.18
    accent.intensity = warmthSmoothed * 1.8
  }

  async function attachModel(token: number) {
    if (!scene) return
    lastError = ''
    modelReady = false
    try {
      const model = await loadFutureModel()
      if (token !== loadToken || !scene) {
        disposeObject3D(model)
        return
      }
      if (modelRoot) {
        scene.remove(modelRoot)
        disposeObject3D(modelRoot)
      }
      modelRoot = model
      scene.add(modelRoot)
      modelReady = true
      fitHeroCamera()
    } catch (err) {
      if (token !== loadToken) return
      lastError =
        err instanceof Error
          ? err.message
          : `Failed to load ${FUTURE_MODEL_URL}`
      modelReady = false
      console.warn('[future]', lastError)
    }
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
    get modelReady() {
      return modelReady
    },
    get lastError() {
      return lastError
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
      scene.background = DAY_BG.clone()
      scene.fog = new THREE.Fog(DAY_FOG.getHex(), 14, 40)

      camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
      fitHeroCamera()

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.PCFSoftShadowMap
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.domElement.style.display = 'block'
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
      host.appendChild(renderer.domElement)

      hemi = new THREE.HemisphereLight(0xb8c8e0, 0x2a241c, 0.95)
      scene.add(hemi)

      key = new THREE.DirectionalLight(0xfff2e0, 1.15)
      key.position.set(6, 10, 4)
      key.castShadow = true
      key.shadow.mapSize.set(1024, 1024)
      scene.add(key)

      fill = new THREE.DirectionalLight(0x6a8cff, 0.22)
      fill.position.set(-5, 3, -2)
      scene.add(fill)

      accent = new THREE.PointLight(0xff8a3d, 0, 16, 2)
      accent.position.set(0, 2.5, 2)
      scene.add(accent)

      const token = ++loadToken
      void attachModel(token)

      resizeObs = new ResizeObserver(() => resize())
      resizeObs.observe(host)
      resize()
      mounted = true
      elapsed = 0
      warmthSmoothed = 0
    },
    unmount() {
      loadToken++
      resizeObs?.disconnect()
      resizeObs = null

      if (renderer) {
        renderer.dispose()
        renderer.domElement.remove()
      }
      if (modelRoot) disposeObject3D(modelRoot)
      if (host) {
        host.innerHTML = ''
        host.hidden = true
      }

      host = null
      renderer = null
      camera = null
      scene = null
      modelRoot = null
      hemi = null
      key = null
      fill = null
      accent = null
      mounted = false
      modelReady = false
      lastError = ''
      elapsed = 0
      warmthSmoothed = 0
    },
    resize,
    tick(dt, vibe) {
      if (!mounted || !renderer || !scene || !camera) return
      elapsed += dt
      applyMood(vibe.warmth)

      const bob = Math.sin(elapsed * 0.35) * 0.05
      camera.position.set(HERO_POS.x, HERO_POS.y + bob, HERO_POS.z)
      camera.lookAt(HERO_TARGET)

      renderer.render(scene, camera)
    },
  }
}
