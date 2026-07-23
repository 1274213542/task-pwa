import type { ReactNode } from 'react'
import AppIcon from './AppIcon'

/**
 * One stable header for every parent task / plan projection.
 *
 * The parent task remains the source of truth. Progress is derived from the
 * projected children for the current page/date; expansion is deliberately
 * local UI state.
 */
export default function TaskGroupHeader({
  title,
  completed,
  progress,
  expanded,
  completionDisabled = false,
  meta,
  onToggleComplete,
  onToggleExpanded,
  onAddChild,
  children,
}: {
  title: string
  completed: boolean
  progress: { completed: number; total: number }
  expanded: boolean
  completionDisabled?: boolean
  meta?: ReactNode
  onToggleComplete: () => void
  onToggleExpanded: () => void
  onAddChild?: () => void
  children?: ReactNode
}) {
  return (
    <div className="task-group-header">
      <button
        type="button"
        className="task-group-check"
        aria-label={completed ? `取消完成 ${title}` : `完成 ${title}`}
        disabled={completionDisabled}
        onClick={(event) => {
          event.stopPropagation()
          onToggleComplete()
        }}
      >
        <span aria-hidden>
          {completed && <AppIcon name="check" size={15} weight="bold" />}
        </span>
      </button>

      <button
        type="button"
        className="task-group-copy"
        aria-expanded={expanded}
        onClick={(event) => {
          event.stopPropagation()
          onToggleExpanded()
        }}
      >
        <span className="task-group-title-line">
          <strong>{title}</strong>
          <small aria-label={`已完成 ${progress.completed} 项，共 ${progress.total} 项`}>
            {progress.completed}/{progress.total}
          </small>
        </span>
        {meta && <span className="task-group-meta">{meta}</span>}
      </button>

      {onAddChild && (
        <button
          type="button"
          className="task-group-add"
          aria-label={`向 ${title} 添加子项`}
          onClick={(event) => {
            event.stopPropagation()
            onAddChild()
          }}
        >
          <AppIcon name="plus" size={17} />
        </button>
      )}

      <button
        type="button"
        className="task-group-toggle"
        aria-label={expanded ? `收起 ${title}` : `展开 ${title}`}
        aria-expanded={expanded}
        onClick={(event) => {
          event.stopPropagation()
          onToggleExpanded()
        }}
      >
        <AppIcon name={expanded ? 'chevronDown' : 'chevronRight'} size={16} />
      </button>

      {children && <div className="task-group-detail">{children}</div>}
    </div>
  )
}
