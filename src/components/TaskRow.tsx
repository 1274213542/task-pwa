import { createPortal } from 'react-dom'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  motion,
  useReducedMotion,
} from 'motion/react'
import type { ColorToken, MarkerSymbol } from '../lib/db'
import AppIcon from './AppIcon'
import SwipeActionRow from './SwipeActionRow'
import { MOTION } from '../lib/motion'

export interface RowActions {
  onToggle: () => void
  onEdit?: () => void
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
  menuOpen = false,
  menuId,
  onMenuToggle,
  onMenuClose,
  nestingLevel = 0,
  divider = false,
}: {
  title: string
  subtitle?: string
  colorToken?: ColorToken
  markerSymbol?: MarkerSymbol
  featureTone?: FeatureTone
  completed: boolean
  overdue?: boolean
  actions: RowActions
  liRef?: (el: HTMLElement | null) => void
  liStyle?: React.CSSProperties
  dragProps?: Record<string, unknown>
  selected?: boolean
  onMetaClick?: () => void
  dragging?: boolean
  /** The page owns this state so only one task menu can exist at a time. */
  menuOpen?: boolean
  menuId?: string
  onMenuToggle?: () => void
  onMenuClose?: () => void
  nestingLevel?: number
  divider?: boolean
}) {
  const reduceMotion = useReducedMotion()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const [confirming, setConfirming] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPosition, setMenuPosition] = useState<{
    top: number
    left: number
    transformOrigin: string
  } | null>(null)

  useEffect(() => () => {
    clearTimeout(timer.current)
  }, [])
  useEffect(() => setDraft(title), [title])
  useEffect(() => {
    if (!menuOpen) {
      setConfirming(false)
      clearTimeout(timer.current)
    }
  }, [menuOpen])

  useLayoutEffect(() => {
    if (!menuOpen || !triggerRef.current) {
      setMenuPosition(null)
      return
    }

    const updatePosition = () => {
      const trigger = triggerRef.current
      if (!trigger) return

      const rect = trigger.getBoundingClientRect()
      const visualViewport = window.visualViewport
      const viewportWidth = visualViewport?.width ?? window.innerWidth
      const viewportHeight = visualViewport?.height ?? window.innerHeight
      const navRect = document.querySelector('.mobile-nav')?.getBoundingClientRect()
      const safeBottom = navRect && navRect.top > 0 ? navRect.top - 8 : viewportHeight - 12
      const menuWidth = Math.min(196, viewportWidth - 16)
      const actionCount =
        (actions.onEdit ? 1 : 0) +
        (actions.onSkip && !completed ? 1 : 0) +
        (confirming ? (actions.onDeleteOnce ? 2 : 1) : 1)
      const estimatedHeight = actionCount * 44 + 14
      const shouldOpenUp = rect.bottom + 8 + estimatedHeight > safeBottom
      const top = shouldOpenUp ? Math.max(8, rect.top - estimatedHeight - 8) : rect.bottom + 8
      const left = Math.max(8, Math.min(rect.right - menuWidth, viewportWidth - menuWidth - 8))

      setMenuPosition({
        top,
        left,
        transformOrigin: shouldOpenUp ? 'right bottom' : 'right top',
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.visualViewport?.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.visualViewport?.removeEventListener('resize', updatePosition)
    }
  }, [actions.onDeleteOnce, actions.onEdit, actions.onSkip, completed, confirming, menuOpen])

  useEffect(() => {
    if (!menuOpen) return

    const closeWhenOutside = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target || menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      // Let a different task's trigger receive its own click. Its shared parent
      // updater atomically replaces this id with the new task id.
      if (target instanceof Element && target.closest('[data-task-menu-trigger]')) return
      onMenuClose?.()
      // A blank-card touch only dismisses the transient surface. Deliberate
      // controls (navigation, filters and another task action) still receive
      // their click after the menu has been cleared.
      const interactiveTarget =
        target instanceof Element &&
        target.closest('button, a, input, textarea, select, [role="tab"], [contenteditable="true"]')
      if (!interactiveTarget) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onMenuClose?.()
    }
    const closeWhenHidden = () => {
      if (document.visibilityState !== 'visible') onMenuClose?.()
    }

    document.addEventListener('pointerdown', closeWhenOutside, true)
    document.addEventListener('keydown', closeOnEscape)
    document.addEventListener('visibilitychange', closeWhenHidden)
    return () => {
      document.removeEventListener('pointerdown', closeWhenOutside, true)
      document.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('visibilitychange', closeWhenHidden)
    }
  }, [menuOpen, onMenuClose])

  function closeMenu() {
    clearTimeout(timer.current)
    setConfirming(false)
    onMenuClose?.()
  }

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
        id={`task:${menuId ?? title}`}
        label={title}
        className="task-card-swipe-row"
        contentClassName="task-card-swipe-content"
        divider={divider}
        resetKey={`${menuId ?? title}:${dragging ? 'dragging' : 'idle'}`}
        actions={[
          {
            label: '更多',
            icon: 'more',
            tone: 'neutral',
            onSelect: () => onMenuToggle?.(),
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
        onClick={(event) => {
          if ((event.metaKey || event.ctrlKey) && onMetaClick) {
            event.preventDefault()
            onMetaClick()
          }
        }}
        className={`task-card ${selected ? 'is-selected' : ''} ${
          dragProps ? 'task-sortable' : ''
        }`}
      >
      <button
        type="button"
        onClick={actions.onToggle}
        className="task-card-check"
        aria-label={completed ? '取消完成' : '完成'}
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
          ) : (
            <span className="task-card-check-empty" />
          )}
        </motion.span>
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
            data-row-swipe-handle
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
          ref={triggerRef}
          aria-label="任务操作"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          data-task-menu-trigger
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onMenuToggle?.()
          }}
          className="task-card-open"
        >
          <AppIcon name="more" size={24} weight="bold" />
        </button>
      </div>

      {menuOpen && menuPosition &&
        createPortal(
        <motion.div
          ref={menuRef}
          id={menuId}
          className="task-card-menu"
          role="menu"
          aria-label="任务操作菜单"
          style={menuPosition}
          initial={reduceMotion ? false : { opacity: 0, scale: 0.96, y: 3 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={reduceMotion ? MOTION.reduced : MOTION.control}
        >
          {actions.onEdit && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenu()
                actions.onEdit?.()
              }}
            >
              <AppIcon name="edit" size={17} />
              编辑
            </button>
          )}
          {actions.onSkip && !completed && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenu()
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
                  role="menuitem"
                  onClick={() => {
                    closeMenu()
                    actions.onDeleteOnce?.()
                  }}
                >
                  仅删除本次
                </button>
              )}
                <button
                  type="button"
                  role="menuitem"
                  className="is-danger"
                  onClick={() => {
                    closeMenu()
                    actions.onDelete()
                  }}
              >
                <AppIcon name="trash" size={17} />
                {actions.onDeleteOnce ? '删除系列' : '确认删除'}
              </button>
            </>
          ) : (
            <button type="button" role="menuitem" className="is-danger" onClick={armDelete}>
              <AppIcon name="trash" size={17} />
              删除
            </button>
          )}
        </motion.div>,
        document.body,
      )}
      </div>
      </SwipeActionRow>
    </motion.li>
  )
}
