import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion, useReducedMotion } from 'motion/react'
import { Temporal } from 'temporal-polyfill'
import { useNavigate } from 'react-router-dom'
import {
  db,
  type CalendarEvent,
  type ColorToken,
  type MarkerSymbol,
  type TaskScope,
} from '../lib/db'
import { type CalItem, buildCalendarItems, monthGrid } from '../lib/calendar'
import { useCivilDate } from '../lib/useCivilDate'
import { addEvent, softDeleteEvent, toggleEventCompletion, updateEvent } from '../lib/events'
import {
  RecurrenceConflictError,
  addTasks,
  completeFixedOccurrence,
  completeTask,
  resolveAfterCompletion,
  skipFixedOccurrence,
  softDeleteTask,
  updateTask,
  voidRecord,
} from '../lib/tasks'
import { parseBatchLines } from '../lib/batch'
import EventEditor from '../components/EventEditor'
import TaskEditor, { type EditableTaskStatus } from '../components/TaskEditor'
import PageHeader from '../components/PageHeader'
import AppIcon from '../components/AppIcon'
import MarkerIcon from '../components/MarkerIcon'
import { FOCUS_QUICK_ADD_EVENT } from '../lib/appEvents'
import { MOTION } from '../lib/motion'
import MobilePageHeader from '../components/MobilePageHeader'
import SegmentedIndicator from '../components/SegmentedIndicator'
import SwipeActionRow from '../components/SwipeActionRow'

const WEEK_LABELS_MON = ['一', '二', '三', '四', '五', '六', '日']
const WEEK_LABELS_SUN = ['日', '一', '二', '三', '四', '五', '六']
type PlanMode = 'month' | 'week' | 'agenda'
const MODE_ORDER: Record<PlanMode, number> = { month: 0, week: 1, agenda: 2 }

function weekStart(dateISO: string, weekStartsOn: 1 | 0) {
  const date = Temporal.PlainDate.from(dateISO)
  const lead = weekStartsOn === 1 ? date.dayOfWeek - 1 : date.dayOfWeek % 7
  return date.subtract({ days: lead })
}

function dateLabel(dateISO: string, options?: Intl.DateTimeFormatOptions) {
  return new Date(`${dateISO}T00:00:00`).toLocaleDateString('zh-CN', options)
}

function minutesFromTime(value: string | null) {
  if (!value) return 9 * 60
  const [hour, minute] = value.split(':').map(Number)
  return Math.max(0, Math.min(23 * 60 + 45, hour * 60 + minute))
}

function timeFromMinutes(value: number) {
  const normalized = Math.max(0, Math.min(23 * 60 + 45, Math.round(value / 15) * 15))
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

/**
 * A 300ms hold hands the gesture from vertical scrolling to scheduling.
 * Horizontal swipes stay owned by SwipeActionRow; early movement cancels the
 * timer, so an ordinary scroll never silently changes an item's date.
 */
function TimelineScheduleRow({
  date,
  time,
  disabled = false,
  onCommit,
  children,
}: {
  date: string
  time: string | null
  disabled?: boolean
  onCommit: (date: string, time: string) => Promise<void>
  children: ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<number | null>(null)
  const gestureRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    active: boolean
    startScrollY: number
    targetDate: string
    targetMinutes: number
  } | null>(null)
  const activeTouchBlocker = useRef((event: TouchEvent) => {
    if (gestureRef.current?.active) event.preventDefault()
  })
  const suppressClickRef = useRef(false)
  const [dragState, setDragState] = useState<{ dx: number; dy: number; date: string; time: string } | null>(null)

  function clearTimer() {
    if (timerRef.current === null) return
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }

  function clearTouchBlocker() {
    rootRef.current?.removeEventListener('touchmove', activeTouchBlocker.current)
  }

  useEffect(() => () => {
    clearTimer()
    clearTouchBlocker()
  }, [])

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0) return
    const target = event.target as Element
    if (target.closest('.apple-swipe-actions, [data-no-time-drag], input, textarea, select')) return
    clearTimer()
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      startScrollY: window.scrollY,
      targetDate: date,
      targetMinutes: minutesFromTime(time),
    }
    timerRef.current = window.setTimeout(() => {
      const gesture = gestureRef.current
      if (!gesture) return
      gesture.active = true
      suppressClickRef.current = true
      rootRef.current?.setPointerCapture(gesture.pointerId)
      rootRef.current?.addEventListener('touchmove', activeTouchBlocker.current, { passive: false })
      setDragState({ dx: 0, dy: 0, date, time: timeFromMinutes(gesture.targetMinutes) })
      navigator.vibrate?.(8)
    }, 300)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const dx = event.clientX - gesture.startX
    const dy = event.clientY - gesture.startY
    if (!gesture.active) {
      if (Math.hypot(dx, dy) > 9) {
        clearTimer()
        clearTouchBlocker()
        gestureRef.current = null
      }
      return
    }
    event.preventDefault()
    const dayOffset = Math.max(-3, Math.min(3, Math.round(dx / 76)))
    const targetDate = Temporal.PlainDate.from(date).add({ days: dayOffset }).toString()
    const scrollDelta = window.scrollY - gesture.startScrollY
    const targetMinutes = minutesFromTime(time) + Math.round((dy + scrollDelta) / 12) * 15
    gesture.targetDate = targetDate
    gesture.targetMinutes = targetMinutes
    setDragState({ dx, dy, date: targetDate, time: timeFromMinutes(targetMinutes) })
    const edge = 92
    if (event.clientY < edge) window.scrollBy({ top: -12, behavior: 'auto' })
    else if (event.clientY > window.innerHeight - edge) window.scrollBy({ top: 12, behavior: 'auto' })
  }

  function finish(event: ReactPointerEvent<HTMLDivElement>, cancelled = false) {
    clearTimer()
    clearTouchBlocker()
    const gesture = gestureRef.current
    gestureRef.current = null
    if (!gesture?.active) return
    event.preventDefault()
    setDragState(null)
    if (!cancelled) void onCommit(gesture.targetDate, timeFromMinutes(gesture.targetMinutes))
    window.setTimeout(() => { suppressClickRef.current = false }, 0)
  }

  return (
    <div
      ref={rootRef}
      className="timeline-schedule-row"
      data-dragging={dragState ? true : undefined}
      style={dragState ? {
        '--timeline-drag-x': `${dragState.dx}px`,
        '--timeline-drag-y': `${dragState.dy}px`,
      } as React.CSSProperties : undefined}
      onPointerDown={onPointerDown}
      onPointerMoveCapture={(event) => {
        if (!gestureRef.current?.active) return
        onPointerMove(event)
        event.stopPropagation()
      }}
      onPointerMove={(event) => {
        if (!gestureRef.current?.active) onPointerMove(event)
      }}
      onPointerUp={(event) => finish(event)}
      onPointerCancel={(event) => finish(event, true)}
      onClickCapture={(event) => {
        if (!suppressClickRef.current) return
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      {children}
      {dragState && (
        <span className="timeline-drop-feedback" role="status">
          {dragState.date === date ? '' : `${dragState.date.slice(5)} · `}{dragState.time}
        </span>
      )}
    </div>
  )
}

export default function Plan() {
  const navigate = useNavigate()
  const todayISO = useCivilDate()
  const reduceMotion = useReducedMotion()
  const [mode, setMode] = useState<PlanMode>(() => {
    const stored = localStorage.getItem('planMode')
    return stored === 'week' || stored === 'agenda'
      ? stored
      : stored === 'list'
        ? 'agenda'
        : 'month'
  })
  const [cursor, setCursor] = useState(() =>
    Temporal.PlainDate.from(todayISO).with({ day: 1 }),
  )
  const [selected, setSelected] = useState(todayISO)
  const [modeDirection, setModeDirection] = useState(1)
  const [periodDirection, setPeriodDirection] = useState(1)
  const [dayDirection, setDayDirection] = useState(1)
  const [draft, setDraft] = useState('')
  const [draftKind, setDraftKind] = useState<'event' | 'task'>('event')
  const [draftTime, setDraftTime] = useState('')
  const [draftScope, setDraftScope] = useState<TaskScope>('daily')
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const [editingTask, setEditingTask] = useState<
    Extract<CalItem, { kind: 'task' }> | null
  >(null)
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const submittingRef = useRef(false)
  const dayPanelRef = useRef<HTMLDivElement>(null)
  const weekBoardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const openComposer = () => {
      setMode('agenda')
      localStorage.setItem('planMode', 'agenda')
      setComposerOpen(true)
    }
    window.addEventListener(FOCUS_QUICK_ADD_EVENT, openComposer)
    return () => window.removeEventListener(FOCUS_QUICK_ADD_EVENT, openComposer)
  }, [])

  const prefs = useLiveQuery(() => db.syncedPreferences.get('#prefs'), [])
  const weekStartsOn = (prefs?.weekStartsOn ?? 1) as 1 | 0
  const tasks = useLiveQuery(
    () => db.tasks.where('lifecycleStatus').equals('active').sortBy('rank'),
    [],
  )
  const records = useLiveQuery(() => db.completionRecords.toArray(), [])
  const events = useLiveQuery(
    () => db.calendarEvents.where('lifecycleStatus').equals('active').toArray(),
    [],
  )
  const categories = useLiveQuery(
    () => db.categories.where('lifecycleStatus').equals('active').toArray(),
    [],
  )
  const workRecords = useLiveQuery(
    () => db.workEntries.where('lifecycleStatus').equals('active').toArray(),
    [],
  )
  const catMap = useMemo(
    () => new Map((categories ?? []).map((category) => [category.id, category])),
    [categories],
  )

  const grid = useMemo(
    () => monthGrid(cursor.year, cursor.month, weekStartsOn),
    [cursor, weekStartsOn],
  )
  const weekDates = useMemo(() => {
    const start = weekStart(selected, weekStartsOn)
    return Array.from({ length: 7 }, (_, index) => start.add({ days: index }).toString())
  }, [selected, weekStartsOn])
  const agendaDates = useMemo(
    () =>
      Array.from({ length: 30 }, (_, index) =>
        Temporal.PlainDate.from(todayISO).add({ days: index }).toString(),
      ),
    [todayISO],
  )
  const [rangeStart, rangeEnd] =
    mode === 'month'
      ? [grid[0], grid[41]]
      : mode === 'week'
        ? [weekDates[0], weekDates[6]]
        : [agendaDates[0], agendaDates[29]]

  const byDay = useMemo(
    () =>
      tasks && records && events
        ? buildCalendarItems(tasks, records, events, rangeStart, rangeEnd, todayISO)
        : undefined,
    [tasks, records, events, rangeStart, rangeEnd, todayISO],
  )

  useEffect(() => {
    if (mode !== 'week' || window.innerWidth >= 1180) return
    const frame = window.requestAnimationFrame(() => {
      const shell = weekBoardRef.current
      const selectedColumn = shell?.querySelector<HTMLElement>('.week-column[data-selected="true"]')
      if (!shell || !selectedColumn) return
      shell.scrollTo({
        left: selectedColumn.offsetLeft - (shell.clientWidth - selectedColumn.clientWidth) / 2,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [mode, selected])

  function switchMode(next: PlanMode) {
    setModeDirection(next === mode ? modeDirection : MODE_ORDER[next] > MODE_ORDER[mode] ? 1 : -1)
    setMode(next)
    localStorage.setItem('planMode', next)
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.app-shell main')?.scrollTo({
        top: 0,
        // The content surface already communicates direction. A second smooth
        // scroll on the page shell made rapid view changes feel queued on iOS.
        behavior: 'auto',
      })
    })
  }

  async function guarded(fn: () => Promise<void>) {
    try {
      await fn()
    } catch (error) {
      if (error instanceof RecurrenceConflictError) alert(error.message)
      else throw error
    }
  }

  async function setTaskStatus(
    item: Extract<CalItem, { kind: 'task' }>,
    status: EditableTaskStatus,
  ) {
    const current: EditableTaskStatus = item.skipped
      ? 'skipped'
      : item.completed
        ? 'completed'
        : 'pending'
    if (status === current) return
    await guarded(async () => {
      const { task, occurrenceKey, date } = item
      const latestTask = (await db.tasks.get(task.id)) ?? task
      if (status === 'pending') {
        if (!occurrenceKey.startsWith('ac:')) await voidRecord(`${task.id}:${occurrenceKey}`)
        return
      }
      if (status === 'completed') {
        if (occurrenceKey === 'single') await completeTask(latestTask)
        else if (occurrenceKey.startsWith('fixed:')) {
          await completeFixedOccurrence(latestTask, date)
        } else {
          await resolveAfterCompletion(latestTask, 'completed')
        }
        return
      }
      if (occurrenceKey.startsWith('fixed:')) await skipFixedOccurrence(latestTask, date)
      else if (occurrenceKey.startsWith('ac:')) {
        await resolveAfterCompletion(latestTask, 'skipped')
      }
    })
  }

  function itemVisual(item: CalItem): { color: ColorToken; marker: MarkerSymbol } {
    const source = item.kind === 'event' ? item.event : item.task
    const category = source.categoryId ? catMap.get(source.categoryId) : undefined
    return {
      color:
        source.visualToken ?? category?.colorToken ?? (item.kind === 'event' ? 'green' : 'purple'),
      marker:
        source.markerSymbol ?? category?.markerSymbol ?? (item.kind === 'event' ? 'diamond' : 'spark'),
    }
  }

  function itemTitle(item: CalItem) {
    return item.kind === 'event' ? item.event.title : item.task.title
  }

  function itemsForDate(dateISO: string) {
    return (byDay?.get(dateISO) ?? []).filter((item) => itemTitle(item).trim().length > 0)
  }

  function itemTime(item: CalItem) {
    const value = item.kind === 'event' ? item.event.startAt : item.task.startAt
    if (!value?.includes('T')) return null
    const direct = value.match(/T(\d{2}:\d{2})/)
    if (direct) return direct[1]
    return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }

  function eventEndTime(item: CalItem) {
    if (item.kind !== 'event' || !item.event.endAt) return undefined
    return Temporal.Instant.from(item.event.endAt)
      .toZonedDateTimeISO(Temporal.Now.timeZoneId())
      .toPlainTime()
      .toString({ smallestUnit: 'minute' })
  }

  function itemTimeLabel(item: CalItem) {
    const start = itemTime(item)
    if (!start) return item.kind === 'event' && item.event.allDay ? '全天' : '未排定'
    const end = eventEndTime(item)
    return end ? `${start} – ${end}` : start
  }

  function openItem(item: CalItem) {
    if (item.kind === 'event') setEditingEvent(item.event)
    else setEditingTask(item)
  }

  function toggleItem(item: CalItem) {
    if (item.kind === 'task') {
      void setTaskStatus(item, item.completed ? 'pending' : 'completed')
    } else {
      void toggleEventCompletion(item.event)
    }
  }

  async function rescheduleItem(item: CalItem, targetDate: string, targetTime: string) {
    try {
      if (item.kind === 'event') {
        const spanDays = Temporal.PlainDate.from(item.event.startDate)
          .until(Temporal.PlainDate.from(item.event.endDate)).days
        await updateEvent(item.event.id, {
          title: item.event.title,
          notes: item.event.notes,
          date: targetDate,
          endDate: Temporal.PlainDate.from(targetDate).add({ days: spanDays }).toString(),
          time: targetTime,
          endTime: eventEndTime(item),
          categoryId: item.event.categoryId,
          visualToken: item.event.visualToken,
          markerSymbol: item.event.markerSymbol,
        })
      } else {
        const task = item.task
        if (task.recurrence || (task.parentTaskId && task.inheritsParentSchedule !== false)) {
          setFeedback('周期任务或继承父任务日期的事项，请通过“更多”编辑排期')
          window.setTimeout(() => setFeedback(''), 2600)
          return
        }
        const previousStartDate = (task.startAt ?? task.startDate ?? item.date).slice(0, 10)
        const dueSharesStart = !task.dueAt || task.dueAt.slice(0, 10) === previousStartDate
        await updateTask(task.id, {
          title: task.title,
          notes: task.notes,
          categoryId: task.categoryId,
          startDate: targetDate,
          endDate: task.endDate,
          taskScope: task.taskScope,
          visualToken: task.visualToken,
          markerSymbol: task.markerSymbol,
          scheduleType: task.scheduleType === 'unscheduled' ? 'today' : task.scheduleType,
          startAt: `${targetDate}T${targetTime}`,
          dueAt: dueSharesStart ? `${targetDate}T${targetTime}` : task.dueAt,
          showBeforeStart: task.showBeforeStart,
          surfaceDaysBeforeDue: task.surfaceDaysBeforeDue,
          parentTaskId: task.parentTaskId,
          inheritsParentSchedule: task.inheritsParentSchedule,
        })
      }
      setSelected(targetDate)
      setFeedback(`已调整到 ${targetDate.slice(5)} ${targetTime}`)
      window.setTimeout(() => setFeedback(''), 1800)
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : '调整时间失败，请重试')
    }
  }

  async function submitDraft() {
    if (!draft.trim() || submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    setFeedback('')
    try {
      const lines = parseBatchLines(draft)
      if (draftKind === 'event') {
        for (const title of lines) {
          await addEvent({ title, date: selected, time: draftTime || undefined })
        }
      } else {
        await addTasks(lines, undefined, undefined, selected, draftScope)
      }
      setDraft('')
      setDraftTime('')
      const noun = draftKind === 'event' ? '计划' : '任务'
      setFeedback(lines.length > 1 ? `已添加 ${lines.length} 个${noun}` : `${noun}已添加`)
      window.setTimeout(() => setFeedback(''), 2200)
    } catch (reason) {
      console.error('添加计划失败', reason)
      setFeedback(reason instanceof Error ? reason.message : '添加失败，请重试')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  function selectDay(dateISO: string) {
    setDayDirection(dateISO >= selected ? 1 : -1)
    setSelected(dateISO)
    const next = Temporal.PlainDate.from(dateISO)
    if (next.year !== cursor.year || next.month !== cursor.month) {
      setPeriodDirection(next.toString() >= cursor.toString() ? 1 : -1)
      setCursor(next.with({ day: 1 }))
    }
    window.requestAnimationFrame(() => {
      if (mode !== 'agenda' || window.innerWidth >= 1180) return
      dayPanelRef.current?.scrollIntoView({
        block: 'nearest',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      })
    })
  }

  function onGridKeyDown(event: React.KeyboardEvent) {
    const delta =
      event.key === 'ArrowLeft'
        ? -1
        : event.key === 'ArrowRight'
          ? 1
          : event.key === 'ArrowUp'
            ? -7
            : event.key === 'ArrowDown'
              ? 7
              : 0
    if (!delta) return
    event.preventDefault()
    selectDay(Temporal.PlainDate.from(selected).add({ days: delta }).toString())
  }

  function changePeriod(delta: number) {
    setPeriodDirection(delta >= 0 ? 1 : -1)
    if (mode === 'month') setCursor(cursor.add({ months: delta }))
    else {
      const next = Temporal.PlainDate.from(selected).add({ days: delta * 7 })
      setSelected(next.toString())
      setCursor(next.with({ day: 1 }))
    }
  }

  function returnToday() {
    setDayDirection(todayISO >= selected ? 1 : -1)
    setPeriodDirection(todayISO >= cursor.toString() ? 1 : -1)
    setSelected(todayISO)
    setCursor(Temporal.PlainDate.from(todayISO).with({ day: 1 }))
  }

  function compactItem(item: CalItem, index: number) {
    const visual = itemVisual(item)
    const resolved = item.kind === 'task' ? (item.completed || item.skipped) : item.completed
    const hiddenAt = index === 1 ? 'calendar-summary-second' : index === 2 ? 'calendar-summary-third' : ''
    return (
      <span
        key={`${item.kind}:${item.kind === 'event' ? item.event.id : item.task.id}:${item.date}:${index}`}
        data-color-token={visual.color}
        data-resolved={resolved || undefined}
        className={`calendar-summary ${hiddenAt}`}
      >
        <MarkerIcon symbol={visual.marker} color={visual.color} size={11} />
        <span>{itemTitle(item)}</span>
      </span>
    )
  }

  function dayCell(dateISO: string) {
    const inMonth = dateISO.slice(0, 7) === cursor.toString().slice(0, 7)
    const isToday = dateISO === todayISO
    const isSelected = dateISO === selected
    const items = itemsForDate(dateISO)
    const dayWork = (workRecords ?? []).filter((record) => record.date === dateISO && record.worked)
    const totalCount = items.length + dayWork.length
    const firstVisual = items[0] ? itemVisual(items[0]) : undefined
    return (
      <button
        key={dateISO}
        role="gridcell"
        aria-label={`${dateISO}${totalCount ? `：${items.map(itemTitle).join('、')}${dayWork.length ? `、工作 ${dayWork.reduce((sum, record) => sum + record.durationMinutes, 0) / 60} 小时` : ''}` : '：无安排'}`}
        aria-selected={isSelected}
        tabIndex={isSelected ? 0 : -1}
        onClick={() => selectDay(dateISO)}
        className="calendar-day"
        data-has-items={totalCount > 0 || undefined}
        data-color-token={firstVisual?.color}
        data-outside={!inMonth || undefined}
        data-selected={isSelected || undefined}
      >
        <span className="calendar-date-row">
          <span
            className="calendar-date-number"
            data-today={isToday || undefined}
            data-has-items={totalCount > 0 || undefined}
          >
            {isSelected && (
              <motion.span
                layoutId="calendar-selected-date"
                className="calendar-selected-date-pill"
                transition={reduceMotion ? MOTION.reduced : MOTION.control}
                aria-hidden
              />
            )}
            <span className="calendar-date-label">{Number(dateISO.slice(8))}</span>
          </span>
          {totalCount > 0 && <span className="calendar-date-count">{totalCount}</span>}
        </span>
        <span className="calendar-summaries" aria-hidden>
          {items.slice(0, 3).map(compactItem)}
          {items.length < 3 && dayWork.slice(0, 1).map((record) => (
            <span key={record.id} className="calendar-summary calendar-work-summary">
              <AppIcon name="work" size={11} />
              <span>工作 {record.durationMinutes / 60}h</span>
            </span>
          ))}
          {totalCount > 3 && <span className="calendar-more">+{totalCount - 3}</span>}
        </span>
      </button>
    )
  }

  function itemRow(item: CalItem, index = 0) {
    const visual = itemVisual(item)
    const source = item.kind === 'event' ? item.event : item.task
    const sourceCategory = source.categoryId ? catMap.get(source.categoryId) : undefined
    const featureTone = source.visualToken || sourceCategory?.colorToken
      ? 'custom'
      : (['lime', 'purple', 'charcoal'] as const)[index % 3]
    const resolved = item.kind === 'task' ? (item.completed || item.skipped) : item.completed
    const categoryId = item.kind === 'event' ? item.event.categoryId : item.task.categoryId
    const category = categoryId ? catMap.get(categoryId) : undefined
    const timeLabel = itemTimeLabel(item)
    const subtitle =
      item.kind === 'event'
        ? [timeLabel, item.event.startDate !== item.event.endDate ? `${item.event.startDate.slice(5)} → ${item.event.endDate.slice(5)}` : null]
            .filter(Boolean)
            .join(' · ')
        : [category?.name, item.subtitle, item.skipped ? '已跳过' : null]
            .filter(Boolean)
            .join(' · ')
    return (
      <SwipeActionRow
        key={`${item.kind}:${item.kind === 'event' ? item.event.id : item.task.id}:${item.date}:${item.kind === 'task' ? item.occurrenceKey : ''}`}
        id={`calendar:${item.kind}:${item.kind === 'event' ? item.event.id : item.task.id}:${item.date}`}
        label={itemTitle(item)}
        className="calendar-item-swipe"
        contentClassName="calendar-item-card row-in"
        contentProps={{
          'data-color-token': visual.color,
          'data-feature-tone': featureTone,
          'data-resolved': resolved || undefined,
        } as React.HTMLAttributes<HTMLDivElement>}
        resetKey={`${mode}:${selected}`}
        actions={[
          { label: '更多', icon: 'more', tone: 'neutral', onSelect: () => openItem(item) },
          {
            label: '删除',
            icon: 'trash',
            tone: 'danger',
            onSelect: () => {
              if (item.kind === 'event') void softDeleteEvent(item.event.id)
              else void softDeleteTask(item.task.id)
            },
          },
        ]}
      >
        <button
          aria-label={resolved ? '取消完成' : '完成'}
          onClick={() => toggleItem(item)}
          className="calendar-item-check hit-target"
        >
          <span>{resolved && <AppIcon name="check" size={14} />}</span>
        </button>
        <button onClick={() => openItem(item)} className="calendar-item-main">
          <strong>{itemTitle(item)}</strong>
          {subtitle && <span>{subtitle}</span>}
        </button>
        <button
          onClick={() => openItem(item)}
          className="calendar-item-edit hit-target"
          aria-label={`编辑${item.kind === 'event' ? '计划' : '任务'}：${itemTitle(item)}`}
        >
          <AppIcon name="edit" size={18} />
        </button>
      </SwipeActionRow>
    )
  }

  const selectedItems = itemsForDate(selected)
  const selectedAllDayItems = selectedItems.filter(
    (item) => item.kind === 'event' && item.event.allDay && !itemTime(item),
  )
  const selectedUnscheduledItems = selectedItems.filter(
    (item) => !itemTime(item) && !(item.kind === 'event' && item.event.allDay),
  )
  const selectedTimedItems = selectedItems.filter((item) => Boolean(itemTime(item)))

  function timelineItemRow(item: CalItem, index: number) {
    const visual = itemVisual(item)
    const source = item.kind === 'event' ? item.event : item.task
    const category = source.categoryId ? catMap.get(source.categoryId) : undefined
    const featureTone = source.visualToken || category?.colorToken
      ? 'custom'
      : (['lime', 'purple', 'charcoal'] as const)[index % 3]
    const resolved = item.kind === 'task' ? (item.completed || item.skipped) : item.completed
    const time = itemTime(item)
    const dragDisabled = item.kind === 'task' && Boolean(
      item.task.recurrence || (item.task.parentTaskId && item.task.inheritsParentSchedule !== false),
    )
    const rowKey = `${item.kind}:${item.kind === 'event' ? item.event.id : item.task.id}:${item.date}:${item.kind === 'task' ? item.occurrenceKey : ''}`
    return (
      <TimelineScheduleRow
        key={`timeline:${rowKey}`}
        date={item.date}
        time={time}
        disabled={dragDisabled}
        onCommit={(targetDate, targetTime) => rescheduleItem(item, targetDate, targetTime)}
      >
        <div className="mobile-timeline-row" data-unscheduled={!time || undefined}>
          <time>{item.kind === 'event' && item.event.allDay ? '全天' : time ?? '未排定'}</time>
          <SwipeActionRow
            as="div"
            id={`timeline-swipe:${rowKey}`}
            label={itemTitle(item)}
            className="mobile-timeline-swipe"
            contentClassName="mobile-timeline-event"
            divider={index > 0}
            resetKey={`${selected}:${mode}`}
            contentProps={{
              role: 'button',
              tabIndex: 0,
              onClick: () => openItem(item),
              onKeyDown: (event) => {
                if (event.key === 'Enter' || event.key === ' ') openItem(item)
              },
              'data-color-token': visual.color,
              'data-feature-tone': featureTone,
              'data-resolved': resolved || undefined,
            } as React.HTMLAttributes<HTMLDivElement>}
            actions={[
              { label: '更多', icon: 'more', tone: 'neutral', onSelect: () => openItem(item) },
              {
                label: '删除',
                icon: 'trash',
                tone: 'danger',
                onSelect: () => item.kind === 'event'
                  ? void softDeleteEvent(item.event.id)
                  : void softDeleteTask(item.task.id),
              },
            ]}
          >
            <strong>{itemTitle(item)}</strong>
            <span>{time ? `${itemTimeLabel(item)}${eventEndTime(item) ? '' : ' 开始'}` : item.kind === 'event' ? '全天计划' : '暂不安排具体时间'}</span>
            <MarkerIcon symbol={visual.marker} color={visual.color} size={17} />
          </SwipeActionRow>
        </div>
      </TimelineScheduleRow>
    )
  }
  const futureAgendaGroups = agendaDates
    .map((date) => ({ date, items: itemsForDate(date) }))
    // The focused date is already fully represented by dayPanel. Excluding it
    // keeps “未来 30 天” from repeating the same rows immediately below.
    .filter((group) => group.date !== selected && group.items.length > 0)
  const futureAgendaCount = futureAgendaGroups.reduce((sum, group) => sum + group.items.length, 0)
  const selectedWork = (workRecords ?? []).filter((record) => record.date === selected)
  const monthLabel = `${cursor.year} 年 ${cursor.month} 月`
  const weekLabel = `${dateLabel(weekDates[0], { month: 'short', day: 'numeric' })} – ${dateLabel(weekDates[6], { month: 'short', day: 'numeric' })}`
  const weekLabels = weekStartsOn === 0 ? WEEK_LABELS_SUN : WEEK_LABELS_MON

  const dayPanel = (
    <div ref={dayPanelRef} className="calendar-day-panel scroll-mb-28">
      <motion.div
        key={selected}
        initial={reduceMotion ? false : { x: dayDirection * 6 }}
        animate={{ x: 0 }}
        transition={reduceMotion ? MOTION.reduced : MOTION.calendar}
        className="day-panel-motion"
      >
        <div className="day-panel-heading">
          <div>
            <p>当天安排</p>
            <h2>{dateLabel(selected, { month: 'long', day: 'numeric', weekday: 'long' })}</h2>
          </div>
          <div className="day-panel-heading-actions">
            <span>{selectedItems.length} 项</span>
            <button
              type="button"
              aria-label={composerOpen ? '收起新增' : '在选中日期新增'}
              aria-expanded={composerOpen}
              onClick={() => setComposerOpen((open) => !open)}
            >
              <AppIcon name={composerOpen ? 'chevronUp' : 'plus'} size={20} />
            </button>
          </div>
        </div>

        <section className="calendar-work-panel">
          <header>
            <div><span>工作记录</span><strong>{selectedWork.filter((record) => record.worked).reduce((sum, record) => sum + record.durationMinutes, 0) / 60} 小时</strong></div>
            <button onClick={() => navigate(`/finance?mode=work&date=${selected}&new=1`)}>
              <AppIcon name="plus" size={17} /> 记录工时
            </button>
          </header>
          {selectedWork.length > 0 && (
            <ul>{selectedWork.map((record) => (
              <li key={record.id}>
                <AppIcon name="work" size={17} />
                <span>{record.worked ? `${record.durationMinutes / 60} 小时` : '休息日'}</span>
                <small>{record.workLocation || record.workContent || record.note || '未填写备注'}</small>
              </li>
            ))}</ul>
          )}
        </section>

        {composerOpen && <div className="calendar-composer quick-card">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void submitDraft()
              }
            }}
            rows={3}
            placeholder={
              draftKind === 'event'
                ? '添加计划；多项可换行…'
                : '添加任务；多项可换行…'
            }
          />
          <p className="batch-input-hint">
            <span className="mobile-composer-hint">每行一个计划</span>
            <span className="desktop-composer-hint">Enter 换行 · ⌘/Ctrl + Enter 添加全部</span>
          </p>
          <div className="calendar-composer-controls">
            <select
              aria-label="类型"
              value={draftKind}
              onChange={(event) => setDraftKind(event.target.value as 'event' | 'task')}
            >
              <option value="event">计划</option>
              <option value="task">任务</option>
            </select>
            {draftKind === 'event' ? (
              <input
                type="time"
                aria-label="时间（可选）"
                value={draftTime}
                onChange={(event) => setDraftTime(event.target.value)}
              />
            ) : (
              <select
                aria-label="任务周期"
                value={draftScope}
                onChange={(event) => setDraftScope(event.target.value as TaskScope)}
              >
                <option value="daily">每日任务</option>
                <option value="weekly">每周任务</option>
              </select>
            )}
            <button
              onClick={() => void submitDraft()}
              disabled={!draft.trim() || submitting}
              aria-label="添加"
              className="primary-action"
            >
              <AppIcon name="plus" size={22} />
            </button>
          </div>
        </div>}
        <p role="status" className="calendar-feedback">{feedback}</p>
        {selectedItems.length > 0 ? (
          <ul className="calendar-item-list">{selectedItems.map(itemRow)}</ul>
        ) : composerOpen ? null : (
          <div className="calendar-empty-day">
            <MarkerIcon symbol="flower" color="green" size={42} />
            <span>这一天暂无安排</span>
          </div>
        )}
      </motion.div>
    </div>
  )

  return (
    <section className="app-page page-plan" data-mode={mode}>
      <MobilePageHeader
        title="计划"
        eyebrow={dateLabel(selected, { month: 'long', day: 'numeric' })}
        onPrimary={() => {
          if (mode === 'agenda' && composerOpen) {
            setComposerOpen(false)
            return
          }
          switchMode('agenda')
          setComposerOpen(true)
        }}
        primaryLabel={mode === 'agenda' && composerOpen ? '收起新增区域' : '新增安排'}
        primaryIcon={mode === 'agenda' && composerOpen ? 'chevronUp' : 'plus'}
        showSecondary={false}
      />
      <div className="plan-mobile-mode-switch" data-shared-indicator role="tablist" aria-label="视图模式">
        <SegmentedIndicator
          className="plan-mode-indicator"
          count={3}
          index={MODE_ORDER[mode]}
        />
        {([
          ['month', 'month', '月历'],
          ['week', 'week', '时间'],
          ['agenda', 'list', '日程'],
        ] as const).map(([value, icon, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={mode === value}
            onClick={() => switchMode(value)}
          >
            <AppIcon name={icon} size={18} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <PageHeader
        title="计划"
        eyebrow="日历与安排"
        actions={(
          <div role="tablist" aria-label="视图模式" data-shared-indicator className="segmented-control plan-mode-switch">
            <SegmentedIndicator
              className="plan-mode-indicator"
              count={3}
              index={MODE_ORDER[mode]}
            />
            {([
              ['month', 'month', '月'],
              ['week', 'week', '周'],
              ['agenda', 'list', '日程'],
            ] as const).map(([value, icon, label]) => (
              <button
                key={value}
                role="tab"
                aria-label={label}
                aria-selected={mode === value}
                onClick={() => switchMode(value)}
                className={mode === value ? 'is-active' : ''}
              >
                <AppIcon name={icon} size={17} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        )}
      />

      {mode !== 'agenda' && (
        <motion.div
          key={mode}
          initial={reduceMotion ? false : { x: modeDirection * 8 }}
          animate={{ x: 0 }}
          transition={reduceMotion ? MOTION.reduced : MOTION.route}
          className="plan-mode-stage"
        >
        <div className="plan-workspace">
          <div className="plan-calendar-column">
            <div className="calendar-toolbar">
              <div>
                <span>{mode === 'month' ? '月视图' : '周视图'}</span>
                <h2>{mode === 'month' ? monthLabel : weekLabel}</h2>
              </div>
              <div className="calendar-panel-action">
                <button aria-label={mode === 'month' ? '上个月' : '上一周'} onClick={() => changePeriod(-1)}>
                  <AppIcon name="chevronLeft" size={19} />
                </button>
                <button onClick={returnToday}>今天</button>
                <button aria-label={mode === 'month' ? '下个月' : '下一周'} onClick={() => changePeriod(1)}>
                  <AppIcon name="chevronRight" size={19} />
                </button>
              </div>
            </div>

            {mode === 'month' ? (
              <motion.div
                key={`month:${cursor.toString()}`}
                initial={reduceMotion ? false : { x: periodDirection * 8 }}
                animate={{ x: 0 }}
                transition={reduceMotion ? MOTION.reduced : MOTION.calendar}
                role="grid"
                aria-label={monthLabel}
                onKeyDown={onGridKeyDown}
                className="calendar-card calendar-period-stage"
              >
                <div className="calendar-week-labels">
                  {weekLabels.map((label) => <span key={label}>{label}</span>)}
                </div>
                <div className="calendar-month-grid">{grid.map(dayCell)}</div>
              </motion.div>
            ) : (
              <motion.div
                key={`week:${weekDates[0]}`}
                initial={reduceMotion ? false : { x: periodDirection * 8 }}
                animate={{ x: 0 }}
                transition={reduceMotion ? MOTION.reduced : MOTION.calendar}
                className="calendar-period-stage"
              >
              <div className="mobile-week-timeline" aria-label={`${weekLabel} 时间安排`}>
                <div className="mobile-week-strip">
                  {weekDates.map((date, index) => (
                    <button
                      key={date}
                      type="button"
                      data-selected={date === selected || undefined}
                      data-today={date === todayISO || undefined}
                      onClick={() => selectDay(date)}
                    >
                      <span>{weekLabels[index]}</span>
                      <strong>{Number(date.slice(8))}</strong>
                    </button>
                  ))}
                </div>
                <div className="mobile-timeline-list">
                  <motion.div
                    key={selected}
                    initial={reduceMotion ? false : { x: dayDirection * 6 }}
                    animate={{ x: 0 }}
                    transition={reduceMotion ? MOTION.reduced : MOTION.calendar}
                    className="mobile-timeline-items"
                  >
                  {selectedItems.length > 0 ? (
                    <>
                      {selectedAllDayItems.length > 0 && (
                        <section className="mobile-timeline-all-day" aria-label="全天计划">
                          <header><span>全天计划</span><small>不占用具体时间段</small></header>
                          {selectedAllDayItems.map(timelineItemRow)}
                        </section>
                      )}
                      {selectedUnscheduledItems.length > 0 && (
                        <section className="mobile-timeline-unscheduled" aria-label="未排定时间">
                          <header><span>未排定时间</span><small>{selectedUnscheduledItems.length} 项</small></header>
                          {selectedUnscheduledItems.map(timelineItemRow)}
                        </section>
                      )}
                      {selectedTimedItems.length > 0 && (
                        <section className="mobile-timeline-scheduled" aria-label="已排定时间">
                          {selectedTimedItems.map(timelineItemRow)}
                        </section>
                      )}
                    </>
                  ) : (
                    <div className="mobile-timeline-empty">选择上方日期或添加新安排</div>
                  )}
                  </motion.div>
                </div>
              </div>
              <div ref={weekBoardRef} className="week-board-shell desktop-week-board">
                <div className="desktop-week-time-rail" aria-hidden>
                  <span />
                  <time>未排定</time>
                  {['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00'].map((time) => (
                    <time key={time}>{time}</time>
                  ))}
                </div>
                <div className="week-board" role="grid" aria-label={weekLabel}>
                  {weekDates.map((date, index) => {
                    const items = itemsForDate(date)
                    const unscheduledItems = items.filter((item) => !itemTime(item))
                    const timedItems = items.filter((item) => Boolean(itemTime(item)))
                    return (
                      <section
                        key={date}
                        role="gridcell"
                        className="week-column"
                        data-selected={date === selected || undefined}
                      >
                        <button className="week-day-heading" onClick={() => selectDay(date)}>
                          <span>{weekLabels[index]}</span>
                          <strong data-today={date === todayISO || undefined}>{Number(date.slice(8))}</strong>
                        </button>
                        <div className="week-column-unscheduled" aria-label="未排定时间">
                          {unscheduledItems.slice(0, 2).map((item) => (
                            <button
                              key={`unscheduled:${item.kind}:${item.kind === 'event' ? item.event.id : item.task.id}:${item.date}`}
                              className="week-unscheduled-chip"
                              onClick={() => {
                                selectDay(date)
                                openItem(item)
                              }}
                            >
                              {itemTitle(item)}
                            </button>
                          ))}
                          {unscheduledItems.length > 2 && <span>+{unscheduledItems.length - 2}</span>}
                        </div>
                        <div className="week-column-items">
                          {timedItems.map((item) => {
                            const visual = itemVisual(item)
                            const resolved = item.kind === 'task' ? (item.completed || item.skipped) : item.completed
                            const time = itemTime(item)!
                            const [hour, minute] = time.split(':').map(Number)
                            const top = Math.max(0, (hour - 8) * 80 + (minute / 60) * 80)
                            return (
                              <button
                                key={`${item.kind}:${item.kind === 'event' ? item.event.id : item.task.id}:${item.date}:${item.kind === 'task' ? item.occurrenceKey : ''}`}
                                data-color-token={visual.color}
                                data-resolved={resolved || undefined}
                                className="week-event"
                                style={{ '--week-event-top': `${top}px` } as React.CSSProperties}
                                onClick={() => {
                                  selectDay(date)
                                  openItem(item)
                                }}
                              >
                                <span>{itemTime(item) ?? (item.kind === 'event' ? '全天' : '任务')}</span>
                                <strong>{itemTitle(item)}</strong>
                                <MarkerIcon symbol={visual.marker} color={visual.color} size={18} />
                              </button>
                            )
                          })}
                          {items.length === 0 && <span className="week-column-empty">暂无安排</span>}
                        </div>
                      </section>
                    )
                  })}
                </div>
              </div>
              </motion.div>
            )}
            {mode === 'month' && (
              <section className="calendar-selection-summary" aria-label="选中日期摘要">
                <header>
                  <div>
                    <strong>{dateLabel(selected, { month: 'long', day: 'numeric', weekday: 'long' })}</strong>
                    <span>{selectedItems.length ? `${selectedItems.length} 项安排` : '暂无安排'}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      switchMode('agenda')
                      setComposerOpen(true)
                    }}
                  >
                    <AppIcon name="plus" size={17} /> 添加计划
                  </button>
                </header>
                {selectedItems.length > 0 && (
                  <ul>
                    {selectedItems.slice(0, 3).map((item, index) => (
                      <li key={`month-summary:${item.kind}:${index}`}>
                        <button type="button" onClick={() => openItem(item)}>
                          <span>{itemTitle(item)}</span>
                          <small>{itemTime(item) ?? (item.kind === 'event' ? '全天计划' : '任务')}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        </div>
        </motion.div>
      )}

      {mode === 'agenda' && (
        <motion.div
          key="agenda"
          initial={reduceMotion ? false : { x: modeDirection * 8 }}
          animate={{ x: 0 }}
          transition={reduceMotion ? MOTION.reduced : MOTION.route}
          className="plan-mode-stage"
        >
        <div className="agenda-layout">
          <div className="agenda-day-focus">{dayPanel}</div>
          <div className="agenda-hero">
            <div>
              <span>未来 30 天</span>
              <h2>日程安排</h2>
            </div>
            <div className="agenda-hero-summary">
              <strong>{futureAgendaCount} 项</strong>
              <span>{futureAgendaGroups[0] ? `最近 ${dateLabel(futureAgendaGroups[0].date, { month: 'numeric', day: 'numeric' })}` : '暂无安排'}</span>
              <AppIcon name="chevronRight" size={18} />
            </div>
          </div>
          <div className="agenda-list">
            {byDay && futureAgendaGroups.map(({ date, items }) => (
              <section key={date} className="agenda-day">
                <header>
                  <time dateTime={date}>{dateLabel(date, { month: 'long', day: 'numeric' })}</time>
                  <span>{dateLabel(date, { weekday: 'long' })}{date === todayISO ? ' · 今天' : ''}</span>
                </header>
                <ul className="calendar-item-list">{items.map(itemRow)}</ul>
              </section>
            ))}
            {byDay && futureAgendaGroups.length === 0 && (
              <div className="calendar-empty-agenda">
                <MarkerIcon symbol="star" color="green" size={72} />
                <strong>未来 30 天暂无安排</strong>
                <span>切回月历或周历，为某一天添加计划</span>
              </div>
            )}
          </div>
        </div>
        </motion.div>
      )}

      {editingEvent && (
        <EventEditor event={editingEvent} categories={categories ?? []} onClose={() => setEditingEvent(null)} />
      )}
      {editingTask && (
        <TaskEditor
          item={editingTask}
          categories={categories ?? []}
          onStatusChange={(status) => setTaskStatus(editingTask, status)}
          onClose={() => setEditingTask(null)}
        />
      )}
    </section>
  )
}
