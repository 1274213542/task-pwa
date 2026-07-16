import { useEffect, useRef, useState } from 'react'
import type { ColorToken, MarkerSymbol } from '../lib/db'
import MarkerIcon from './MarkerIcon'
import AppIcon from './AppIcon'

export interface RowActions {
  onToggle: () => void
  onSkip?: () => void
  onDelete: () => void
  onDeleteOnce?: () => void
  onRename?: (title: string) => void
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
  overdue,
  actions,
  liRef,
  liStyle,
  dragProps,
  selected,
  onMetaClick,
  dragging,
}: {
  title: string
  subtitle?: string
  colorToken?: ColorToken
  markerSymbol?: MarkerSymbol
  featureTone?: FeatureTone
  completed: boolean
  overdue?: boolean
  actions: RowActions
  liRef?: (el: HTMLLIElement | null) => void
  liStyle?: React.CSSProperties
  dragProps?: Record<string, unknown>
  selected?: boolean
  onMetaClick?: () => void
  dragging?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => setDraft(title), [title])

  function armDelete() {
    setConfirming(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setConfirming(false), 3000)
  }

  function commitRename() {
    setEditing(false)
    const next = draft.trim()
    if (actions.onRename && next && next !== title) actions.onRename(next)
    else setDraft(title)
  }

  return (
    <li
      ref={liRef}
      style={liStyle}
      {...dragProps}
      data-color-token={colorToken}
      data-feature-tone={featureTone}
      data-completed={completed || undefined}
      data-overdue={overdue || undefined}
      data-dragging={dragging || undefined}
      onClick={(event) => {
        if ((event.metaKey || event.ctrlKey) && onMetaClick) {
          event.preventDefault()
          onMetaClick()
        }
      }}
      className={`task-card row-in ${selected ? 'is-selected' : ''} ${
        dragProps ? 'task-sortable' : ''
      }`}
    >
      <button
        type="button"
        onClick={actions.onToggle}
        className="task-card-check"
        aria-label={completed ? '取消完成' : '完成'}
      >
        {completed ? (
          <AppIcon name="check" size={16} weight="bold" />
        ) : (
          <MarkerIcon symbol={markerSymbol} color={colorToken} size={15} />
        )}
      </button>

      <div className="task-card-copy">
        {editing ? (
          <input
            value={draft}
            aria-label="任务标题"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitRename()
              if (event.key === 'Escape') {
                setDraft(title)
                setEditing(false)
              }
            }}
            className="task-card-title-input"
          />
        ) : (
          <button
            type="button"
            onClick={() => actions.onRename && setEditing(true)}
            className="task-card-title-button"
          >
            <span className="strike" data-done={completed}>
              {title}
            </span>
          </button>
        )}
        <span className={`task-card-meta ${overdue && !completed ? 'is-overdue' : ''}`}>
          <AppIcon name="clock" size={14} />
          <span>{subtitle || '今天'}</span>
        </span>
      </div>

      <div className="task-card-tail">
        {completed && <span className="task-card-done-label">已完成</span>}
        <button
          type="button"
          aria-label="任务操作"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className="task-card-open"
        >
          <AppIcon name="more" size={24} weight="bold" />
        </button>
      </div>

      {menuOpen && (
        <div className="task-card-menu" role="group" aria-label="任务操作菜单">
          {actions.onRename && (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                setEditing(true)
              }}
            >
              <AppIcon name="edit" size={17} />
              编辑
            </button>
          )}
          {actions.onSkip && !completed && (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                actions.onSkip?.()
              }}
            >
              <AppIcon name="chevronRight" size={17} />
              跳过本期
            </button>
          )}
          {confirming ? (
            <>
              {actions.onDeleteOnce && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    setConfirming(false)
                    actions.onDeleteOnce?.()
                  }}
                >
                  仅删除本次
                </button>
              )}
              <button
                type="button"
                className="is-danger"
                onClick={() => {
                  setMenuOpen(false)
                  setConfirming(false)
                  actions.onDelete()
                }}
              >
                <AppIcon name="trash" size={17} />
                {actions.onDeleteOnce ? '删除系列' : '确认删除'}
              </button>
            </>
          ) : (
            <button type="button" className="is-danger" onClick={armDelete}>
              <AppIcon name="trash" size={17} />
              删除
            </button>
          )}
        </div>
      )}
    </li>
  )
}
