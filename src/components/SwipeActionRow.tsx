import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import AppIcon, { type AppIconName } from './AppIcon'
import {
  APPLE_SWIPE_ACTION_GAP,
  APPLE_SWIPE_ACTION_WIDTH,
  applySwipePresentation,
} from '../lib/swipePresentation'

const COMMIT_DISTANCE = 52
const DIRECTION_LOCK = 10
const FULL_SWIPE_DISTANCE_RATIO = 0.62
const FULL_SWIPE_FLING_RATIO = 0.28
const FULL_SWIPE_VELOCITY = 900
const OPEN_EVENT = 'task-pwa:apple-swipe-open'
const SETTLE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

export interface SwipeRowAction {
  label: string
  icon: AppIconName
  tone?: 'neutral' | 'accent' | 'danger'
  disabled?: boolean
  onSelect: () => void
}

export default function SwipeActionRow({
  id,
  label,
  actions,
  children,
  className = '',
  contentClassName = '',
  contentProps,
  as = 'li',
  resetKey,
  divider = false,
  fullSwipe = false,
}: {
  id: string
  label: string
  actions: SwipeRowAction[]
  children: ReactNode
  className?: string
  contentClassName?: string
  contentProps?: HTMLAttributes<HTMLDivElement>
  as?: 'li' | 'div'
  /** Changing list mode, group or date closes an in-flight transient action. */
  resetKey?: string
  /** One structural divider owned by the moving foreground, never the row shell. */
  divider?: boolean
  /** Enables a proportional full-swipe commit using the last danger action. */
  fullSwipe?: boolean
}) {
  const rootRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const reveal = actions.length * APPLE_SWIPE_ACTION_WIDTH +
    Math.max(0, actions.length - 1) * APPLE_SWIPE_ACTION_GAP
  const [reduceMotion, setReduceMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const contentAnimation = useRef<Animation | null>(null)
  const railAnimation = useRef<Animation | null>(null)
  const presentationFrame = useRef<number | null>(null)
  const presentation = useRef(0)
  const rowWidth = useRef(reveal)
  const committingFullSwipe = useRef(false)
  const suppressNextClick = useRef(false)
  const [open, setOpen] = useState(false)
  const gesture = useRef<{
    pointerId: number
    startX: number
    startY: number
    startOffset: number
    axis: 'pending' | 'horizontal' | 'vertical'
    history: Array<{ x: number; time: number }>
  } | null>(null)

  function railPresentation(value: number) {
    return {
      opacity: value > -8 ? 0 : Math.min(1, Math.max(0, (Math.abs(value) - 8) / 20)),
      scale: 1,
    }
  }

  function applyPresentation(value: number) {
    presentation.current = value
    applySwipePresentation(rootRef.current, value, reveal, rowWidth.current)
    if (contentRef.current) {
      contentRef.current.style.transform = `translate3d(${value}px, 0, 0)`
    }
    if (railRef.current) {
      const rail = railPresentation(value)
      railRef.current.style.opacity = `${rail.opacity}`
      railRef.current.style.transform = `scale(${rail.scale})`
    }
  }

  function stopPresentationFrame() {
    if (presentationFrame.current === null) return
    cancelAnimationFrame(presentationFrame.current)
    presentationFrame.current = null
  }

  function followAnimatedPresentation() {
    stopPresentationFrame()
    const update = () => {
      if (!contentAnimation.current) {
        presentationFrame.current = null
        return
      }
      applySwipePresentation(rootRef.current, liveOffset(), reveal, rowWidth.current)
      presentationFrame.current = requestAnimationFrame(update)
    }
    presentationFrame.current = requestAnimationFrame(update)
  }

  function liveOffset() {
    const element = contentRef.current
    if (!element) return presentation.current
    const transform = getComputedStyle(element).transform
    if (!transform || transform === 'none') return presentation.current
    try {
      return new DOMMatrixReadOnly(transform).m41
    } catch {
      const matrix = transform.match(/^matrix\(([^)]+)\)$/)
      if (!matrix) return presentation.current
      const values = matrix[1].split(',').map(Number)
      return Number.isFinite(values[4]) ? values[4] : presentation.current
    }
  }

  function stopAtCurrentPosition() {
    const current = liveOffset()
    contentAnimation.current?.cancel()
    railAnimation.current?.cancel()
    contentAnimation.current = null
    railAnimation.current = null
    stopPresentationFrame()
    applyPresentation(current)
    return current
  }

  function settle(target: number, velocity = 0, onFinish?: () => void) {
    const content = contentRef.current
    const railElement = railRef.current
    const current = stopAtCurrentPosition()
    if (!content || reduceMotion || Math.abs(target - current) < 0.5) {
      applyPresentation(target)
      onFinish?.()
      return
    }

    const distance = Math.abs(target - current)
    const duration = Math.max(180, Math.min(260, 200 + distance * 0.24 - Math.min(36, Math.abs(velocity) * 0.012)))
    const fromRail = railPresentation(current)
    const toRail = railPresentation(target)
    const animation = content.animate(
      [
        { transform: `translate3d(${current}px, 0, 0)` },
        { transform: `translate3d(${target}px, 0, 0)` },
      ],
      { duration, easing: SETTLE_EASING, fill: 'forwards' },
    )
    contentAnimation.current = animation
    followAnimatedPresentation()

    if (railElement) {
      railAnimation.current = railElement.animate(
        [
          { opacity: fromRail.opacity, transform: `scale(${fromRail.scale})` },
          { opacity: toRail.opacity, transform: `scale(${toRail.scale})` },
        ],
        { duration, easing: SETTLE_EASING, fill: 'forwards' },
      )
    }

    animation.onfinish = () => {
      if (contentAnimation.current !== animation) return
      contentAnimation.current = null
      stopPresentationFrame()
      railAnimation.current?.cancel()
      railAnimation.current = null
      applyPresentation(target)
      animation.cancel()
      onFinish?.()
    }
  }

  function close() {
    if (committingFullSwipe.current) return
    setOpen(false)
    settle(0)
  }

  function markOpen() {
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }))
    setOpen(true)
  }

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduceMotion(query.matches)
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])

  useEffect(() => () => {
    contentAnimation.current?.cancel()
    railAnimation.current?.cancel()
    stopPresentationFrame()
  }, [])

  useEffect(() => {
    const closeForAnotherRow = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) close()
    }
    const closeOnRoute = () => close()
    const closeWhenHidden = () => {
      if (document.visibilityState !== 'visible') close()
    }
    window.addEventListener(OPEN_EVENT, closeForAnotherRow)
    window.addEventListener('hashchange', closeOnRoute)
    document.addEventListener('visibilitychange', closeWhenHidden)
    return () => {
      window.removeEventListener(OPEN_EVENT, closeForAnotherRow)
      window.removeEventListener('hashchange', closeOnRoute)
      document.removeEventListener('visibilitychange', closeWhenHidden)
    }
    // close deliberately hands off from the live transform value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    close()
    // The reset key is deliberately a semantic boundary, not animation state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  useEffect(() => {
    if (!open) return
    const closeWhenOutside = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      close()
    }
    const closeOnScroll = () => close()
    document.addEventListener('pointerdown', closeWhenOutside, true)
    document.addEventListener('scroll', closeOnScroll, true)
    return () => {
      document.removeEventListener('pointerdown', closeWhenOutside, true)
      document.removeEventListener('scroll', closeOnScroll, true)
    }
    // close deliberately hands off from the live transform value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    const target = event.target as Element
    const explicitHandle = target.closest('[data-row-swipe-handle]')
    if (!explicitHandle && target.closest('button, input, textarea, select, a, [role="menu"], [data-no-row-swipe]')) return
    const startOffset = stopAtCurrentPosition()
    rowWidth.current = Math.max(reveal, rootRef.current?.getBoundingClientRect().width ?? reveal)
    gesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset,
      axis: 'pending',
      history: [{ x: event.clientX, time: event.timeStamp }],
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const state = gesture.current
    if (!state || state.pointerId !== event.pointerId) return
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (state.axis === 'pending') {
      if (Math.hypot(dx, dy) < DIRECTION_LOCK) return
      if (Math.abs(dy) >= Math.abs(dx) * 0.9) {
        state.axis = 'vertical'
        close()
        return
      }
      state.axis = 'horizontal'
      suppressNextClick.current = true
      event.currentTarget.setPointerCapture(event.pointerId)
      markOpen()
    }
    if (state.axis !== 'horizontal') return
    event.preventDefault()
    const raw = state.startOffset + dx
    const maxTravel = fullSwipe ? rowWidth.current : reveal + 18
    const next = raw < -reveal
      ? Math.max(-maxTravel, fullSwipe
        ? raw
        : -reveal - Math.min(18, Math.abs(raw + reveal) * 0.22))
      : raw > 0
        ? Math.min(12, raw * 0.18)
        : raw
    applyPresentation(next)
    state.history.push({ x: event.clientX, time: event.timeStamp })
    if (state.history.length > 4) state.history.shift()
  }

  function finish(event: ReactPointerEvent<HTMLDivElement>, cancelled = false) {
    const state = gesture.current
    if (!state || state.pointerId !== event.pointerId) return
    gesture.current = null
    if (state.axis !== 'horizontal') return
    const recent = state.history[state.history.length - 1]
    const older = state.history[0]
    const elapsed = Math.max(1, recent.time - older.time)
    const velocity = ((recent.x - older.x) / elapsed) * 1000
    const current = liveOffset()
    const projected = current + velocity * 0.06
    const distance = Math.abs(Math.min(0, current))
    const shouldFullSwipe = fullSwipe && !cancelled && actions.at(-1)?.tone === 'danger' && (
      distance >= rowWidth.current * FULL_SWIPE_DISTANCE_RATIO ||
      (velocity <= -FULL_SWIPE_VELOCITY && distance >= rowWidth.current * FULL_SWIPE_FLING_RATIO)
    )
    if (shouldFullSwipe) {
      committingFullSwipe.current = true
      setOpen(false)
      rootRef.current?.setAttribute('data-full-swipe-committing', 'true')
      settle(-rowWidth.current - 8, velocity, () => {
        actions.at(-1)?.onSelect()
        committingFullSwipe.current = false
        window.setTimeout(() => {
          rootRef.current?.removeAttribute('data-full-swipe-committing')
          if (!rootRef.current?.isConnected) return
          setOpen(false)
          applyPresentation(0)
        }, 280)
      })
      return
    }
    const shouldOpen = !cancelled && (
      current <= -COMMIT_DISTANCE ||
      (current < -18 && projected <= -COMMIT_DISTANCE)
    )
    if (shouldOpen) markOpen()
    else setOpen(false)
    settle(shouldOpen ? -reveal : 0, velocity)
  }

  const Root = as

  if (!actions.length) return <Root className={contentClassName}>{children}</Root>

  return (
    <Root
      ref={(node: HTMLLIElement | HTMLDivElement | null) => {
        rootRef.current = node
      }}
      data-no-route-swipe
      data-apple-swipe-id={id}
      data-swipe-open={open || undefined}
      data-divider={divider || undefined}
      data-full-swipe-enabled={fullSwipe || undefined}
      className={`apple-swipe-row ${className}`.trim()}
      style={{
        '--apple-swipe-width': `${reveal}px`,
        '--swipe-progress': 0,
        '--swipe-delete-progress': 0,
        '--swipe-secondary-progress': 0,
        '--swipe-leading-progress': 0,
        '--swipe-overshoot': 0,
        '--swipe-full-progress': 0,
        '--swipe-row-width': `${reveal}px`,
      } as CSSProperties}
    >
      <div
        ref={railRef}
        className="apple-swipe-actions apple-swipe-action-layer"
        data-swipe-layer="actions"
        aria-label={`${label} 的滑动操作`}
        style={{ opacity: 0, transform: 'scale(1)' }}
      >
        {actions.map((action) => (
          <button
            key={`${action.label}:${action.icon}`}
            type="button"
            disabled={action.disabled}
            className={`apple-swipe-action is-${action.tone ?? 'neutral'}`}
            aria-label={`${action.label} ${label}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              close()
              action.onSelect()
            }}
          >
            <span className="apple-swipe-action__pill" aria-hidden="true">
              <AppIcon name={action.icon} size={18} />
            </span>
            <span className="apple-swipe-action__label">{action.label}</span>
          </button>
        ))}
      </div>
      <div
        ref={contentRef}
        {...contentProps}
        className={`apple-swipe-content apple-swipe-foreground ${contentClassName}`.trim()}
        data-swipe-layer="foreground"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => finish(event)}
        onPointerCancel={(event) => finish(event, true)}
        onClickCapture={(event) => {
          if (!suppressNextClick.current) return
          suppressNextClick.current = false
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        {divider && <span className="apple-swipe-divider" aria-hidden="true" />}
        {children}
      </div>
    </Root>
  )
}
