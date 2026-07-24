import { motion, useReducedMotion } from 'motion/react'
import AppIcon from './AppIcon'
import { MOTION } from '../lib/motion'

export type TaskLeadingControlSize = 'main' | 'child'
export type TaskLeadingControlKind = 'completion' | 'plan'

export default function TaskLeadingControl({
  completed,
  disabled = false,
  label,
  onToggle,
  size = 'main',
  kind = 'completion',
  className = '',
  checkSize,
}: {
  completed: boolean
  disabled?: boolean
  label: string
  onToggle?: () => void
  size?: TaskLeadingControlSize
  kind?: TaskLeadingControlKind
  className?: string
  checkSize?: number
}) {
  const reduceMotion = useReducedMotion()
  const classes = `task-leading-control ${className}`.trim()
  const content = (
    <motion.span
      className="task-leading-control-visual"
      initial={false}
      animate={completed
        ? { scale: 1, opacity: 1 }
        : { scale: 0.96, opacity: 0.9 }}
      transition={reduceMotion ? MOTION.reduced : MOTION.press}
      aria-hidden
    >
      {kind === 'plan'
        ? <AppIcon name="list" size={size === 'child' ? 13 : 16} />
        : completed
          ? <AppIcon name="check" size={checkSize ?? (size === 'child' ? 11 : 15)} weight="bold" />
          : disabled
            ? <AppIcon name="sync" size={checkSize ?? (size === 'child' ? 11 : 15)} />
          : null}
    </motion.span>
  )

  if (kind === 'plan') {
    return (
      <span
        className={classes}
        data-task-control-size={size}
        data-task-control-kind={kind}
        data-completed={completed || undefined}
        aria-label={label}
      >
        {content}
      </span>
    )
  }

  return (
    <button
      type="button"
      className={classes}
      data-task-control-size={size}
      data-task-control-kind={kind}
      data-completed={completed || undefined}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onToggle?.()
      }}
    >
      {content}
    </button>
  )
}
