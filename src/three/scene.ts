import * as THREE from 'three'
import type { PaintShareMode } from '../art/regions'
import type { VibeState } from '../vibe/map'
import { disposeObject3D } from './dispose'
import { frameCameraToObject } from './frameCamera'
import { FUTURE_MODEL_URL, loadFutureModel } from './loadModel'
import { createMeshReveal, MESH_COLOR_COMPLETE } from './meshReveal'

const DAY_BG = new THREE.Color(0xc5d4e0)
const NIGHT_BG = new THREE.Color(0x0e1218)
const DAY_FOG = new THREE.Color(0xb8c8d4)
const NIGHT_FOG = new THREE.Color(0x0e1218)

/** Padding so model sits inside the canvas with a little air around it. */
const FRAME_PADDING = 1.28

export type FutureTickInput = {
  shareMode: PaintShareMode
  nearKeys: string[]
}

export type FutureScene = {
  mount: (host: HTMLElement) => void
  unmount: () => void
  resize: () => void
  tick: (dt: number, vibe: VibeState, input: FutureTickInput) => void
  readonly mounted: boolean
  readonly modelReady: boolean
  readonly colorComplete: boolean
  readonly colorProgress: number
  readonly lastError: string
}

export function createFutureScene(): FutureScene {
  let host: HTMLElement | null = null
  let renderer: THREE.WebGLRenderer | null = null
  let camera: THREE.PerspectiveCamera | null = null
  let scene: THREE.Scene | null = null
  let modelRoot: THREE.Group | null = null
  let mixer: THREE.AnimationMixer | null = null
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
  let animWeight = 0
  let baseY = 0
  let baseRotY = 0

  const heroPos = new THREE.Vector3(0, 1, 3)
  const heroTarget = new THREE.Vector3(0, 0, 0)

  const reveal = createMeshReveal()
  const tmpBg = new THREE.Color()
  const tmpFog = new THREE.Color()

  function fitToCanvas() {
    if (!camera || !modelRoot) return
    // Reset pose while measuring so bounds match rest pose
    const savedRot = modelRoot.rotation.y
    const savedY = modelRoot.position.y
    modelRoot.rotation.y = baseRotY
    modelRoot.position.y = baseY

    const framed = frameCameraToObject(
      camera,
      modelRoot,
      FRAME_PADDING,
    )
    heroPos.copy(framed.position)
    heroTarget.copy(framed.target)

    modelRoot.rotation.y = savedRot
    modelRoot.position.y = savedY

    if (scene?.fog instanceof THREE.Fog) {
      const dist = heroPos.distanceTo(heroTarget)
      scene.fog.near = dist * 0.85
      scene.fog.far = dist * 4
    }

    if (key) {
      key.position.set(
        heroTarget.x + 2,
        heroTarget.y + 4,
        heroTarget.z + 2,
      )
    }
    if (accent) {
      accent.position.copy(heroTarget).add(new THREE.Vector3(0, 0.4, 0.6))
    }
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
    }

    hemi.intensity = 0.95 - warmthSmoothed * 0.4
    key.intensity = 1.15 - warmthSmoothed * 0.3
    key.color.setHex(warmthSmoothed > 0.45 ? 0xffd4a8 : 0xfff2e0)
    fill.intensity = 0.22 + warmthSmoothed * 0.18
    accent.intensity = animWeight * warmthSmoothed * 1.8
  }

  async function attachModel(token: number) {
    if (!scene) return
    lastError = ''
    modelReady = false
    animWeight = 0
    reveal.clear()
    mixer = null
    try {
      const loaded = await loadFutureModel()
      if (token !== loadToken || !scene) {
        disposeObject3D(loaded.root)
        return
      }
      if (modelRoot) {
        scene.remove(modelRoot)
        disposeObject3D(modelRoot)
      }
      modelRoot = loaded.root
      baseY = modelRoot.position.y
      baseRotY = modelRoot.rotation.y
      scene.add(modelRoot)
      reveal.reset(modelRoot)

      if (loaded.animations.length > 0) {
        mixer = new THREE.AnimationMixer(modelRoot)
        for (const clip of loaded.animations) {
          const action = mixer.clipAction(clip)
          action.play()
          action.setEffectiveWeight(0)
          action.paused = true
        }
      }

      modelReady = true
      resize()
      fitToCanvas()
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
    if (modelReady && modelRoot) fitToCanvas()
  }

  return {
    get mounted() {
      return mounted
    },
    get modelReady() {
      return modelReady
    },
    get colorComplete() {
      return reveal.colorComplete
    },
    get colorProgress() {
      return reveal.minReveal
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
      scene.fog = new THREE.Fog(DAY_FOG.getHex(), 2, 20)

      camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100)
      camera.position.copy(heroPos)
      camera.lookAt(heroTarget)

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
      key.position.set(2, 4, 2)
      key.castShadow = true
      key.shadow.mapSize.set(1024, 1024)
      scene.add(key)

      fill = new THREE.DirectionalLight(0x6a8cff, 0.22)
      fill.position.set(-2, 1.5, -1)
      scene.add(fill)

      accent = new THREE.PointLight(0xff8a3d, 0, 8, 2)
      accent.position.set(0, 0.5, 0.5)
      scene.add(accent)

      const token = ++loadToken
      void attachModel(token)

      resizeObs = new ResizeObserver(() => resize())
      resizeObs.observe(host)
      resize()
      mounted = true
      elapsed = 0
      warmthSmoothed = 0
      animWeight = 0
    },
    unmount() {
      loadToken++
      resizeObs?.disconnect()
      resizeObs = null
      reveal.clear()
      mixer = null

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
      animWeight = 0
      baseY = 0
      baseRotY = 0
    },
    resize,
    tick(dt, vibe, input) {
      if (!mounted || !renderer || !scene || !camera) return
      elapsed += dt

      if (modelReady) {
        reveal.tick(
          dt,
          input.nearKeys,
          input.shareMode,
          vibe.breathByDevice,
        )
      }

      const targetAnim = reveal.colorComplete ? 1 : 0
      animWeight += (targetAnim - animWeight) * Math.min(1, dt * 1.2)

      applyMood(vibe.warmth)

      // Soft camera bob (small so model stays framed)
      const dist = heroPos.distanceTo(heroTarget)
      const bob = Math.sin(elapsed * 0.35) * dist * 0.008 * Math.max(0.2, animWeight)
      camera.position.set(heroPos.x, heroPos.y + bob, heroPos.z)
      camera.lookAt(heroTarget)

      if (modelRoot) {
        if (animWeight > 0.01) {
          // Gentle motion — keep inside frame
          const spin = (0.08 + vibe.warmth * 0.12) * animWeight
          modelRoot.rotation.y = baseRotY + elapsed * spin
          modelRoot.position.y =
            baseY + Math.sin(elapsed * 0.7) * dist * 0.012 * animWeight
        } else {
          modelRoot.rotation.y = baseRotY
          modelRoot.position.y = baseY
        }
      }

      if (mixer) {
        mixer.update(dt)
        mixer.timeScale = animWeight
      }

      renderer.render(scene, camera)
    },
  }
}

export { MESH_COLOR_COMPLETE }
