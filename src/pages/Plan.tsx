import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Temporal } from 'temporal-polyfill'
import {
  db,
  type CalendarEvent,
  type ColorToken,
  type MarkerSymbol,
  type TaskScope,
} from '../lib/db'
import { type CalItem, buildCalendarItems, monthGrid } from '../lib/calendar'
import { todayLocalISO } from '../lib/dates'
import { addEvent, softDeleteEvent } from '../lib/events'
import {
  RecurrenceConflictError,
  addTasks,
  completeFixedOccurrence,
  completeTask,
  resolveAfterCompletion,
  skipFixedOccurrence,
  voidRecord,
} from '../lib/tasks'
import { parseBatchLines } from '../lib/batch'
import EventEditor from '../components/EventEditor'
import TaskEditor, { type EditableTaskStatus } from '../components/TaskEditor'
import PageHeader from '../components/PageHeader'
import AppIcon from '../components/AppIcon'
import MarkerIcon from '../components/MarkerIcon'

const WEEK_LABELS_MON = ['一', '二', '三', '四', '五', '六', '日']
const WEEK_LABELS_SUN = ['日', '一', '二', '三', '四', '五', '六']
type PlanMode = 'month' | 'week' | 'agenda'

function weekStart(dateISO: string, weekStartsOn: 1 | 0) {
  const date = Temporal.PlainDate.from(dateISO)
  const lead = weekStartsOn === 1 ? date.dayOfWeek - 1 : date.dayOfWeek % 7
  return date.subtract({ days: lead })
}

function dateLabel(dateISO: string, options?: Intl.DateTimeFormatOptions) {
  return new Date(`${dateISO}T00:00:00`).toLocaleDateString('zh-CN', options)
}

export default function Plan() {
  const todayISO = todayLocalISO()
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
  const submittingRef = useRef(false)
  const dayPanelRef = useRef<HTMLDivElement>(null)
  const weekBoardRef = useRef<HTMLDivElement>(null)

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
        ? buildCalendarItems(tasks, records, events, rangeStart, rangeEnd)
        : undefined,
    [tasks, records, events, rangeStart, rangeEnd],
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
    setMode(next)
    localStorage.setItem('planMode', next)
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

  function itemTime(item: CalItem) {
    if (item.kind !== 'event' || !item.event.startAt) return null
    return new Date(item.event.startAt).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function openItem(item: CalItem) {
    if (item.kind === 'event') setEditingEvent(item.event)
    else setEditingTask(item)
  }

  function toggleItem(item: CalItem) {
    if (item.kind === 'task') {
      void setTaskStatus(item, item.completed ? 'pending' : 'completed')
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
    setSelected(dateISO)
    const next = Temporal.PlainDate.from(dateISO)
    if (next.year !== cursor.year || next.month !== cursor.month) {
      setCursor(next.with({ day: 1 }))
    }
    window.requestAnimationFrame(() => {
      if (window.innerWidth >= 1180) return
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
    if (mode === 'month') setCursor(cursor.add({ months: delta }))
    else {
      const next = Temporal.PlainDate.from(selected).add({ days: delta * 7 })
      setSelected(next.toString())
      setCursor(next.with({ day: 1 }))
    }
  }

  function returnToday() {
    setSelected(todayISO)
    setCursor(Temporal.PlainDate.from(todayISO).with({ day: 1 }))
  }

  function compactItem(item: CalItem, index: number) {
    const visual = itemVisual(item)
    const resolved = item.kind === 'task' && (item.completed || item.skipped)
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
    const items = byDay?.get(dateISO) ?? []
    return (
      <button
        key={dateISO}
        role="gridcell"
        aria-label={`${dateISO}${items.length ? `：${items.map(itemTitle).join('、')}` : '：无安排'}`}
        aria-selected={isSelected}
        tabIndex={isSelected ? 0 : -1}
        onClick={() => selectDay(dateISO)}
        className="calendar-day"
        data-outside={!inMonth || undefined}
        data-selected={isSelected || undefined}
      >
        <span className="calendar-date-row">
          <span className="calendar-date-number" data-today={isToday || undefined}>
            {Number(dateISO.slice(8))}
          </span>
          {items.length > 0 && <span className="calendar-date-count">{items.length}</span>}
        </span>
        <span className="calendar-summaries" aria-hidden>
          {items.slice(0, 3).map(compactItem)}
          {items.length > 3 && <span className="calendar-more">+{items.length - 3}</span>}
        </span>
      </button>
    )
  }

  function itemRow(item: CalItem) {
    const visual = itemVisual(item)
    const resolved = item.kind === 'task' && (item.completed || item.skipped)
    const categoryId = item.kind === 'event' ? item.event.categoryId : item.task.categoryId
    const category = categoryId ? catMap.get(categoryId) : undefined
    const time = itemTime(item)
    const subtitle =
      item.kind === 'event'
        ? [time ?? '全天', item.event.startDate !== item.event.endDate ? `${item.event.startDate.slice(5)} → ${item.event.endDate.slice(5)}` : null]
            .filter(Boolean)
            .join(' · ')
        : [category?.name, item.subtitle, item.skipped ? '已跳过' : null]
            .filter(Boolean)
            .join(' · ')
    return (
      <li
        key={`${item.kind}:${item.kind === 'event' ? item.event.id : item.task.id}:${item.date}:${item.kind === 'task' ? item.occurrenceKey : ''}`}
        data-color-token={visual.color}
        data-resolved={resolved || undefined}
        className="calendar-item-card row-in"
      >
        {item.kind === 'task' ? (
          <button
            aria-label={item.completed ? '取消完成' : '完成'}
            onClick={() => toggleItem(item)}
            className="calendar-item-check hit-target"
          >
            <span>{item.completed && <AppIcon name="check" size={14} />}</span>
          </button>
        ) : (
          <span className="calendar-item-marker" aria-hidden>
            <MarkerIcon symbol={visual.marker} color={visual.color} size={30} />
          </span>
        )}
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
        {item.kind === 'event' && (
          <button
            aria-label="删除计划"
            onClick={() => void softDeleteEvent(item.event.id)}
            className="calendar-item-delete hit-target"
          >
            <AppIcon name="close" size={18} />
          </button>
        )}
      </li>
    )
  }

  const selectedItems = byDay?.get(selected) ?? []
  const monthLabel = `${cursor.year} 年 ${cursor.month} 月`
  const weekLabel = `${dateLabel(weekDates[0], { month: 'short', day: 'numeric' })} – ${dateLabel(weekDates[6], { month: 'short', day: 'numeric' })}`
  const weekLabels = weekStartsOn === 0 ? WEEK_LABELS_SUN : WEEK_LABELS_MON

  const dayPanel = (
    <div ref={dayPanelRef} className="calendar-day-panel scroll-mb-28">
      <div key={selected} className="day-panel-in">
        <div className="day-panel-heading">
          <div>
            <p>当天安排</p>
            <h2>{dateLabel(selected, { month: 'long', day: 'numeric', weekday: 'long' })}</h2>
          </div>
          <span>{selectedItems.length} 项</span>
        </div>

        <div className="calendar-composer quick-card">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submitDraft()
              }
            }}
            rows={1}
            enterKeyHint="done"
            placeholder={
              draftKind === 'event'
                ? '添加计划；多项可换行…'
                : '添加任务；多项可换行…'
            }
          />
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
        </div>
        <p role="status" className="calendar-feedback">{feedback}</p>
        {selectedItems.length > 0 ? (
          <ul className="calendar-item-list">{selectedItems.map(itemRow)}</ul>
        ) : (
          <div className="calendar-empty-day">
            <MarkerIcon symbol="flower" color="green" size={42} />
            <span>这一天暂无安排</span>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <section className="app-page page-plan">
      <PageHeader
        title="计划"
        eyebrow="日历与安排"
        actions={(
          <div role="tablist" aria-label="视图模式" className="segmented-control plan-mode-switch">
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
              <div role="grid" aria-label={monthLabel} onKeyDown={onGridKeyDown} className="calendar-card">
                <div className="calendar-week-labels">
                  {weekLabels.map((label) => <span key={label}>{label}</span>)}
                </div>
                <div className="calendar-month-grid">{grid.map(dayCell)}</div>
              </div>
            ) : (
              <div ref={weekBoardRef} className="week-board-shell">
                <div className="week-board" role="grid" aria-label={weekLabel}>
                  {weekDates.map((date, index) => {
                    const items = byDay?.get(date) ?? []
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
                        <div className="week-column-items">
                          {items.map((item) => {
                            const visual = itemVisual(item)
                            const resolved = item.kind === 'task' && (item.completed || item.skipped)
                            return (
                              <button
                                key={`${item.kind}:${item.kind === 'event' ? item.event.id : item.task.id}:${item.date}:${item.kind === 'task' ? item.occurrenceKey : ''}`}
                                data-color-token={visual.color}
                                data-resolved={resolved || undefined}
                                className="week-event"
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
            )}
          </div>
          {dayPanel}
        </div>
      )}

      {mode === 'agenda' && (
        <div className="agenda-layout">
          <div className="agenda-hero">
            <MarkerIcon symbol="flower" color="purple" size={62} />
            <div>
              <span>未来 30 天</span>
              <h2>日程安排</h2>
            </div>
          </div>
          <div className="agenda-list">
            {byDay && agendaDates.filter((date) => (byDay.get(date)?.length ?? 0) > 0).map((date) => (
              <section key={date} className="agenda-day">
                <header>
                  <time dateTime={date}>{dateLabel(date, { month: 'long', day: 'numeric' })}</time>
                  <span>{dateLabel(date, { weekday: 'long' })}{date === todayISO ? ' · 今天' : ''}</span>
                </header>
                <ul className="calendar-item-list">{byDay.get(date)!.map(itemRow)}</ul>
              </section>
            ))}
            {byDay && agendaDates.every((date) => (byDay.get(date)?.length ?? 0) === 0) && (
              <div className="calendar-empty-agenda">
                <MarkerIcon symbol="star" color="green" size={72} />
                <strong>未来 30 天暂无安排</strong>
                <span>切回月历或周历，为某一天添加计划</span>
              </div>
            )}
          </div>
        </div>
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
