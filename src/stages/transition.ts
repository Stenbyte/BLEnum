/** Crossfade duration reveal ↔ future (ms). */
export const STAGE_TRANSITION_MS = 1100

export type TransitionKind = 'to-future' | 'to-reveal' | null

/**
 * Run a CSS crossfade on the canvas wrap, then call `onDone`.
 * Sets `data-transition` for CSS; clears it when finished.
 */
export function runStageTransition(
  wrap: HTMLElement,
  kind: Exclude<TransitionKind, null>,
  onDone: () => void,
  durationMs = STAGE_TRANSITION_MS,
): () => void {
  let settled = false
  const finish = () => {
    if (settled) return
    settled = true
    wrap.removeAttribute('data-transition')
    onDone()
  }

  wrap.dataset.transition = kind
  // Double rAF so the browser applies the starting style before fading
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      wrap.dataset.transition = `${kind}-active`
    })
  })

  const timer = window.setTimeout(finish, durationMs)
  return () => {
    window.clearTimeout(timer)
    finish()
  }
}
