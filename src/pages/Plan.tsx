import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion, useReducedMotion } from 'motion/react'
import { Temporal } from 'temporal-polyfill'
import {
  db,
  type CalendarEvent,
  type ColorToken,
  type MarkerSymbol,
  type Task,
  type TaskScope,
} from '../lib/db'
import { type CalItem, buildCalendarItems, monthGrid } from '../lib/calendar'
import { useCivilDate } from '../lib/useCivilDate'
import { addEvent, softDeleteEvent, toggleEventCompletion, updateEvent } from '../lib/events'
import {
  RecurrenceConflictError,
  addTaskBatch,
  completeFixedOccurrence,
  completeTask,
  resolveAfterCompletion,
  skipFixedOccurrence,
  softDeleteTask,
  updateTask,
  voidRecord,
} from '../lib/tasks'
import { parseTimedBatchEntries } from '../lib/batch'
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
import DateMarkerSheet from '../components/DateMarkerSheet'
import CalendarMarkerTrack from '../components/CalendarMarkerTrack'
import { calendarMarkerSummary } from '../lib/calendarMarkers'
import { effectiveTaskSchedule, taskChildKindOf, taskMapOf, taskNodeRoleOf } from '../lib/taskSchedule'
import TaskGroupHeader from '../components/TaskGroupHeader'
import InlinePlanChildComposer from '../components/InlinePlanChildComposer'
import TaskLeadingControl from '../components/TaskLeadingControl'
import { isRenderableRecord, renderableTitle } from '../lib/displayRecords'

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
  const [dateMarkerOpen, setDateMarkerOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<
    Extract<CalItem, { kind: 'task' }> | null
  >(null)
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [expandedAgendaParents, setExpandedAgendaParents] = useState<Set<string>>(
    () => new Set(),
  )
  const [childComposer, setChildComposer] = useState<{
    parent: Task
    stateKey: string
    date: string
  } | null>(null)
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
  const dateTypeDefinitions = useLiveQuery(
    () => db.dateTypeDefinitions.where('lifecycleStatus').equals('active').sortBy('rank'),
    [],
  ) ?? []
  const dateTypeMarkers = useLiveQuery(
    () => db.dateTypeMarkers.where('lifecycleStatus').equals('active').toArray(),
    [],
  ) ?? []
  const categories = useLiveQuery(
    () => db.categories.where('lifecycleStatus').equals('active').toArray(),
    [],
  )
  const catMap = useMemo(
    () => new Map((categories ?? []).map((category) => [category.id, category])),
    [categories],
  )
  const renderableTasks = useMemo(
    () => (tasks ?? []).filter((task) => isRenderableRecord(
      task,
      'plan-task-map',
      taskNodeRoleOf(task) === 'plan' ? 'parent-task' : 'task',
    )),
    [tasks],
  )
  const taskMap = useMemo(() => taskMapOf(renderableTasks), [renderableTasks])

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
    const items = (byDay?.get(dateISO) ?? []).filter((item) => itemTitle(item).trim().length > 0)
    return items
      .map((item, index) => ({ item, index }))
      .sort((a, b) => {
        const aDone = a.item.kind === 'task' ? a.item.completed || a.item.skipped : a.item.completed
        const bDone = b.item.kind === 'task' ? b.item.completed || b.item.skipped : b.item.completed
        return Number(aDone) - Number(bDone) || a.index - b.index
      })
      .map(({ item }) => item)
  }

  function itemTime(item: CalItem) {
    const value = item.kind === 'event'
      ? item.event.startAt
      : effectiveTaskSchedule(item.task, taskMap).startAt
    if (!value?.includes('T')) return null
    if (item.kind === 'event') {
      return Temporal.Instant.from(value)
        .toZonedDateTimeISO(item.event.timezone ?? Temporal.Now.timeZoneId())
        .toPlainTime()
        .toString({ smallestUnit: 'minute' })
    }
    const direct = value.match(/T(\d{2}:\d{2})/)
    if (direct) return direct[1]
    return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }

  function eventEndTime(item: CalItem) {
    if (item.kind !== 'event' || !item.event.endAt) return undefined
    return Temporal.Instant.from(item.event.endAt)
      .toZonedDateTimeISO(item.event.timezone ?? Temporal.Now.timeZoneId())
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
          timezone: item.event.timezone,
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
          childKind: task.childKind,
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
      const entries = parseTimedBatchEntries(draft)
      const invalid = entries.find((entry) => entry.error)
      if (invalid) throw new Error(`第 ${invalid.line} 行：${invalid.error}`)
      if (draftKind === 'event') {
        for (const entry of entries) {
          await addEvent({ title: entry.title, date: selected, time: (entry.time ?? draftTime) || undefined })
        }
      } else {
        const result = await addTaskBatch({
          value: draft,
          startDate: selected,
          taskScope: draftScope,
          schedule: {
            scheduleType: 'today',
            startAt: draftTime ? `${selected}T${draftTime}` : selected,
          },
        })
        if (result.failures.length > 0) throw new Error(result.failures[0].reason)
      }
      setDraft('')
      setDraftTime('')
      const noun = draftKind === 'event' ? '计划' : '任务'
      setFeedback(entries.length > 1 ? `已添加 ${entries.length} 个${noun}` : `${noun}已添加`)
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
    const markerTypeIds = new Set(dateTypeMarkers
      .filter((marker) => marker.date === dateISO)
      .map((marker) => marker.typeId))
    const markerTypes = dateTypeDefinitions.filter((definition) => markerTypeIds.has(definition.id))
    const totalCount = items.length + markerTypes.length
    const firstVisual = items[0] ? itemVisual(items[0]) : undefined
    const markers = calendarMarkerSummary({
      date: dateISO,
      definitions: dateTypeDefinitions,
      markers: dateTypeMarkers,
      hasCalendarItems: items.length > 0,
    })
    return (
      <button
        key={dateISO}
        role="gridcell"
        aria-label={`${dateISO}${totalCount ? `：${[...markerTypes.map((item) => item.name), ...items.map(itemTitle)].join('、')}` : '：无安排'}`}
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
          {totalCount > 3 && <span className="calendar-more">+{totalCount - 3}</span>}
        </span>
        <CalendarMarkerTrack summary={markers} />
      </button>
    )
  }

  function itemRow(item: CalItem, index = 0, nestedChild = false) {
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
    const timelineStep = item.kind === 'task' && taskChildKindOf(item.task, taskMap) === 'timeline'
    const checklistChild = item.kind === 'task' && taskChildKindOf(item.task, taskMap) === 'checklist'
    const timelineParent = timelineStep && item.task.parentTaskId ? taskMap.get(item.task.parentTaskId) : undefined
    const subtitle =
      nestedChild
        ? ''
        : item.kind === 'event'
        ? [timeLabel, item.event.startDate !== item.event.endDate ? `${item.event.startDate.slice(5)} → ${item.event.endDate.slice(5)}` : null]
            .filter(Boolean)
            .join(' · ')
        : [category?.name, item.subtitle, item.skipped ? '已跳过' : null]
            .filter(Boolean)
            .join(' · ')
    if (nestedChild && checklistChild) {
      return groupedChecklistChildRow(item, index, 'calendar')
    }
    if (timelineStep) {
      return (
        <SwipeActionRow
          key={`timeline-detail:${item.task.id}:${item.date}`}
          id={`timeline-detail:${item.task.id}:${item.date}`}
          label={itemTitle(item)}
          className={`calendar-item-swipe calendar-timeline-step-swipe ${nestedChild ? 'calendar-item-swipe-child' : ''}`}
          contentClassName="calendar-timeline-step-row"
          divider={index > 0}
          resetKey={`${mode}:${selected}`}
          actions={[
            { label: '更多', icon: 'more', tone: 'neutral', onSelect: () => openItem(item) },
            { label: '删除', icon: 'trash', tone: 'danger', onSelect: () => void softDeleteTask(item.task.id) },
          ]}
        >
          <time>{itemTime(item) ?? '—'}</time>
          <button
            type="button"
            className="calendar-timeline-step-check"
            aria-label={resolved ? '取消完成' : '完成'}
            onClick={() => toggleItem(item)}
          >
            <span>{resolved && <AppIcon name="check" size={12} />}</span>
          </button>
          <button type="button" onClick={() => openItem(item)}>
            <strong>{itemTitle(item)}</strong>
            {timelineParent && !nestedChild && <span>{timelineParent.title} · 时间步骤</span>}
          </button>
        </SwipeActionRow>
      )
    }
    return (
      <SwipeActionRow
        key={`${item.kind}:${item.kind === 'event' ? item.event.id : item.task.id}:${item.date}:${item.kind === 'task' ? item.occurrenceKey : ''}`}
        id={`calendar:${item.kind}:${item.kind === 'event' ? item.event.id : item.task.id}:${item.date}`}
        label={itemTitle(item)}
        className={`calendar-item-swipe ${nestedChild ? 'calendar-item-swipe-child' : ''}`}
        contentClassName={`calendar-item-card row-in ${nestedChild ? 'calendar-item-card-child' : ''}`}
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
        <TaskLeadingControl
          className="calendar-item-check hit-target"
          label={resolved ? '取消完成' : '完成'}
          completed={resolved}
          onToggle={() => toggleItem(item)}
          size={nestedChild ? 'child' : 'main'}
        />
        <button onClick={() => openItem(item)} className="calendar-item-main">
          <strong>{itemTitle(item)}</strong>
          {subtitle && <span>{subtitle}</span>}
        </button>
      </SwipeActionRow>
    )
  }

  function groupedChecklistChildRow(
    item: Extract<CalItem, { kind: 'task' }>,
    index: number,
    context: string,
  ) {
    const resolved = item.completed || item.skipped
    const time = itemTime(item)
    const rowKey = `${context}:${item.task.id}:${item.date}:${item.occurrenceKey}`
    return (
      <SwipeActionRow
        key={`group-checklist:${rowKey}`}
        id={`group-checklist:${rowKey}`}
        label={itemTitle(item)}
        className="plan-group-checklist-swipe"
        contentClassName="plan-group-checklist-row"
        divider={index > 0}
        resetKey={`${selected}:${mode}`}
        contentProps={{
          'data-resolved': resolved || undefined,
        } as React.HTMLAttributes<HTMLDivElement>}
        actions={[
          { label: '更多', icon: 'more', tone: 'neutral', onSelect: () => openItem(item) },
          { label: '删除', icon: 'trash', tone: 'danger', onSelect: () => void softDeleteTask(item.task.id) },
        ]}
      >
        <TaskLeadingControl
          className="plan-group-checklist-check"
          label={resolved ? '取消完成' : '完成'}
          completed={resolved}
          onToggle={() => toggleItem(item)}
          size="child"
          checkSize={11}
        />
        <button type="button" className="plan-group-checklist-main" onClick={() => openItem(item)}>
          <strong>{itemTitle(item)}</strong>
        </button>
        {time && <time>{time}</time>}
      </SwipeActionRow>
    )
  }

  function agendaRows(items: CalItem[], date: string) {
    const children = new Map<string, CalItem[]>()
    const parentItems = new Map<string, CalItem>()

    for (const item of items) {
      if (item.kind !== 'task') continue
      parentItems.set(item.task.id, item)
      const parentId = item.task.parentTaskId
      if (!parentId || !taskMap.has(parentId)) continue
      const siblings = children.get(parentId) ?? []
      siblings.push(item)
      children.set(parentId, siblings)
    }

    const emittedParents = new Set<string>()
    const rows: ReactNode[] = []
    items.forEach((item, index) => {
      if (item.kind === 'task' && item.task.parentTaskId && children.has(item.task.parentTaskId)) {
        const parentId = item.task.parentTaskId
        if (!emittedParents.has(parentId)) {
          rows.push(agendaParentRow(parentId, children.get(parentId) ?? [], date))
          emittedParents.add(parentId)
        }
        return
      }
      if (item.kind === 'task' && children.has(item.task.id)) {
        if (!emittedParents.has(item.task.id)) {
          rows.push(agendaParentRow(item.task.id, children.get(item.task.id) ?? [], date))
          emittedParents.add(item.task.id)
        }
        return
      }
      rows.push(itemRow(item, index))
    })

    return rows

    function agendaParentRow(parentId: string, childItems: CalItem[], rowDate: string) {
      const parent = taskMap.get(parentId)
      const parentItem = parentItems.get(parentId)
      const title = parentItem
        ? itemTitle(parentItem)
        : parent
          ? renderableTitle(parent, '父任务')
          : '父任务'
      const completed = childItems.filter((child) =>
        child.kind === 'task'
          ? child.completed || child.skipped
          : child.completed,
      ).length
      const stateKey = `${rowDate}:${parentId}`
      const expanded = expandedAgendaParents.has(stateKey)
      const complete = childItems.length > 0 && completed === childItems.length
      const addingHere = childComposer?.stateKey === stateKey

      return (
        <li
          key={`agenda-parent:${stateKey}`}
          className="calendar-parent-group agenda-parent-list-row"
          data-item-kind="parent-task"
        >
          <TaskGroupHeader
            title={title}
            completed={complete}
            progress={{ completed, total: childItems.length }}
            expanded={expanded}
            onToggleComplete={() => { void toggleCalendarGroup(childItems) }}
            onToggleExpanded={() => toggleAgendaParent(stateKey)}
            onAddChild={parent ? () => openPlanChildComposer(parent, stateKey, rowDate) : undefined}
            meta={parent && taskNodeRoleOf(parent) === 'plan' ? '计划' : '父任务'}
          >
            {(addingHere || expanded) && (
              <>
                {addingHere && parent && (
                  <InlinePlanChildComposer
                    parent={parent}
                    tasks={tasks ?? []}
                    date={rowDate}
                    scheduleType="today"
                    onCancel={() => setChildComposer(null)}
                    onSaved={(created) => {
                      setChildComposer(null)
                      setFeedback(`已向“${parent.title}”添加 ${created} 项`)
                    }}
                  />
                )}
                {expanded && (
                  <ul className="calendar-parent-children">
                    {childItems.map((child, childIndex) => itemRow(child, childIndex, true))}
                  </ul>
                )}
              </>
            )}
          </TaskGroupHeader>
        </li>
      )
    }
  }

  function toggleAgendaParent(stateKey: string) {
    setExpandedAgendaParents((current) => {
      const next = new Set(current)
      if (next.has(stateKey)) next.delete(stateKey)
      else next.add(stateKey)
      return next
    })
  }

  function openPlanChildComposer(parent: Task, stateKey: string, date: string) {
    setExpandedAgendaParents((current) => new Set(current).add(stateKey))
    setChildComposer({
      parent,
      stateKey,
      date,
    })
  }

  async function toggleCalendarGroup(childItems: CalItem[]) {
    const taskItems = childItems.filter(
      (item): item is Extract<CalItem, { kind: 'task' }> => item.kind === 'task',
    )
    if (taskItems.length === 0) return
    const shouldComplete = taskItems.some((item) => !(item.completed || item.skipped))
    for (const item of taskItems) {
      const resolved = item.completed || item.skipped
      if (resolved === shouldComplete) continue
      await setTaskStatus(item, shouldComplete ? 'completed' : 'pending')
    }
  }

  const selectedItems = itemsForDate(selected)
  const selectedDateTypeIds = new Set(dateTypeMarkers
    .filter((marker) => marker.date === selected)
    .map((marker) => marker.typeId))
  const selectedDateTypes = dateTypeDefinitions.filter((definition) => selectedDateTypeIds.has(definition.id))
  const selectedAllDayItems = selectedItems.filter(
    (item) => item.kind === 'event' && item.event.allDay && !itemTime(item),
  )
  const selectedUnscheduledItems = selectedItems.filter(
    (item) => !itemTime(item) && !(item.kind === 'event' && item.event.allDay),
  )
  const selectedTimedItems = selectedItems.filter((item) => Boolean(itemTime(item)))
  const selectedTimelineSteps = selectedTimedItems.filter(
    (item) => item.kind === 'task' && taskChildKindOf(item.task, taskMap) === 'timeline',
  )
  const selectedOrdinaryTimedItems = selectedTimedItems.filter(
    (item) => !(item.kind === 'task' && taskChildKindOf(item.task, taskMap) === 'timeline'),
  )
  const selectedTimelineGroups = [...selectedTimelineSteps.reduce((groups, item) => {
    if (item.kind !== 'task') return groups
    const parentId = item.task.parentTaskId ?? '#independent'
    const rows = groups.get(parentId) ?? []
    rows.push(item)
    groups.set(parentId, rows)
    return groups
  }, new Map<string, CalItem[]>())]

  function timelineItemRow(item: CalItem, index: number, groupedStep = false) {
    const visual = itemVisual(item)
    const source = item.kind === 'event' ? item.event : item.task
    const category = source.categoryId ? catMap.get(source.categoryId) : undefined
    const featureTone = source.visualToken || category?.colorToken
      ? 'custom'
      : (['lime', 'purple', 'charcoal'] as const)[index % 3]
    const resolved = item.kind === 'task' ? (item.completed || item.skipped) : item.completed
    const time = itemTime(item)
    const checklistChild = item.kind === 'task' &&
      taskChildKindOf(item.task, taskMap) === 'checklist'
    const parent = item.kind === 'task' && item.task.parentTaskId
      ? taskMap.get(item.task.parentTaskId)
      : undefined
    const planTitle = parent && taskNodeRoleOf(parent) === 'plan' ? parent.title : undefined
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
        <div
          className="mobile-timeline-row"
          data-unscheduled={!time || undefined}
          data-checklist-child={checklistChild || undefined}
        >
          <time aria-label={item.kind === 'event' && item.event.allDay ? '全天' : time ? `开始时间 ${time}` : '未排定时间'}>
            {item.kind === 'event' && item.event.allDay ? '全天' : time ?? ''}
          </time>
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
              'data-has-check': item.kind === 'task' ? 'true' : undefined,
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
            {item.kind === 'task' && (
              <TaskLeadingControl
                className="mobile-timeline-check"
                label={resolved ? '取消完成' : '完成'}
                completed={resolved}
                onToggle={() => toggleItem(item)}
                size={checklistChild ? 'child' : 'main'}
                checkSize={12}
              />
            )}
            <strong>{itemTitle(item)}</strong>
            {planTitle && !groupedStep && <small className="timeline-plan-label">{planTitle}</small>}
            <MarkerIcon symbol={visual.marker} color={visual.color} size={17} />
          </SwipeActionRow>
        </div>
      </TimelineScheduleRow>
    )
  }

  function timelineParentGroup(
    parentId: string,
    childItems: CalItem[],
    context: string,
  ) {
    if (parentId === '#independent') {
      return childItems
        .sort((a, b) => (itemTime(a) ?? '').localeCompare(itemTime(b) ?? ''))
        .map((item, index) => timelineItemRow(item, index))
    }
    const parent = taskMap.get(parentId)
    const title = parent ? renderableTitle(parent, '父任务') : '父任务'
    const completed = childItems.filter((child) =>
      child.kind === 'task' ? child.completed || child.skipped : child.completed,
    ).length
    const groupDate = childItems[0]?.date ?? selected
    const stateKey = `${groupDate}:${context}:${parentId}`
    const expanded = expandedAgendaParents.has(stateKey)
    const addingHere = childComposer?.stateKey === stateKey
    return (
      <section
        key={`timeline-group:${stateKey}`}
        className="mobile-timeline-plan-group calendar-parent-group"
        aria-label={`${title} 子项`}
      >
        <TaskGroupHeader
          title={title}
          completed={childItems.length > 0 && completed === childItems.length}
          progress={{ completed, total: childItems.length }}
          expanded={expanded}
          onToggleComplete={() => { void toggleCalendarGroup(childItems) }}
          onToggleExpanded={() => toggleAgendaParent(stateKey)}
          onAddChild={parent ? () => openPlanChildComposer(parent, stateKey, groupDate) : undefined}
          meta={parent && taskNodeRoleOf(parent) === 'plan' ? '计划' : '父任务'}
        >
          {(addingHere || expanded) && (
            <>
              {addingHere && parent && (
                <InlinePlanChildComposer
                  parent={parent}
                  tasks={tasks ?? []}
                  date={groupDate}
                  scheduleType="today"
                  onCancel={() => setChildComposer(null)}
                  onSaved={(created) => {
                    setChildComposer(null)
                    setFeedback(`已向“${parent.title}”添加 ${created} 项`)
                  }}
                />
              )}
              {expanded && (
                <div className="mobile-timeline-plan-steps">
                  {childItems
                    .sort((a, b) => (itemTime(a) ?? '').localeCompare(itemTime(b) ?? ''))
                    .map((item, index) => (
                      item.kind === 'task' && taskChildKindOf(item.task, taskMap) === 'checklist'
                        ? groupedChecklistChildRow(item, index, `${context}:checklist`)
                        : itemRow(item, index, true)
                    ))}
                </div>
              )}
            </>
          )}
        </TaskGroupHeader>
      </section>
    )
  }

  function timelineHierarchyRows(items: CalItem[], context: string) {
    const children = new Map<string, CalItem[]>()
    for (const item of items) {
      if (item.kind !== 'task' || !item.task.parentTaskId || !taskMap.has(item.task.parentTaskId)) continue
      const rows = children.get(item.task.parentTaskId) ?? []
      rows.push(item)
      children.set(item.task.parentTaskId, rows)
    }
    const emitted = new Set<string>()
    const rows: ReactNode[] = []
    items.forEach((item, index) => {
      if (item.kind === 'task' && item.task.parentTaskId && children.has(item.task.parentTaskId)) {
        const parentId = item.task.parentTaskId
        if (!emitted.has(parentId)) {
          rows.push(timelineParentGroup(parentId, children.get(parentId) ?? [], context))
          emitted.add(parentId)
        }
        return
      }
      if (item.kind === 'task' && children.has(item.task.id)) {
        if (!emitted.has(item.task.id)) {
          rows.push(timelineParentGroup(item.task.id, children.get(item.task.id) ?? [], context))
          emitted.add(item.task.id)
        }
        return
      }
      rows.push(timelineItemRow(item, index))
    })
    return rows
  }
  const futureAgendaGroups = agendaDates
    .map((date) => ({ date, items: itemsForDate(date) }))
    // The focused date is already fully represented by dayPanel. Excluding it
    // keeps “未来 30 天” from repeating the same rows immediately below.
    .filter((group) => group.date !== selected && group.items.length > 0)
  const futureAgendaCount = futureAgendaGroups.reduce((sum, group) => sum + group.items.length, 0)
  const selectedSummaryCount = selectedItems.length + selectedDateTypes.length
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
            <h2>{dateLabel(selected, { month: 'long', day: 'numeric', weekday: 'long' })}</h2>
          </div>
          <div className="day-panel-heading-actions">
            <span>{selectedSummaryCount} 项</span>
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

        {selectedDateTypes.length > 0 && (
          <ul
            className="calendar-date-type-list calendar-date-status-list"
            aria-label="全天状态标记"
            data-item-kind="date-status"
          >
            {selectedDateTypes.map((definition) => (
              <li key={definition.id} data-color-token={definition.colorToken}>
                <i aria-hidden />
                <strong>{definition.name}</strong>
              </li>
            ))}
          </ul>
        )}

        {composerOpen && <div className="calendar-composer quick-card">
          <textarea
            className="multiline-input-surface"
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
          <div className="calendar-selected-items">
            {selectedItems.some((item) => !(
              item.kind === 'task' && taskChildKindOf(item.task, taskMap) === 'timeline'
            )) && (
              <ul className="calendar-item-list agenda-structured-list">
                {agendaRows(
                  selectedItems.filter((item) => !(
                    item.kind === 'task' && taskChildKindOf(item.task, taskMap) === 'timeline'
                  )),
                  selected,
                )}
              </ul>
            )}
            {selectedTimelineGroups.map(([parentId, steps]) =>
              timelineParentGroup(parentId, steps, 'agenda-timeline'))}
          </div>
        ) : selectedDateTypes.length > 0 || composerOpen ? null : (
          <div className="calendar-empty-day">
            <MarkerIcon symbol="flower" color="green" size={42} />
            <strong>这一天暂无安排</strong>
            <span>添加计划，或在上方选择其他日期</span>
            <button type="button" onClick={() => setComposerOpen(true)}>
              <AppIcon name="plus" size={16} /> 添加计划
            </button>
          </div>
        )}
      </motion.div>
    </div>
  )

  return (
    <section className="app-page page-plan" data-mode={mode}>
      <div className="page-top-chrome page-top-chrome-plan">
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
              <div className="calendar-toolbar-heading">
                <h2>{mode === 'month' ? monthLabel : weekLabel}</h2>
              </div>
              <nav className="calendar-panel-action calendar-period-navigation" aria-label={mode === 'month' ? '月份导航' : '周导航'}>
                <button aria-label={mode === 'month' ? '上个月' : '上一周'} onClick={() => changePeriod(-1)}>
                  <AppIcon name="chevronLeft" size={19} />
                </button>
                <button onClick={returnToday}>今天</button>
                <button aria-label={mode === 'month' ? '下个月' : '下一周'} onClick={() => changePeriod(1)}>
                  <AppIcon name="chevronRight" size={19} />
                </button>
              </nav>
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
                <div className="calendar-card-toolbar">
                  <strong>日期标记</strong>
                  <button type="button" className="calendar-marker-button" onClick={() => setDateMarkerOpen(true)}>
                    批量标记
                  </button>
                </div>
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
                          {selectedAllDayItems.map((item, index) => timelineItemRow(item, index))}
                        </section>
                      )}
                      {selectedUnscheduledItems.length > 0 && (
                        <section className="mobile-timeline-unscheduled" aria-label="未排定时间">
                          <header><span>未排定时间</span><small>{selectedUnscheduledItems.length} 项</small></header>
                          {timelineHierarchyRows(selectedUnscheduledItems, 'week-unscheduled')}
                        </section>
                      )}
                      {selectedOrdinaryTimedItems.length > 0 && (
                        <section className="mobile-timeline-scheduled" aria-label="已排定时间">
                          {timelineHierarchyRows(selectedOrdinaryTimedItems, 'week-scheduled')}
                        </section>
                      )}
                      {selectedTimelineGroups.map(([parentId, steps]) =>
                        timelineParentGroup(parentId, steps, 'week-timeline'))}
                    </>
                  ) : (
                    <div className="mobile-timeline-empty">
                      <MarkerIcon symbol="star" color="gray" size={36} />
                      <strong>当天尚未排期</strong>
                      <span>选择其他日期，或添加一项安排</span>
                      <button type="button" onClick={() => {
                        switchMode('agenda')
                        setComposerOpen(true)
                      }}>
                        <AppIcon name="plus" size={16} /> 添加安排
                      </button>
                    </div>
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
                    <span>{selectedSummaryCount ? `${selectedSummaryCount} 项安排` : '暂无安排'}</span>
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
                {selectedSummaryCount > 0 && (
                  <ul className="calendar-item-list agenda-structured-list">
                    {selectedDateTypes.map((definition) => (
                      <li key={`month-marker:${definition.id}`} data-color-token={definition.colorToken}>
                        <div className="calendar-month-marker-summary">
                          <i aria-hidden />
                          <span>{definition.name}</span>
                          <small>日期标记</small>
                        </div>
                      </li>
                    ))}
                    {agendaRows(selectedItems, selected)}
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
                <ul className="calendar-item-list agenda-structured-list">
                  {agendaRows(items, date)}
                </ul>
              </section>
            ))}
            {byDay && futureAgendaGroups.length === 0 && (
              <div className="calendar-empty-agenda">
                <MarkerIcon symbol="star" color="green" size={48} />
                <strong>未来 30 天暂无安排</strong>
                <span>为某一天添加计划后，会按日期显示在这里</span>
                <button type="button" onClick={() => setComposerOpen(true)}>
                  <AppIcon name="plus" size={16} /> 添加计划
                </button>
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
      {dateMarkerOpen && (
        <DateMarkerSheet
          month={cursor}
          definitions={dateTypeDefinitions}
          markers={dateTypeMarkers.filter((marker) => marker.date.startsWith(cursor.toString().slice(0, 7)))}
          onFeedback={(message) => {
            setFeedback(message)
            window.setTimeout(() => setFeedback(''), 2200)
          }}
          onClose={() => setDateMarkerOpen(false)}
        />
      )}
    </section>
  )
}
