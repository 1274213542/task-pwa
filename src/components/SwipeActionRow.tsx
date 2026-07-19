import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import AppIcon, { type AppIconName } from './AppIcon'

const ACTION_WIDTH = 68
const ACTION_GAP = 4
const COMMIT_DISTANCE = 58
const DIRECTION_LOCK = 10
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
}: {
  id: string
  label: string
  actions: SwipeRowAction[]
  children: ReactNode
  className?: string
  contentClassName?: string
}) {
  const rootRef = useRef<HTMLLIElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const reveal = actions.length * ACTION_WIDTH + Math.max(0, actions.length - 1) * ACTION_GAP
  const [reduceMotion, setReduceMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const contentAnimation = useRef<Animation | null>(null)
  const railAnimation = useRef<Animation | null>(null)
  const presentation = useRef(0)
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
    const progress = Math.min(1, Math.max(0, Math.abs(value) / Math.max(1, reveal)))
    return {
      opacity: value > -8 ? 0 : Math.min(1, Math.max(0, (Math.abs(value) - 8) / 20)),
      scale: 0.9 + progress * 0.1,
    }
  }

  function applyPresentation(value: number) {
    presentation.current = value
    if (contentRef.current) {
      contentRef.current.style.transform = `translate3d(${value}px, 0, 0)`
    }
    if (railRef.current) {
      const rail = railPresentation(value)
      railRef.current.style.opacity = `${rail.opacity}`
      railRef.current.style.transform = `scale(${rail.scale})`
    }
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
    applyPresentation(current)
    return current
  }

  function settle(target: number, velocity = 0) {
    const content = contentRef.current
    const railElement = railRef.current
    const current = stopAtCurrentPosition()
    if (!content || reduceMotion || Math.abs(target - current) < 0.5) {
      applyPresentation(target)
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
      railAnimation.current?.cancel()
      railAnimation.current = null
      applyPresentation(target)
      animation.cancel()
    }
  }

  function close() {
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
    const next = raw < -reveal
      ? -reveal - Math.min(18, Math.abs(raw + reveal) * 0.22)
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
    const shouldOpen = !cancelled && (
      current <= -COMMIT_DISTANCE ||
      (current < -18 && projected <= -COMMIT_DISTANCE)
    )
    if (shouldOpen) markOpen()
    else setOpen(false)
    settle(shouldOpen ? -reveal : 0, velocity)
  }

  if (!actions.length) {
    return <li className={contentClassName}>{children}</li>
  }

  return (
    <li
      ref={rootRef}
      data-no-route-swipe
      data-apple-swipe-id={id}
      data-swipe-open={open || undefined}
      className={`apple-swipe-row ${className}`.trim()}
      style={{ '--apple-swipe-width': `${reveal}px` } as CSSProperties}
    >
      <div
        ref={railRef}
        className="apple-swipe-actions"
        aria-label={`${label} 的滑动操作`}
        style={{ opacity: 0, transform: 'scale(0.9)' }}
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
            <AppIcon name={action.icon} size={18} />
            <span>{action.label}</span>
          </button>
        ))}
      </div>
      <div
        ref={contentRef}
        className={`apple-swipe-content ${contentClassName}`.trim()}
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
        {children}
      </div>
    </li>
  )
}
