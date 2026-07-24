import {
  motion,
  useReducedMotion,
} from 'motion/react'
import type { ReactNode } from 'react'
import type { ColorToken, MarkerSymbol } from '../lib/db'
import AppIcon from './AppIcon'
import SwipeActionRow from './SwipeActionRow'
import { MOTION } from '../lib/motion'
import TaskGroupHeader from './TaskGroupHeader'

export interface RowActions {
  onToggle: () => void
  onEdit?: () => void
  onDelete: () => void
}

type FeatureTone = 'charcoal' | 'lime' | 'purple' | 'custom'

/**
 * Shared task surface. Data and task actions stay independent from the visual
 * projection, so recurring templates and completion records are never mutated
 * merely to reproduce the reference card layout.
 */
export default function TaskRow({
  title,
  subtitle,
  colorToken = 'gray',
  markerSymbol = 'dot',
  featureTone = 'custom',
  completed,
  completionDisabled = false,
  organizational = false,
  overdue,
  actions,
  liRef,
  liStyle,
  dragProps,
  selected,
  onMetaClick,
  dragging,
  rowId,
  nestingLevel = 0,
  childProgress,
  timelinePreview = [],
  collapsible = false,
  expanded = true,
  onToggleExpanded,
  onAddChild,
  groupContent,
  divider = false,
}: {
  title: string
  subtitle?: string
  colorToken?: ColorToken
  markerSymbol?: MarkerSymbol
  featureTone?: FeatureTone
  completed: boolean
  completionDisabled?: boolean
  organizational?: boolean
  overdue?: boolean
  actions: RowActions
  liRef?: (el: HTMLElement | null) => void
  liStyle?: React.CSSProperties
  dragProps?: Record<string, unknown>
  selected?: boolean
  onMetaClick?: () => void
  dragging?: boolean
  rowId?: string
  nestingLevel?: number
  childProgress?: { completed: number; total: number }
  timelinePreview?: {
    id: string
    time: string
    title: string
    completed?: boolean
    onToggle?: () => void
  }[]
  collapsible?: boolean
  expanded?: boolean
  onToggleExpanded?: () => void
  onAddChild?: () => void
  groupContent?: ReactNode
  divider?: boolean
}) {
  const reduceMotion = useReducedMotion()
  const isChild = nestingLevel > 0
  const hierarchyLabel = organizational ? '计划' : isChild ? '子任务' : childProgress ? '父任务' : undefined

  return (
    <motion.li
      layout="position"
      initial={false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
      transition={reduceMotion ? MOTION.reduced : MOTION.list}
      className="task-card-shell"
    >
      <SwipeActionRow
        as="div"
        id={`task:${rowId ?? title}`}
        label={title}
        className={`task-card-swipe-row ${isChild ? 'task-card-swipe-row-child' : childProgress ? 'task-card-swipe-row-parent' : ''}`}
        contentClassName="task-card-swipe-content"
        divider={divider}
        resetKey={`${rowId ?? title}:${dragging ? 'dragging' : 'idle'}`}
        actions={[
          {
            label: '更多',
            icon: 'more',
            tone: 'neutral',
            onSelect: () => actions.onEdit?.(),
            disabled: !actions.onEdit,
          },
          {
            label: '删除',
            icon: 'trash',
            tone: 'danger',
            onSelect: actions.onDelete,
          },
        ]}
      >
      <div
        ref={liRef}
        style={liStyle}
        {...dragProps}
        data-color-token={colorToken}
        data-marker-symbol={markerSymbol}
        data-feature-tone={featureTone}
        data-completed={completed || undefined}
        data-overdue={overdue || undefined}
        data-dragging={dragging || undefined}
        data-task-depth={nestingLevel || undefined}
        data-has-children={childProgress ? true : undefined}
        data-task-role={organizational ? 'plan' : isChild ? 'child' : childProgress ? 'parent' : 'task'}
        aria-expanded={collapsible ? expanded : undefined}
        onClick={(event) => {
          if ((event.metaKey || event.ctrlKey) && onMetaClick) {
            event.preventDefault()
            onMetaClick()
            return
          }
          if (
            collapsible &&
            onToggleExpanded &&
            !(event.target as Element).closest(
              '.task-card-check, .task-card-parent-toggle, .apple-swipe-actions, .task-inline-child-composer',
            )
          ) {
            onToggleExpanded()
          }
        }}
        className={`task-card ${selected ? 'is-selected' : ''} ${
          dragProps ? 'task-sortable' : ''
        }`}
      >
      {collapsible && childProgress ? (
        <TaskGroupHeader
          title={title}
          completed={completed}
          completionDisabled={completionDisabled}
          progress={childProgress}
          expanded={expanded}
          onToggleComplete={actions.onToggle}
          onToggleExpanded={() => onToggleExpanded?.()}
          onAddChild={onAddChild}
          meta={subtitle ? (
            <>
              <b>{hierarchyLabel ?? '父任务'}</b>
              <span>{subtitle}</span>
            </>
          ) : hierarchyLabel}
        >
          {(groupContent || timelinePreview.length > 0) && (
            <>
              {groupContent}
              {timelinePreview.length > 0 && (
                <div className="task-card-timeline-preview" aria-label="时间步骤预览">
                  {timelinePreview.map((step) => (
                    <span key={step.id} data-has-check={step.onToggle ? true : undefined}>
                      {step.onToggle && (
                        <button
                          type="button"
                          className="task-card-timeline-preview-check"
                          aria-label={step.completed ? `取消完成 ${step.title}` : `完成 ${step.title}`}
                          onClick={step.onToggle}
                        >
                          <span>{step.completed && <AppIcon name="check" size={10} />}</span>
                        </button>
                      )}
                      <time>{step.time}</time>
                      <b>{step.title}</b>
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </TaskGroupHeader>
      ) : (
        <>
      {organizational ? (
        <span className="task-card-check task-card-plan-indicator" aria-label="计划">
          <AppIcon name="list" size={18} />
        </span>
      ) : <button
        type="button"
        onClick={actions.onToggle}
        disabled={completionDisabled}
        className="task-card-check"
        aria-label={completionDisabled ? '长期任务模板' : completed ? '取消完成' : '完成'}
      >
        <motion.span
          className="task-card-check-feedback"
          initial={false}
          animate={completed
            ? { scale: 1, opacity: 1 }
            : { scale: 0.88, opacity: 0.86 }}
          transition={reduceMotion ? MOTION.reduced : MOTION.press}
          aria-hidden
        >
          {completed ? (
            <AppIcon name="check" size={16} weight="bold" />
          ) : completionDisabled ? (
            <AppIcon name="sync" size={15} />
          ) : (
            <span className="task-card-check-empty" />
          )}
        </motion.span>
      </button>}

      <div className="task-card-copy">
        <div className="task-card-title-line">
          <button
            type="button"
            data-row-swipe-handle
            aria-label={collapsible
              ? `${expanded ? '折叠' : '展开'}父任务 ${title}`
              : `编辑任务 ${title}`}
            onClick={(event) => {
              event.stopPropagation()
              if (collapsible) onToggleExpanded?.()
              else actions.onEdit?.()
            }}
            className="task-card-title-button"
          >
            <i className="task-title-color-dot" aria-hidden />
            <span className="strike" data-done={completed}>
              {title}
            </span>
          </button>
          {childProgress && (
            <span
              className="task-card-child-progress"
              aria-label={`子任务完成 ${childProgress.completed} 项，共 ${childProgress.total} 项`}
            >
              {childProgress.completed}/{childProgress.total}
            </span>
          )}
          {collapsible && (
            <button
              type="button"
              className="task-card-parent-toggle"
              aria-label={`${expanded ? '折叠' : '展开'}子任务`}
              aria-expanded={expanded}
              onClick={(event) => {
                event.stopPropagation()
                onToggleExpanded?.()
              }}
            >
              <AppIcon name={expanded ? 'chevronDown' : 'chevronRight'} size={16} />
            </button>
          )}
        </div>
        {!isChild && (
          <span className={`task-card-meta ${overdue && !completed ? 'is-overdue' : ''}`}>
            {hierarchyLabel ? (
              <b className="task-card-hierarchy-label">{hierarchyLabel}</b>
            ) : (
              <AppIcon name="clock" size={14} />
            )}
            {(subtitle || !hierarchyLabel) && <span>{subtitle || '今天'}</span>}
          </span>
        )}
        {timelinePreview.length > 0 && (
          <div className="task-card-timeline-preview" aria-label="时间步骤预览">
            {timelinePreview.map((step) => (
              <span key={step.id}>
                <time>{step.time}</time>
                <b>{step.title}</b>
              </span>
            ))}
          </div>
        )}
      </div>
        </>
      )}

      </div>
      </SwipeActionRow>
    </motion.li>
  )
}
