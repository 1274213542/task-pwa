import type { CSSProperties } from 'react'
import type { Transition } from 'motion/react'
import { motion, useReducedMotion } from 'motion/react'
import { MOTION } from '../lib/motion'

export default function SegmentedIndicator({
  index,
  count,
  inset = 4,
  className = '',
  transition = MOTION.control,
}: {
  index: number
  count: number
  inset?: number
  className?: string
  transition?: Transition
}) {
  const reduceMotion = useReducedMotion()
  const safeCount = Math.max(1, count)
  const safeIndex = Math.min(safeCount - 1, Math.max(0, index))

  return (
    <motion.span
      aria-hidden="true"
      className={`shared-segment-indicator ${className}`.trim()}
      initial={false}
      animate={{ x: `${safeIndex * 100}%` }}
      transition={reduceMotion ? MOTION.reduced : transition}
      style={{
        '--segment-local-inset': `${inset}px`,
        '--segment-position-inset': 'max(0px, calc(var(--segment-local-inset) - var(--segment-track-border-width, 0px)))',
        top: 'var(--segment-position-inset)',
        bottom: 'var(--segment-position-inset)',
        left: 'var(--segment-position-inset)',
        width: `calc((100% - (var(--segment-position-inset) * 2)) / ${safeCount})`,
      } as CSSProperties}
    />
  )
}
