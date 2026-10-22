import * as THREE from 'three'
import type { PaintShareMode } from '../art/regions'
import type { VibeState } from '../vibe/map'
import { disposeObject3D } from './dispose'
import { frameCameraToObject, WAVE_VIEW_DIR } from './frameCamera'
import {
  FUTURE_MODEL_URL,
  loadFutureModel,
  loadRunnerModel,
} from './loadModel'
import { createMeshReveal, MESH_COLOR_COMPLETE } from './meshReveal'

/** World units / sec along the quay. */
const RUNNER_SPEED = 0.12

const WHITE_BG = new THREE.Color(0xffffff)
/** Wave photo — pale hazy sky */
const DAY_BG = new THREE.Color(0xb9cfe0)
const NIGHT_BG = new THREE.Color(0x0e1218)
const WHITE_FOG = new THREE.Color(0xffffff)
const DAY_FOG = new THREE.Color(0xa8c0d0)
const NIGHT_FOG = new THREE.Color(0x0e1218)
/** Wave fjord — muted slate green-blue */
const WATER_DAY = new THREE.Color(0x6a848c)
const WATER_NIGHT = new THREE.Color(0x1a2428)

/** Padding so Wave sits in frame with air for sky / water. */
const FRAME_PADDING = 1.42

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
  let runnerRoot: THREE.Group | null = null
  let water: THREE.Mesh | null = null
  let waterMat: THREE.MeshStandardMaterial | null = null
  let mixer: THREE.AnimationMixer | null = null
  let runnerMixer: THREE.AnimationMixer | null = null
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
  let runnerTravel = 0

  const heroPos = new THREE.Vector3(0, 1, 3)
  const heroTarget = new THREE.Vector3(0, 0, 0)
  const quayA = new THREE.Vector3()
  const quayB = new THREE.Vector3()
  const tmpDir = new THREE.Vector3()
  const raycaster = new THREE.Raycaster()
  const rayOrigin = new THREE.Vector3()
  const rayDown = new THREE.Vector3(0, -1, 0)

  const reveal = createMeshReveal()
  const tmpBg = new THREE.Color()
  const tmpMood = new THREE.Color()
  const tmpWater = new THREE.Color()

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
      WAVE_VIEW_DIR,
    )
    heroPos.copy(framed.position)
    // Aim a touch below center so more sky sits above the roofline
    heroTarget.copy(framed.target)
    heroTarget.y -= framed.position.distanceTo(framed.target) * 0.04
    camera.position.copy(heroPos)
    camera.lookAt(heroTarget)

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

    layoutWater()
    layoutQuay()
  }

  type DeckHit = { y: number; normalY: number }

  /** First solid hit under (x,z); prefer flat-ish faces (deck). */
  function probeDeck(x: number, z: number, box: THREE.Box3): DeckHit | null {
    if (!modelRoot) return null
    const spanY = Math.max(box.max.y - box.min.y, 0.01)
    rayOrigin.set(x, box.max.y + spanY * 0.25, z)
    raycaster.set(rayOrigin, rayDown)
    const hits = raycaster.intersectObject(modelRoot, true)
    if (hits.length === 0) return null

    const quayMax = box.min.y + spanY * 0.45
    let best: DeckHit | null = null
    for (const hit of hits) {
      if (hit.point.y > quayMax) continue
      const ny = hit.face
        ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y
        : 1
      // Prefer upward faces (plank tops), skip vertical quay front
      if (ny < 0.45) continue
      if (!best || ny > best.normalY) {
        best = { y: hit.point.y, normalY: ny }
      }
    }
    return best
  }

  /**
   * Quay path: search depth toward camera for real plank tops,
   * not the outer AABB (that put runner in empty air past the lip).
   */
  function layoutQuay() {
    if (!modelRoot) return
    const box = new THREE.Box3().setFromObject(modelRoot)
    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    box.getSize(size)
    box.getCenter(center)

    const towardCam = WAVE_VIEW_DIR.clone()
    towardCam.y = 0
    if (towardCam.lengthSq() < 0.001) towardCam.set(0, 0, 1)
    else towardCam.normalize()

    const extent =
      Math.abs(towardCam.x) * (size.x * 0.5) +
      Math.abs(towardCam.z) * (size.z * 0.5)

    const alongX = size.x >= size.z
    const half = (alongX ? size.x : size.z) * 0.34

    // Probe mid-quay depths (skip outer lip — empty air / vertical face)
    const depthFracs = [0.35, 0.42, 0.5, 0.58, 0.66, 0.74]
    let bestDepth = extent * 0.01
    let bestScore = -1
    for (const frac of depthFracs) {
      const depth = extent * frac
      const mx = center.x + towardCam.x * depth
      const mz = center.z + towardCam.z * depth
      const hit = probeDeck(mx, mz, box)
      if (!hit) continue
      const score = hit.normalY * 2 + hit.y
      if (score > bestScore) {
        bestScore = score
        bestDepth = depth
      }
    }

    if (alongX) {
      quayA.set(center.x - half, 0, center.z)
      quayB.set(center.x + half, 0, center.z)
    } else {
      quayA.set(center.x, 0, center.z - half)
      quayB.set(center.x, 0, center.z + half)
    }
    quayA.addScaledVector(towardCam, bestDepth)
    quayB.addScaledVector(towardCam, bestDepth)

    const hitA = probeDeck(quayA.x, quayA.z, box)
    const hitB = probeDeck(quayB.x, quayB.z, box)
    const fallbackY = box.min.y + Math.max(size.y * 0.08, 0.02)
    quayA.y = (hitA?.y ?? fallbackY) + 0.001
    quayB.y = (hitB?.y ?? fallbackY) + 0.001
  }

  function tickRunner(dt: number, show: boolean) {
    if (!runnerRoot || !modelRoot) return
    runnerRoot.visible = show
    if (!show) return

    const len = Math.max(
      0.01,
      Math.hypot(quayB.x - quayA.x, quayB.z - quayA.z),
    )
    runnerTravel += dt * RUNNER_SPEED
    const cycle = len * 2
    let d = runnerTravel % cycle
    let forward = true
    if (d > len) {
      d = cycle - d
      forward = false
    }
    const t = d / len
    runnerRoot.position.x = quayA.x + (quayB.x - quayA.x) * t
    runnerRoot.position.z = quayA.z + (quayB.z - quayA.z) * t

    const box = new THREE.Box3().setFromObject(modelRoot)
    const hit = probeDeck(runnerRoot.position.x, runnerRoot.position.z, box)
    runnerRoot.position.y =
      (hit?.y ?? quayA.y * (1 - t) + quayB.y * t) + 0.001

    if (forward) tmpDir.set(quayB.x - quayA.x, 0, quayB.z - quayA.z)
    else tmpDir.set(quayA.x - quayB.x, 0, quayA.z - quayB.z)
    if (tmpDir.lengthSq() > 1e-6) {
      runnerRoot.rotation.y = Math.atan2(tmpDir.x, tmpDir.z)
    }

    if (runnerMixer) runnerMixer.update(dt)
  }

  function ensureWater() {
    if (!scene || water) return
    const geo = new THREE.PlaneGeometry(1, 1, 1, 1)
    waterMat = new THREE.MeshStandardMaterial({
      color: WATER_DAY.clone(),
      roughness: 0.28,
      metalness: 0.22,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    water = new THREE.Mesh(geo, waterMat)
    water.name = 'wave-water'
    water.rotation.x = -Math.PI / 2
    water.receiveShadow = true
    water.visible = false
    scene.add(water)
  }

  function layoutWater() {
    if (!water || !modelRoot) return
    const box = new THREE.Box3().setFromObject(modelRoot)
    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    box.getSize(size)
    box.getCenter(center)

    const span = Math.max(size.x, size.z, 0.5) * 10
    water.scale.set(span, span, 1)
    // Sit just under the building feet
    water.position.set(center.x, box.min.y - size.y * 0.01, center.z)
    // Pull plane toward camera so more fjord fills the foreground
    const towardCam = WAVE_VIEW_DIR.clone()
    towardCam.y = 0
    if (towardCam.lengthSq() > 0.001) {
      towardCam.normalize()
      water.position.addScaledVector(towardCam, span * 0.18)
    }
  }

  function applyMood(warmth: number) {
    if (!scene || !hemi || !key || !fill || !accent) return
    const t = Math.max(0, Math.min(1, warmth))
    warmthSmoothed += (t - warmthSmoothed) * 0.08

    // Stay white canvas until color paint starts; then Wave sky + water
    const colorAmt = Math.min(1, reveal.minReveal / 0.35)
    tmpMood.copy(DAY_BG).lerp(NIGHT_BG, warmthSmoothed)
    tmpBg.copy(WHITE_BG).lerp(tmpMood, colorAmt)
    scene.background = tmpBg
    if (scene.fog instanceof THREE.Fog) {
      tmpMood.copy(DAY_FOG).lerp(NIGHT_FOG, warmthSmoothed)
      scene.fog.color.copy(WHITE_FOG).lerp(tmpMood, colorAmt)
    }

    if (waterMat && water) {
      tmpWater.copy(WATER_DAY).lerp(WATER_NIGHT, warmthSmoothed)
      waterMat.color.copy(tmpWater)
      waterMat.opacity = colorAmt * 0.92
      waterMat.depthWrite = waterMat.opacity > 0.5
      water.visible = colorAmt > 0.02
      waterMat.needsUpdate = true
    }

    // Soft even light while inking so gray reads as contour, not lit sculpture
    const inking = reveal.minContour > 0.01 && colorAmt < 0.5
    hemi.intensity = inking
      ? 1.2
      : 1.05 - warmthSmoothed * 0.35 * colorAmt
    hemi.color.setHex(0xb9cfe0)
    hemi.groundColor.copy(WATER_DAY).lerp(WATER_NIGHT, warmthSmoothed)
    key.intensity = inking ? 0.35 : 1.05 - warmthSmoothed * 0.25 * colorAmt
    key.color.setHex(
      colorAmt > 0.4 && warmthSmoothed > 0.45 ? 0xffd4a8 : 0xfff8f0,
    )
    fill.intensity = inking
      ? 0.05
      : 0.12 + (0.22 + warmthSmoothed * 0.18) * colorAmt
    accent.intensity = animWeight * warmthSmoothed * 1.8
  }

  async function attachModel(token: number) {
    if (!scene) return
    lastError = ''
    modelReady = false
    animWeight = 0
    runnerTravel = 0
    reveal.clear()
    mixer = null
    runnerMixer = null
    try {
      const [loaded, runner] = await Promise.all([
        loadFutureModel(),
        loadRunnerModel(),
      ])
      if (token !== loadToken || !scene) {
        disposeObject3D(loaded.root)
        disposeObject3D(runner.root)
        return
      }
      if (modelRoot) {
        scene.remove(modelRoot)
        disposeObject3D(modelRoot)
      }
      if (runnerRoot) {
        scene.remove(runnerRoot)
        disposeObject3D(runnerRoot)
      }

      modelRoot = loaded.root
      baseY = modelRoot.position.y
      baseRotY = modelRoot.rotation.y
      scene.add(modelRoot)
      ensureWater()
      // Paint reveal only on Wave — not the runner
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

      runnerRoot = runner.root
      runnerRoot.visible = false
      scene.add(runnerRoot)
      runnerMixer = new THREE.AnimationMixer(runnerRoot)
      const runClip =
        runner.animations.find((c) => /run/i.test(c.name)) ??
        runner.animations[0]
      if (runClip) {
        const action = runnerMixer.clipAction(runClip)
        action.play()
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
      scene.background = WHITE_BG.clone()
      scene.fog = new THREE.Fog(WHITE_FOG.getHex(), 2, 20)

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

      hemi = new THREE.HemisphereLight(0xb9cfe0, 0x6a848c, 0.95)
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
      runnerMixer = null

      if (renderer) {
        renderer.dispose()
        renderer.domElement.remove()
      }
      if (modelRoot) disposeObject3D(modelRoot)
      if (runnerRoot) disposeObject3D(runnerRoot)
      if (water) disposeObject3D(water)
      if (host) {
        host.innerHTML = ''
        host.hidden = true
      }

      host = null
      renderer = null
      camera = null
      scene = null
      modelRoot = null
      runnerRoot = null
      water = null
      waterMat = null
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
      runnerTravel = 0
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

      // Locked hero angle — no bob (still postcard)
      camera.position.copy(heroPos)
      camera.lookAt(heroTarget)

      // Still pose — no spin / float (Wave building stays fixed)
      if (modelRoot) {
        modelRoot.rotation.y = baseRotY
        modelRoot.position.y = baseY
      }

      if (mixer) {
        mixer.update(dt)
        mixer.timeScale = animWeight
      }

      // Runner appears once color starts; loops along quay
      const showRunner = reveal.minReveal > 0.08
      tickRunner(dt, showRunner)

      renderer.render(scene, camera)
    },
  }
}

export { MESH_COLOR_COMPLETE }
