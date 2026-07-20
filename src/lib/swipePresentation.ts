export const APPLE_SWIPE_ACTION_WIDTH = 56
export const APPLE_SWIPE_ACTION_GAP = 4

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

function stagedProgress(progress: number, start: number, end: number) {
  return clamp01((progress - start) / Math.max(0.001, end - start))
}

/**
 * Mirrors one live pointer value into compositor-friendly CSS variables.
 * The variables let dividers, labels and action pills follow the same
 * presentation state without putting pointer movement through React state.
 */
export function applySwipePresentation(
  element: HTMLElement | null,
  value: number,
  reveal: number,
  rowWidth = reveal,
) {
  if (!element) return
  const distance = Math.abs(Math.min(0, value))
  const progress = clamp01(distance / Math.max(1, reveal))
  const overshoot = clamp01((distance - reveal) / 18)
  const fullSwipeStart = Math.max(reveal, rowWidth * 0.34)
  const fullSwipeProgress = clamp01(
    (distance - fullSwipeStart) / Math.max(1, rowWidth - fullSwipeStart),
  )

  element.style.setProperty('--swipe-progress', progress.toFixed(4))
  element.style.setProperty('--swipe-delete-progress', stagedProgress(progress, 0.04, 0.34).toFixed(4))
  element.style.setProperty('--swipe-secondary-progress', stagedProgress(progress, 0.28, 0.66).toFixed(4))
  element.style.setProperty('--swipe-leading-progress', stagedProgress(progress, 0.56, 0.92).toFixed(4))
  element.style.setProperty('--swipe-overshoot', overshoot.toFixed(4))
  element.style.setProperty('--swipe-full-progress', fullSwipeProgress.toFixed(4))
  element.style.setProperty('--swipe-row-width', `${Math.max(reveal, rowWidth)}px`)
}
