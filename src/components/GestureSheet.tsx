import {
  animate,
  motion,
  useDragControls,
  useMotionValue,
  useReducedMotion,
  type PanInfo,
} from 'motion/react'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { MOTION, projectVelocity } from '../lib/motion'

export interface GestureSheetHandle {
  close: (velocity?: number) => void
}

interface GestureSheetProps {
  children: ReactNode
  className: string
  dialogRef: RefObject<HTMLElement | null>
  labelledBy: string
  onClose: () => void
  canClose?: () => boolean
}

function viewportHeight() {
  return window.visualViewport?.height ?? window.innerHeight
}

/**
 * Interruptible editor surface.
 *
 * The drag handle owns the vertical gesture so fields keep their native scroll
 * and selection behavior. Closing always starts from the live y MotionValue;
 * a new drag stops that spring and immediately resumes 1:1 pointer tracking.
 */
const GestureSheet = forwardRef<GestureSheetHandle, GestureSheetProps>(
  function GestureSheet(
    { children, className, dialogRef, labelledBy, onClose, canClose },
    forwardedRef,
  ) {
    const reduceMotion = useReducedMotion()
    const [mobile, setMobile] = useState(() => window.innerWidth < 1024)
    const dragControls = useDragControls()
    const y = useMotionValue(reduceMotion ? 0 : mobile ? viewportHeight() + 32 : 18)
    const scrimOpacity = useMotionValue(0)
    const running = useRef<ReturnType<typeof animate> | null>(null)
    const scrimRunning = useRef<ReturnType<typeof animate> | null>(null)
    const closing = useRef(false)
    const closed = useRef(false)

    function stopRunning() {
      running.current?.stop()
      scrimRunning.current?.stop()
    }

    function close(velocity = 0): boolean {
      if (closed.current) return true
      if (!closing.current && canClose && !canClose()) return false
      closing.current = true
      stopRunning()

      if (reduceMotion) {
        scrimRunning.current = animate(scrimOpacity, 0, {
          ...MOTION.reduced,
          onComplete: () => {
            if (!closing.current || closed.current) return
            closed.current = true
            onClose()
          },
        })
        return true
      }

      scrimRunning.current = animate(scrimOpacity, 0, MOTION.control)
      running.current = animate(y, mobile ? viewportHeight() + 48 : 28, {
        ...MOTION.sheet,
        velocity,
        onComplete: () => {
          if (!closing.current || closed.current) return
          closed.current = true
          onClose()
        },
      })
      return true
    }

    useImperativeHandle(forwardedRef, () => ({ close }))

    useEffect(() => {
      const query = window.matchMedia('(max-width: 1023px)')
      const update = () => setMobile(query.matches)
      query.addEventListener('change', update)
      return () => query.removeEventListener('change', update)
    }, [])

    useEffect(() => {
      closing.current = false
      closed.current = false
      if (reduceMotion) {
        y.set(0)
        scrimRunning.current = animate(scrimOpacity, 1, MOTION.reduced)
      } else {
        y.set(mobile ? viewportHeight() + 32 : 18)
        running.current = animate(y, 0, MOTION.sheet)
        scrimRunning.current = animate(scrimOpacity, 1, MOTION.control)
      }
      return stopRunning
    }, [mobile, reduceMotion, scrimOpacity, y])

    function onDragStart() {
      closing.current = false
      stopRunning()
    }

    function onDrag(_: PointerEvent, info: PanInfo) {
      const progress = Math.max(0, info.offset.y) / Math.max(1, viewportHeight() * 0.72)
      scrimOpacity.set(Math.max(0, 1 - progress))
    }

    function onDragEnd(_: PointerEvent, info: PanInfo) {
      const projected = info.offset.y + projectVelocity(info.velocity.y, 0.99)
      const threshold = Math.min(190, viewportHeight() * 0.22)
      if (projected > threshold || info.velocity.y > 720) {
        // A dirty editor can reject dismissal. In that case the sheet must
        // return from its live dragged position instead of staying half open
        // with a faded scrim.
        if (close(info.velocity.y)) return
      }

      closing.current = false
      running.current = animate(y, 0, {
        ...MOTION.momentum,
        velocity: info.velocity.y,
      })
      scrimRunning.current = animate(scrimOpacity, 1, MOTION.control)
    }

    return createPortal(
      <div className="gesture-sheet-root fixed inset-0 z-40">
        <motion.div
          aria-hidden="true"
          className="modal-backdrop gesture-sheet-scrim absolute inset-0"
          style={{ opacity: scrimOpacity }}
          onPointerDown={(event) => event.target === event.currentTarget && close()}
        />
        <div className="gesture-sheet-stage pointer-events-none absolute inset-0 flex items-end justify-center px-3 pt-8 lg:items-center">
          <motion.section
          ref={dialogRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          drag={mobile && !reduceMotion ? 'y' : false}
          dragControls={dragControls}
          dragListener={false}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0.035, bottom: 0.42 }}
          dragMomentum={false}
          onDragStart={onDragStart}
          onDrag={onDrag}
          onDragEnd={onDragEnd}
          onPointerDown={(event) => {
            if (!mobile || reduceMotion) return
            const target = event.target as Element
            if (!target.closest('[data-sheet-drag-handle]')) return
            if (target.closest('button, a, input, textarea, select, [role="button"]')) return
            onDragStart()
            dragControls.start(event)
          }}
          style={{ y }}
            className={`${className} pointer-events-auto`}
          >
            <button
              type="button"
              aria-label="下拉关闭编辑面板"
              className="editor-sheet-handle lg:hidden"
              onPointerDown={(event) => {
                onDragStart()
                dragControls.start(event)
              }}
            >
              <span aria-hidden />
            </button>
            {children}
          </motion.section>
        </div>
      </div>,
      document.body,
    )
  },
)

export default GestureSheet
