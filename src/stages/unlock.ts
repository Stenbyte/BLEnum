import type { PaintState } from '../art/painter'

/** Same bar used for full-photo blend in painter — palette “complete enough”. */
export const REVEAL_UNLOCK_THRESHOLD = 0.82

/** Lowest color reveal across all paint regions (0 if empty). */
export function minReveal(paint: PaintState): number {
  if (paint.byRegion.size === 0) return 0
  let min = 1
  for (const state of paint.byRegion.values()) {
    min = Math.min(min, state.reveal)
  }
  return min
}

/** True when every region has reached the unlock threshold. */
export function isRevealComplete(
  paint: PaintState,
  threshold = REVEAL_UNLOCK_THRESHOLD,
): boolean {
  if (paint.byRegion.size === 0) return false
  return minReveal(paint) >= threshold
}
