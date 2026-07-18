import type { Transition } from 'motion/react'

/**
 * Shared motion language derived from /apple-design.
 *
 * Duration here is the spring response, not a hard animation timeout. Motion
 * keeps the current presentation value and velocity when a target changes, so
 * interactions can be redirected without a visual jump.
 */
export const MOTION = {
  press: { type: 'spring', stiffness: 700, damping: 46, mass: 0.7 },
  control: { type: 'spring', stiffness: 620, damping: 46, mass: 0.76 },
  // The shared dock indicator intentionally settles a little slower than a
  // press feedback. The short delay creates the soft "bubble handoff" seen in
  // the reference recording; Motion still carries the current velocity when a
  // new tab is chosen, so rapid taps redirect the same spring in place.
  nav: {
    type: 'spring',
    stiffness: 320,
    damping: 30,
    mass: 1,
    delay: 0.02,
  },
  route: { type: 'spring', bounce: 0, stiffness: 480, damping: 46, mass: 0.9 },
  push: { type: 'spring', bounce: 0, stiffness: 430, damping: 43, mass: 0.94 },
  sheet: { type: 'spring', bounce: 0, stiffness: 410, damping: 39, mass: 0.96 },
  momentum: { type: 'spring', bounce: 0.12, stiffness: 360, damping: 34, mass: 0.92 },
  list: { type: 'spring', stiffness: 500, damping: 43, mass: 0.82 },
  calendar: { type: 'spring', stiffness: 460, damping: 42, mass: 0.88 },
  reduced: { duration: 0.01 },
} as const satisfies Record<string, Transition>

export interface DirectionalMotionContext {
  direction: 1 | -1
  kind?: 'tab' | 'push' | 'calendar'
}

function distanceFor(kind: DirectionalMotionContext['kind'], entering: boolean) {
  if (kind === 'push') return entering ? 24 : 16
  if (kind === 'calendar') return entering ? 20 : 12
  return entering ? 16 : 10
}

/**
 * Transform-only spatial variants. The entering and exiting surfaces share the
 * same grid cell, so the app background and persistent chrome never disappear.
 */
export const directionalSurfaceVariants = {
  enter: ({ direction, kind = 'tab' }: DirectionalMotionContext) => ({
    x: direction * distanceFor(kind, true),
    zIndex: 2,
  }),
  center: { x: 0, zIndex: 2 },
  exit: ({ direction, kind = 'tab' }: DirectionalMotionContext) => ({
    x: direction * -distanceFor(kind, false),
    zIndex: 1,
  }),
}

/**
 * Primary navigation deliberately keeps only one route surface mounted.
 * Safari can retain the outgoing compositing layer after React has started an
 * overlapping exit transition, which looks like stale text or cards. The new
 * route still enters from the correct spatial direction, but the old route is
 * removed synchronously so there is nothing underneath to ghost.
 */
export const directionalEnterVariants = {
  enter: ({ direction, kind = 'tab' }: DirectionalMotionContext) => ({
    x: direction * distanceFor(kind, true),
  }),
  center: { x: 0 },
}

/** Apple's exponential deceleration projection, translated to pixels. */
export function projectVelocity(velocity: number, decelerationRate = 0.998) {
  return (velocity / 1000) * decelerationRate / (1 - decelerationRate)
}
