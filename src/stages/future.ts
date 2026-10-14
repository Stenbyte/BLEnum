import type { PaintShareMode } from '../art/regions'
import type { VibeState } from '../vibe/map'
import {
  createFutureScene,
  type FutureScene,
  type FutureTickInput,
} from '../three/scene'

/**
 * Future stage — muted GLB → Cover/Crowd color → then animation.
 */
export type FutureStageController = {
  mount: (host: HTMLElement) => void
  unmount: () => void
  tick: (dt: number, vibe: VibeState, input: FutureTickInput) => void
  readonly mounted: boolean
  readonly modelReady: boolean
  readonly colorComplete: boolean
  readonly colorProgress: number
  readonly lastError: string
}

export function createFutureStage(): FutureStageController {
  const scene: FutureScene = createFutureScene()

  return {
    get mounted() {
      return scene.mounted
    },
    get modelReady() {
      return scene.modelReady
    },
    get colorComplete() {
      return scene.colorComplete
    },
    get colorProgress() {
      return scene.colorProgress
    },
    get lastError() {
      return scene.lastError
    },
    mount(host) {
      scene.mount(host)
    },
    unmount() {
      scene.unmount()
    },
    tick(dt, vibe, input) {
      scene.tick(dt, vibe, input)
    },
  }
}

export type { FutureTickInput, PaintShareMode }
