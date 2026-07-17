import type { Transition } from 'motion/react'

/**
 * Shared motion language derived from /apple-design.
 *
 * Duration here is the spring response, not a hard animation timeout. Motion
 * keeps the current presentation value and velocity when a target changes, so
 * interactions can be redirected without a visual jump.
 */
export const MOTION = {
  control: { type: 'spring', bounce: 0, duration: 0.18 },
  route: { type: 'spring', bounce: 0, duration: 0.22 },
  sheet: { type: 'spring', bounce: 0, duration: 0.28 },
  momentum: { type: 'spring', bounce: 0.12, duration: 0.3 },
  list: { type: 'spring', bounce: 0, duration: 0.22 },
  calendar: { type: 'spring', bounce: 0, duration: 0.22 },
  reduced: { duration: 0.12, ease: 'easeOut' },
} as const satisfies Record<string, Transition>

/** Apple's exponential deceleration projection, translated to pixels. */
export function projectVelocity(velocity: number, decelerationRate = 0.998) {
  return (velocity / 1000) * decelerationRate / (1 - decelerationRate)
}
