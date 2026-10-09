import type { VibeState } from '../vibe/map'

/**
 * Future stage host — placeholder until Three.js (Phase 2).
 * Mounts into `#future-host`; tick receives vibe for later crowd → motion.
 */
export type FutureStageController = {
  mount: (host: HTMLElement) => void
  unmount: () => void
  tick: (dt: number, vibe: VibeState) => void
  readonly mounted: boolean
}

export function createFutureStage(): FutureStageController {
  let host: HTMLElement | null = null
  let panel: HTMLElement | null = null
  let warmthEl: HTMLElement | null = null
  let nearEl: HTMLElement | null = null
  let mounted = false
  let pulse = 0

  return {
    get mounted() {
      return mounted
    },
    mount(nextHost) {
      if (mounted && host === nextHost) return
      this.unmount()
      host = nextHost
      host.innerHTML = ''
      panel = document.createElement('div')
      panel.className = 'future-placeholder'
      panel.innerHTML = `
        <p class="future-title">Future Vejle</p>
        <p class="future-sub">3D stage placeholder — Three.js comes in Phase 2.</p>
        <p class="future-stats">
          Near <strong data-near>0</strong>
          · Warmth <strong data-warmth>0%</strong>
        </p>
      `
      nearEl = panel.querySelector('[data-near]')
      warmthEl = panel.querySelector('[data-warmth]')
      host.appendChild(panel)
      host.hidden = false
      mounted = true
    },
    unmount() {
      if (host) {
        host.innerHTML = ''
        host.hidden = true
      }
      host = null
      panel = null
      nearEl = null
      warmthEl = null
      mounted = false
      pulse = 0
    },
    tick(dt, vibe) {
      if (!mounted || !panel) return
      pulse += dt
      const breathe = 0.96 + Math.sin(pulse * 1.4) * 0.04 * (0.35 + vibe.warmth)
      panel.style.transform = `scale(${breathe.toFixed(4)})`
      if (nearEl) nearEl.textContent = String(vibe.nearCount)
      if (warmthEl) {
        warmthEl.textContent = `${Math.round(vibe.warmth * 100)}%`
      }
    },
  }
}
