import type { VibeState } from '../vibe/map'
import { createFutureScene, type FutureScene } from '../three/scene'

/**
 * Future stage — Three.js scene in `#future-host`.
 * Tick receives vibe for later crowd → motion / color reveal.
 */
export type FutureStageController = {
  mount: (host: HTMLElement) => void
  unmount: () => void
  tick: (dt: number, vibe: VibeState) => void
  readonly mounted: boolean
}

export function createFutureStage(): FutureStageController {
  const scene: FutureScene = createFutureScene()

  return {
    get mounted() {
      return scene.mounted
    },
    mount(host) {
      scene.mount(host)
    },
    unmount() {
      scene.unmount()
    },
    tick(dt, vibe) {
      scene.tick(dt, vibe)
    },
  }
}
