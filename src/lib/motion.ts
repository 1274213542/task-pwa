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
  // The shared dock indicator starts with the icon/label state handoff. Motion
  // still carries the current velocity when a new tab is chosen, so rapid taps
  // redirect one persistent bubble instead of queueing animations.
  nav: {
    type: 'spring',
    stiffness: 360,
    damping: 34,
    mass: 0.96,
  },
  taskControl: {
    type: 'spring',
    stiffness: 430,
    damping: 39,
    mass: 0.88,
  },
  taskContent: {
    duration: 0.2,
    ease: [0.22, 1, 0.36, 1],
  },
  route: { type: 'spring', bounce: 0, stiffness: 480, damping: 46, mass: 0.9 },
  push: { type: 'spring', bounce: 0, stiffness: 430, damping: 43, mass: 0.94 },
  sheet: { type: 'spring', bounce: 0, stiffness: 410, damping: 39, mass: 0.96 },
  momentum: { type: 'spring', bounce: 0.12, stiffness: 360, damping: 34, mass: 0.92 },
  list: { type: 'spring', stiffness: 500, damping: 43, mass: 0.82 },
  calendar: { type: 'spring', stiffness: 460, damping: 42, mass: 0.88 },
  // Reduce Motion means "remove disorienting travel", not "remove feedback".
  // A short opacity/state handoff remains visible in iOS standalone mode.
  reduced: { duration: 0.14, ease: [0.2, 0, 0, 1] },
} as const satisfies Record<string, Transition>

export interface DirectionalMotionContext {
  direction: 1 | -1
  kind?: 'tab' | 'push' | 'calendar'
  origin?: SpatialRouteOrigin
}

export interface SpatialRouteOrigin {
  xPercent: number
  yPercent: number
}

export interface SpatialRouteSource {
  from: string
  to: string
  origin: SpatialRouteOrigin
}

/**
 * Convert a source surface into a viewport-relative transform origin. Keeping
 * the value in percentages preserves the relationship across safe areas,
 * desktop gutters and rotation better than raw pixels.
 */
export function spatialOriginFromRect(
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  viewportWidth: number,
  viewportHeight: number,
): SpatialRouteOrigin {
  const clamp = (value: number) => Math.min(94, Math.max(6, value))
  const safeWidth = Math.max(1, viewportWidth)
  const safeHeight = Math.max(1, viewportHeight)
  return {
    xPercent: clamp(((rect.left + rect.width / 2) / safeWidth) * 100),
    yPercent: clamp(((rect.top + rect.height / 2) / safeHeight) * 100),
  }
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
  reducedEnter: {
    x: 0,
    y: 0,
    scale: 1,
    opacity: 0.82,
  },
  enter: ({ direction, kind = 'tab', origin }: DirectionalMotionContext) => ({
    x: direction * distanceFor(kind, true),
    y: origin ? 4 : 0,
    scale: origin ? 0.988 : 1,
    transformOrigin: origin
      ? `${origin.xPercent}% ${origin.yPercent}%`
      : '50% 16%',
  }),
  center: ({ origin }: DirectionalMotionContext) => ({
    x: 0,
    y: 0,
    scale: 1,
    opacity: 1,
    transformOrigin: origin
      ? `${origin.xPercent}% ${origin.yPercent}%`
      : '50% 16%',
  }),
}

/** Apple's exponential deceleration projection, translated to pixels. */
export function projectVelocity(velocity: number, decelerationRate = 0.998) {
  return (velocity / 1000) * decelerationRate / (1 - decelerationRate)
}
