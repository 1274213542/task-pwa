import { createPortal } from 'react-dom'
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useMotionValueEvent,
  useTransform,
  type AnimationPlaybackControls,
} from 'motion/react'
import type { ColorToken, MarkerSymbol } from '../lib/db'
import AppIcon from './AppIcon'
import { MOTION } from '../lib/motion'
import { APPLE_SWIPE_ACTION_GAP, APPLE_SWIPE_ACTION_WIDTH, applySwipePresentation } from '../lib/swipePresentation'

export interface RowActions {
  onToggle: () => void
  onEdit?: () => void
  onSkip?: () => void
  onDelete: () => void
  onDeleteOnce?: () => void
  onRename?: (title: string) => void
}

type FeatureTone = 'charcoal' | 'lime' | 'purple' | 'custom'

const TASK_SWIPE_REVEAL_PX = APPLE_SWIPE_ACTION_WIDTH * 3 + APPLE_SWIPE_ACTION_GAP * 2
const TASK_SWIPE_COMMIT_PX = 58
const TASK_SWIPE_DIRECTION_LOCK_PX = 10
const TASK_SWIPE_OPEN_EVENT = 'task-pwa:task-swipe-open'

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
}) {
  const reduceMotion = useReducedMotion()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const [confirming, setConfirming] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const swipeRootRef = useRef<HTMLLIElement>(null)
  const swipeForegroundRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [swipeOpen, setSwipeOpen] = useState(false)
  const swipeX = useMotionValue(0)
  const swipeActionOpacity = useTransform(swipeX, [-24, -8, 0], [1, 0.45, 0])
  const swipeAnimation = useRef<AnimationPlaybackControls | null>(null)
  const swipeGesture = useRef<{
    pointerId: number
    startX: number
    startY: number
    startOffset: number
    axis: 'pending' | 'horizontal' | 'vertical'
    history: Array<{ x: number; time: number }>
  } | null>(null)
  const [menuPosition, setMenuPosition] = useState<{
    top: number
    left: number
    transformOrigin: string
  } | null>(null)

  useMotionValueEvent(swipeX, 'change', (value) => {
    applySwipePresentation(swipeRootRef.current, value, TASK_SWIPE_REVEAL_PX)
    if (swipeForegroundRef.current) {
      swipeForegroundRef.current.style.transform = `translate3d(${value}px, 0, 0)`
    }
  })

  useEffect(() => () => {
    clearTimeout(timer.current)
    swipeAnimation.current?.stop()
  }, [])
  useEffect(() => setDraft(title), [title])
  useEffect(() => {
    if (!menuOpen) {
      setConfirming(false)
      clearTimeout(timer.current)
    }
  }, [menuOpen])

  function settleSwipe(target: number, velocity = 0) {
    swipeAnimation.current?.stop()
    if (reduceMotion) {
      swipeX.set(target)
      return
    }
    swipeAnimation.current = animate(swipeX, target, {
      type: 'spring',
      stiffness: 430,
      damping: 38,
      mass: 0.78,
      velocity,
    })
  }

  function closeSwipe() {
    setSwipeOpen(false)
    settleSwipe(0)
  }

  function openSwipe() {
    window.dispatchEvent(new CustomEvent(TASK_SWIPE_OPEN_EVENT, { detail: menuId ?? title }))
    setSwipeOpen(true)
    onMenuClose?.()
  }

  useEffect(() => {
    if (swipeGesture.current?.axis === 'horizontal') return
    settleSwipe(swipeOpen ? -TASK_SWIPE_REVEAL_PX : 0)
    // The spring intentionally inherits the live presentation value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion, swipeOpen])

  useEffect(() => {
    const rowId = menuId ?? title
    const closeForAnotherRow = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== rowId) closeSwipe()
    }
    const closeWhenHidden = () => {
      if (document.visibilityState !== 'visible') closeSwipe()
    }
    const closeOnRoute = () => closeSwipe()
    window.addEventListener(TASK_SWIPE_OPEN_EVENT, closeForAnotherRow)
    window.addEventListener('hashchange', closeOnRoute)
    document.addEventListener('visibilitychange', closeWhenHidden)
    return () => {
      window.removeEventListener(TASK_SWIPE_OPEN_EVENT, closeForAnotherRow)
      window.removeEventListener('hashchange', closeOnRoute)
      document.removeEventListener('visibilitychange', closeWhenHidden)
    }
    // closeSwipe intentionally hands off from the current presentation value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuId, title])

  useEffect(() => {
    if (!swipeOpen) return
    const closeWhenOutside = (event: PointerEvent) => {
      if (swipeRootRef.current?.contains(event.target as Node)) return
      closeSwipe()
    }
    const closeOnScroll = () => closeSwipe()
    document.addEventListener('pointerdown', closeWhenOutside, true)
    document.addEventListener('scroll', closeOnScroll, true)
    return () => {
      document.removeEventListener('pointerdown', closeWhenOutside, true)
      document.removeEventListener('scroll', closeOnScroll, true)
    }
    // closeSwipe intentionally hands off from the current presentation value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swipeOpen])

  function onSwipePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragging || event.button !== 0) return
    const target = event.target as Element
    if (target.closest('button, input, textarea, select, a, [role="menu"]')) return
    swipeAnimation.current?.stop()
    swipeGesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: swipeX.get(),
      axis: 'pending',
      history: [{ x: event.clientX, time: event.timeStamp }],
    }
  }

  function onSwipePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const state = swipeGesture.current
    if (!state || state.pointerId !== event.pointerId) return
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (state.axis === 'pending') {
      if (Math.hypot(dx, dy) < TASK_SWIPE_DIRECTION_LOCK_PX) return
      if (Math.abs(dy) >= Math.abs(dx) * 0.9) {
        state.axis = 'vertical'
        closeSwipe()
        return
      }
      state.axis = 'horizontal'
      event.currentTarget.setPointerCapture(event.pointerId)
      openSwipe()
    }
    if (state.axis !== 'horizontal') return
    event.preventDefault()
    const raw = state.startOffset + dx
    const next = raw < -TASK_SWIPE_REVEAL_PX
      ? -TASK_SWIPE_REVEAL_PX - Math.min(18, Math.abs(raw + TASK_SWIPE_REVEAL_PX) * 0.22)
      : raw > 0
        ? Math.min(12, raw * 0.18)
        : raw
    swipeX.set(next)
    state.history.push({ x: event.clientX, time: event.timeStamp })
    if (state.history.length > 4) state.history.shift()
  }

  function finishSwipe(event: ReactPointerEvent<HTMLDivElement>, cancelled = false) {
    const state = swipeGesture.current
    if (!state || state.pointerId !== event.pointerId) return
    swipeGesture.current = null
    if (state.axis !== 'horizontal') return
    const recent = state.history[state.history.length - 1]
    const older = state.history[0]
    const elapsed = Math.max(1, recent.time - older.time)
    const velocity = ((recent.x - older.x) / elapsed) * 1000
    const current = swipeX.get()
    const projected = current + velocity * 0.06
    const shouldOpen = !cancelled && (
      current <= -TASK_SWIPE_COMMIT_PX ||
      (current < -18 && projected <= -TASK_SWIPE_COMMIT_PX)
    )
    if (shouldOpen) openSwipe()
    else setSwipeOpen(false)
    settleSwipe(shouldOpen ? -TASK_SWIPE_REVEAL_PX : 0, velocity)
  }

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
      ref={swipeRootRef}
      layout="position"
      initial={false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
      transition={reduceMotion ? MOTION.reduced : MOTION.list}
      data-no-route-swipe
      data-task-swipe-id={menuId ?? title}
      data-swipe-open={swipeOpen || undefined}
      className="task-card-shell"
    >
      <motion.div
        className="task-swipe-actions apple-swipe-action-layer"
        data-swipe-layer="actions"
        aria-label={`${title} 的滑动操作`}
        style={{ opacity: swipeActionOpacity }}
      >
        <button
          type="button"
          className="task-swipe-action task-swipe-more"
          aria-label={`更多 ${title}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            closeSwipe()
            onMenuToggle?.()
          }}
        >
          <span className="apple-swipe-action__pill" aria-hidden="true">
            <AppIcon name="more" size={24} />
          </span>
          <span className="apple-swipe-action__label">更多</span>
        </button>
        <button
          type="button"
          className="task-swipe-action task-swipe-edit"
          aria-label={`编辑 ${title}`}
          disabled={!actions.onEdit}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            closeSwipe()
            actions.onEdit?.()
          }}
        >
          <span className="apple-swipe-action__pill" aria-hidden="true">
            <AppIcon name="edit" size={24} />
          </span>
          <span className="apple-swipe-action__label">编辑</span>
        </button>
        <button
          type="button"
          className="task-swipe-action task-swipe-delete"
          aria-label={`删除 ${title}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            closeSwipe()
            actions.onDelete()
          }}
        >
          <span className="apple-swipe-action__pill" aria-hidden="true">
            <AppIcon name="trash" size={24} />
          </span>
          <span className="apple-swipe-action__label">删除</span>
        </button>
      </motion.div>
      <div
        ref={(node) => {
          swipeForegroundRef.current = node
          if (node) node.style.transform = `translate3d(${swipeX.get()}px, 0, 0)`
        }}
        className="task-card-swipe-content apple-swipe-foreground"
        data-swipe-layer="foreground"
        onPointerDown={onSwipePointerDown}
        onPointerMove={onSwipePointerMove}
        onPointerUp={(event) => finishSwipe(event)}
        onPointerCancel={(event) => finishSwipe(event, true)}
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
      </div>
    </motion.li>
  )
}
