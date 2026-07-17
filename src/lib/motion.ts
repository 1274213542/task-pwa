import type { Transition, Variants } from 'motion/react'

/**
 * Shared motion language derived from /apple-design.
 *
 * Duration here is the spring response, not a hard animation timeout. Motion
 * keeps the current presentation value and velocity when a target changes, so
 * interactions can be redirected without a visual jump.
 */
export const MOTION = {
  press: { type: 'spring', bounce: 0, duration: 0.16 },
  control: { type: 'spring', bounce: 0, duration: 0.24 },
  route: { type: 'spring', bounce: 0, duration: 0.34 },
  sheet: { type: 'spring', bounce: 0, duration: 0.32 },
  momentum: { type: 'spring', bounce: 0.18, duration: 0.34 },
  list: { type: 'spring', bounce: 0, duration: 0.32 },
  calendar: { type: 'spring', bounce: 0, duration: 0.3 },
  reduced: { duration: 0.16, ease: 'easeOut' },
} as const satisfies Record<string, Transition>

export const directionalPageVariants: Variants = {
  enter: (direction: number) => ({
    opacity: 0,
    x: direction * 22,
    scale: 0.992,
  }),
  center: {
    opacity: 1,
    x: 0,
    scale: 1,
  },
  exit: (direction: number) => ({
    opacity: 0,
    x: direction * -18,
    scale: 0.994,
  }),
}

export const reducedPageVariants: Variants = {
  enter: { opacity: 0 },
  center: { opacity: 1 },
  exit: { opacity: 0 },
}

/** Apple's exponential deceleration projection, translated to pixels. */
export function projectVelocity(velocity: number, decelerationRate = 0.998) {
  return (velocity / 1000) * decelerationRate / (1 - decelerationRate)
}

