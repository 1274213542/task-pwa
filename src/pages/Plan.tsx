import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Temporal } from 'temporal-polyfill'
import { db, type CalendarEvent, type TaskScope } from '../lib/db'
import { type CalItem, buildCalendarItems, monthGrid } from '../lib/calendar'
import { todayLocalISO } from '../lib/dates'
import { COLOR_TOKENS } from '../lib/categories'
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

const WEEK_LABELS_MON = ['一', '二', '三', '四', '五', '六', '日']
const WEEK_LABELS_SUN = ['日', '一', '二', '三', '四', '五', '六']

export default function Plan() {
  const todayISO = todayLocalISO()
  const [mode, setMode] = useState<'month' | 'list'>(
    () => (localStorage.getItem('planMode') as 'month' | 'list') ?? 'month',
  )
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
  const catMap = new Map((categories ?? []).map((c) => [c.id, c]))

  const grid = useMemo(
    () => monthGrid(cursor.year, cursor.month, weekStartsOn),
    [cursor, weekStartsOn],
  )
  const listRangeEnd = useMemo(
    () => Temporal.PlainDate.from(todayISO).add({ days: 29 }).toString(),
    [todayISO],
  )
  const [rangeStart, rangeEnd] =
    mode === 'month' ? [grid[0], grid[41]] : [todayISO, listRangeEnd]

  const byDay = useMemo(
    () =>
      tasks && records && events
        ? buildCalendarItems(tasks, records, events, rangeStart, rangeEnd)
        : undefined,
    [tasks, records, events, rangeStart, rangeEnd],
  )

  function switchMode(m: 'month' | 'list') {
    setMode(m)
    localStorage.setItem('planMode', m)
  }

  async function guarded(fn: () => Promise<void>) {
    try {
      await fn()
    } catch (e) {
      if (e instanceof RecurrenceConflictError) alert(e.message)
      else throw e
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
      // 编辑器先保存字段再更新状态；重新读取可确保完成快照和普通任务日期使用新值。
      const latestTask = (await db.tasks.get(task.id)) ?? task
      if (status === 'pending') {
        if (!occurrenceKey.startsWith('ac:')) {
          await voidRecord(`${task.id}:${occurrenceKey}`)
        }
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
      if (occurrenceKey.startsWith('fixed:')) {
        await skipFixedOccurrence(latestTask, date)
      } else if (occurrenceKey.startsWith('ac:')) {
        await resolveAfterCompletion(latestTask, 'skipped')
      }
    })
  }

  function toggleItem(item: CalItem) {
    if (item.kind !== 'task') return
    void setTaskStatus(item, item.completed ? 'pending' : 'completed')
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

  const monthLabel = `${cursor.year} 年 ${cursor.month} 月`
  const weekLabels = weekStartsOn === 0 ? WEEK_LABELS_SUN : WEEK_LABELS_MON

  function onGridKeyDown(e: React.KeyboardEvent) {
    const delta =
      e.key === 'ArrowLeft' ? -1
      : e.key === 'ArrowRight' ? 1
      : e.key === 'ArrowUp' ? -7
      : e.key === 'ArrowDown' ? 7
      : 0
    if (!delta) return
    e.preventDefault()
    const next = Temporal.PlainDate.from(selected).add({ days: delta })
    setSelected(next.toString())
    if (next.year !== cursor.year || next.month !== cursor.month) {
      setCursor(next.with({ day: 1 }))
    }
  }

  function selectDay(dateISO: string) {
    setSelected(dateISO)
    window.requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      dayPanelRef.current?.scrollIntoView({
        block: 'nearest',
        behavior: reduceMotion ? 'auto' : 'smooth',
      })
    })
  }

  function dayCell(dateISO: string) {
    const inMonth = dateISO.slice(0, 7) === cursor.toString().slice(0, 7)
    const isToday = dateISO === todayISO
    const isSelected = dateISO === selected
    const items = byDay?.get(dateISO) ?? []
    const pendingCount = items.filter(
      (i) => i.kind === 'event' || (!i.completed && !i.skipped),
    ).length
    const itemTitles = items.map((item) =>
      item.kind === 'event' ? item.event.title : item.task.title,
    )
    return (
      <button
        key={dateISO}
        role="gridcell"
        aria-label={`${dateISO}${itemTitles.length ? `：${itemTitles.join('、')}` : '：无安排'}`}
        aria-selected={isSelected}
        tabIndex={isSelected ? 0 : -1}
        onClick={() => selectDay(dateISO)}
        className={`calendar-day flex min-h-[76px] min-w-0 flex-col items-stretch
          justify-start rounded-xl px-0.5 pb-1 pt-1 text-[14px] sm:min-h-[92px]
          md:min-h-[112px] md:px-1 ${inMonth ? '' : 'opacity-35'} ${
            isSelected ? 'is-selected' : ''
          }`}
      >
        <span
          className={`mx-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
            isToday ? 'calendar-today font-semibold' : ''
          }`}
        >
          {Number(dateISO.slice(8))}
        </span>
        <span className="mt-0.5 min-w-0 space-y-0.5 overflow-hidden text-left" aria-hidden>
          {items.slice(0, 3).map((item, index) => {
            const title = item.kind === 'event' ? item.event.title : item.task.title
            const categoryId =
              item.kind === 'event' ? item.event.categoryId : item.task.categoryId
            const category = categoryId ? catMap.get(categoryId) : undefined
            const color = category
              ? COLOR_TOKENS[category.colorToken]
              : item.kind === 'event'
                ? '#ff650f'
                : '#a89ded'
            const hiddenAt = index === 1 ? 'hidden sm:flex' : index === 2 ? 'hidden md:flex' : 'flex'
            const resolved = item.kind === 'task' && (item.completed || item.skipped)
            return (
              <span
                key={`${item.kind}:${item.kind === 'event' ? item.event.id : item.task.id}:${index}`}
                className={`${hiddenAt} min-w-0 items-center gap-1 rounded-[5px] px-1 py-0.5
                  text-[10px] font-medium leading-[1.25] md:text-[11px] ${
                    resolved
                      ? 'bg-neutral-100 text-neutral-400 line-through dark:bg-neutral-700/70'
                      : 'bg-black/[0.035] text-neutral-700 dark:bg-white/[0.07] dark:text-neutral-200'
                  }`}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: resolved ? '#aeaeb2' : color }}
                />
                <span className="min-w-0 truncate">{title}</span>
              </span>
            )
          })}
          {items.length > 1 && (
            <span className="block truncate px-1 text-[10px] leading-3 text-neutral-400 sm:hidden">
              另 {items.length - 1} 项
            </span>
          )}
          {items.length > 2 && (
            <span className="hidden truncate px-1 text-[10px] leading-3 text-neutral-400 sm:block md:hidden">
              另 {items.length - 2} 项
            </span>
          )}
          {items.length > 3 && (
            <span className="hidden truncate px-1 text-[10px] leading-3 text-neutral-400 md:block">
              另 {items.length - 3} 项
            </span>
          )}
        </span>
        {pendingCount > 0 && <span className="sr-only">{pendingCount} 项待处理</span>}
      </button>
    )
  }

  function itemRow(item: CalItem) {
    if (item.kind === 'event') {
      const ev = item.event
      const cat = ev.categoryId ? catMap.get(ev.categoryId) : undefined
      const time = ev.startAt
        ? new Date(ev.startAt).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : null
      const span =
        ev.startDate !== ev.endDate ? `${ev.startDate.slice(5)}→${ev.endDate.slice(5)}` : null
      return (
        <li
          key={`e:${ev.id}:${item.date}`}
          className="flex items-center gap-3 border-b border-black/5 px-1 py-2.5
            last:border-b-0 dark:border-white/10"
        >
          <span
            aria-hidden
            className="h-4 w-1 shrink-0 rounded-full"
            style={{ background: cat ? COLOR_TOKENS[cat.colorToken] : '#ff650f' }}
          />
          <button
            onClick={() => setEditingEvent(ev)}
            className="min-h-11 min-w-0 flex-1 py-1 text-left"
          >
            <p className="truncate text-[15px]">{ev.title}</p>
            <p className="text-[12px] text-neutral-400">
              {time ?? '全天'}
              {span && ` · ${span}`}
            </p>
          </button>
          <button
            aria-label="删除事项"
            onClick={() => void softDeleteEvent(ev.id)}
            className="hit-target -mr-2 shrink-0 text-neutral-300 dark:text-neutral-600"
          >
            ✕
          </button>
        </li>
      )
    }
    const { task, completed, skipped } = item
    const cat = task.categoryId ? catMap.get(task.categoryId) : undefined
    return (
      <li
        key={`t:${task.id}:${item.occurrenceKey}`}
        className="flex items-center gap-3 border-b border-black/5 px-1 py-2.5
          last:border-b-0 dark:border-white/10"
      >
        <button
          aria-label={completed ? '取消完成' : '完成'}
          onClick={() => toggleItem(item)}
          className="hit-target -ml-2.5 shrink-0 transition active:scale-95"
        >
          <span
            className={`flex h-[22px] w-[22px] items-center justify-center rounded-full
              border-[1.5px] ${
                completed
                  ? 'calendar-task-check is-complete text-white'
                  : 'border-neutral-300 dark:border-neutral-600'
              }`}
          >
            {completed && (
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path
                  className="check-path"
                  d="M2 6.5L4.5 9L10 3.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </span>
        </button>
        <button
          onClick={() => setEditingTask(item)}
          className="min-h-11 min-w-0 flex-1 py-1 text-left"
          aria-label={`编辑任务：${task.title}`}
        >
          <p
            className={`truncate text-[15px] ${
              completed ? 'text-neutral-400 line-through' : ''
            } ${skipped ? 'text-neutral-400' : ''}`}
          >
            {task.title}
            {skipped && <span className="ml-1 text-[12px]">（已跳过）</span>}
          </p>
          {(item.subtitle || cat) && (
            <p className="flex items-center gap-1 text-[12px] text-neutral-400">
              {cat && (
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: COLOR_TOKENS[cat.colorToken] }}
                />
              )}
              {[cat?.name, item.subtitle].filter(Boolean).join(' · ')}
            </p>
          )}
        </button>
      </li>
    )
  }

  const selectedItems = byDay?.get(selected) ?? []

  return (
    <section className="app-page page-plan">
      <PageHeader
        title="计划"
        eyebrow="日历与安排"
        actions={(
          <div
          role="tablist"
          aria-label="视图模式"
          className="segmented-control flex rounded-lg bg-black/5 p-0.5 text-[13px] dark:bg-white/10"
        >
          {(['month', 'list'] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => switchMode(m)}
              className={`min-h-11 rounded-md px-3 py-1 transition ${
                mode === m
                  ? 'is-active bg-white shadow-sm dark:bg-neutral-700'
                  : 'text-neutral-500'
              }`}
            >
              {m === 'month' ? '月历' : '列表'}
            </button>
          ))}
          </div>
        )}
      />

      {mode === 'month' ? (
        <>
          <div className="mt-4 flex items-center justify-between px-1">
            <p className="text-[17px] font-semibold">{monthLabel}</p>
            <div className="calendar-panel-action flex items-center gap-1">
              <button
                aria-label="上个月"
                onClick={() => setCursor(cursor.subtract({ months: 1 }))}
                className="hit-target rounded-xl text-xl active:bg-black/5"
              >
                ‹
              </button>
              <button
                onClick={() => {
                  setCursor(Temporal.PlainDate.from(todayISO).with({ day: 1 }))
                  setSelected(todayISO)
                }}
                className="hit-target rounded-xl text-[13px] active:bg-black/5"
              >
                今天
              </button>
              <button
                aria-label="下个月"
                onClick={() => setCursor(cursor.add({ months: 1 }))}
                className="hit-target rounded-xl text-xl active:bg-black/5"
              >
                ›
              </button>
            </div>
          </div>

          <div
            role="grid"
            aria-label={monthLabel}
            onKeyDown={onGridKeyDown}
            className="calendar-card mt-2 rounded-2xl bg-white p-2 dark:bg-neutral-800"
          >
            <div className="grid grid-cols-7 text-center text-[11px] text-neutral-400">
              {weekLabels.map((w) => (
                <span key={w} className="py-1">
                  {w}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7">{grid.map(dayCell)}</div>
          </div>

          <div ref={dayPanelRef} className="calendar-day-panel mt-4 scroll-mb-28">
            <div key={selected} className="day-panel-in">
              <div className="flex items-end justify-between gap-3 px-1">
                <div>
                  <p className="text-[13px] font-medium text-neutral-400">当天安排</p>
                  <h2 className="mt-0.5 text-[17px] font-semibold">
                    {new Date(selected + 'T00:00:00').toLocaleDateString('zh-CN', {
                      month: 'long',
                      day: 'numeric',
                      weekday: 'long',
                    })}
                  </h2>
                </div>
                <span className="shrink-0 pb-0.5 text-[12px] text-neutral-400">
                  {selectedItems.length} 项
                </span>
              </div>

              <div
                className="calendar-composer quick-card mt-2 min-w-0 rounded-2xl bg-white/75 p-2.5
                  shadow-sm ring-1 ring-black/5 dark:bg-neutral-800/75 dark:ring-white/5"
              >
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void submitDraft()
                    }
                  }}
                  rows={1}
                  enterKeyHint="done"
                  placeholder={
                    draftKind === 'event'
                      ? '在所选日期添加计划；多项可换行…'
                      : '在所选日期添加任务；多项可换行…'
                  }
                  className="min-h-12 w-full min-w-0 resize-none rounded-xl bg-transparent px-2.5
                    py-2.5 text-[16px] leading-6 outline-none placeholder:text-neutral-400"
                />
                <div className="mt-1.5 flex min-w-0 items-center gap-2">
                  <select
                    aria-label="类型"
                    value={draftKind}
                    onChange={(e) => setDraftKind(e.target.value as 'event' | 'task')}
                    className="min-h-11 min-w-0 flex-1 rounded-xl bg-neutral-100 px-2.5
                      text-[13px] dark:bg-neutral-700"
                  >
                    <option value="event">计划</option>
                    <option value="task">任务</option>
                  </select>
                  {draftKind === 'event' && (
                    <input
                      type="time"
                      aria-label="时间（可选）"
                      value={draftTime}
                      onChange={(e) => setDraftTime(e.target.value)}
                      className="min-h-11 min-w-0 max-w-[9.5rem] flex-[1.15] rounded-xl
                        bg-neutral-100 px-2.5 text-[13px] dark:bg-neutral-700"
                    />
                  )}
                  {draftKind === 'task' && (
                    <select
                      aria-label="任务周期"
                      value={draftScope}
                      onChange={(e) => setDraftScope(e.target.value as TaskScope)}
                      className="min-h-11 min-w-0 max-w-[9.5rem] flex-[1.15] rounded-xl
                        bg-neutral-100 px-2.5 text-[13px] dark:bg-neutral-700"
                    >
                      <option value="daily">每日任务</option>
                      <option value="weekly">每周任务</option>
                    </select>
                  )}
                  <button
                    onClick={() => void submitDraft()}
                    disabled={!draft.trim() || submitting}
                    aria-label="添加"
                    className="primary-action h-11 w-11 shrink-0 rounded-xl text-xl
                      transition-transform active:scale-95 disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
              </div>
              <p role="status" className="min-h-5 px-2 pt-1 text-[12px] text-neutral-500">
                {feedback}
              </p>
              {selectedItems.length > 0 ? (
                <ul className="list-card mt-2 rounded-2xl bg-white px-3 dark:bg-neutral-800">
                  {selectedItems.map(itemRow)}
                </ul>
              ) : (
                <p className="mt-3 px-1 text-center text-[13px] text-neutral-400">
                  这一天暂无安排，可在上方直接添加
                </p>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="mt-4">
          {byDay &&
            Array.from({ length: 30 }, (_, i) =>
              Temporal.PlainDate.from(todayISO).add({ days: i }).toString(),
            )
              .filter((d) => (byDay.get(d)?.length ?? 0) > 0)
              .map((d) => (
                <div key={d} className="mb-4">
                  <p className="px-1 text-[12px] font-medium text-neutral-400">
                    {new Date(d + 'T00:00:00').toLocaleDateString('zh-CN', {
                      month: 'long',
                      day: 'numeric',
                      weekday: 'short',
                    })}
                    {d === todayISO && ' · 今天'}
                  </p>
                  <ul className="list-card mt-1.5 rounded-2xl bg-white px-3 dark:bg-neutral-800">
                    {byDay.get(d)!.map(itemRow)}
                  </ul>
                </div>
              ))}
          {byDay &&
            Array.from({ length: 30 }, (_, i) =>
              Temporal.PlainDate.from(todayISO).add({ days: i }).toString(),
            ).every((d) => (byDay.get(d)?.length ?? 0) === 0) && (
              <div
                className="rounded-2xl border border-dashed border-neutral-300 p-8
                  text-center text-neutral-400 dark:border-neutral-700"
              >
                未来 30 天暂无安排
              </div>
            )}
        </div>
      )}
      {editingEvent && (
        <EventEditor
          event={editingEvent}
          categories={categories ?? []}
          onClose={() => setEditingEvent(null)}
        />
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
