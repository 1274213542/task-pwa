import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Temporal } from 'temporal-polyfill'
import { db } from '../lib/db'
import { type CalItem, buildCalendarItems, monthGrid } from '../lib/calendar'
import { todayLocalISO } from '../lib/dates'
import { COLOR_TOKENS } from '../lib/categories'
import { addEvent, softDeleteEvent } from '../lib/events'
import {
  RecurrenceConflictError,
  addTask,
  completeFixedOccurrence,
  completeTask,
  resolveAfterCompletion,
  voidRecord,
} from '../lib/tasks'

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

  const prefs = useLiveQuery(() => db.syncedPreferences.get('#prefs'), [])
  const weekStartsOn = (prefs?.weekStartsOn ?? 1) as 1 | 0

  const tasks = useLiveQuery(
    () => db.tasks.where('lifecycleStatus').equals('active').toArray(),
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

  function toggleItem(item: CalItem) {
    if (item.kind !== 'task') return
    void guarded(async () => {
      const { task, occurrenceKey, completed, date } = item
      if (completed) {
        if (occurrenceKey.startsWith('ac:')) return // ac 撤销只在今天视图（仅最近一期）
        await voidRecord(`${task.id}:${occurrenceKey}`)
      } else if (occurrenceKey === 'single') {
        await completeTask(task)
      } else if (occurrenceKey.startsWith('fixed:')) {
        await completeFixedOccurrence(task, date) // 提前完成未来一期：允许（决策表 #5）
      } else {
        await resolveAfterCompletion(task, 'completed')
      }
    })
  }

  async function submitDraft() {
    if (!draft.trim()) return
    if (draftKind === 'event') {
      await addEvent({ title: draft, date: selected, time: draftTime || undefined })
    } else {
      await addTask(draft, undefined, undefined, selected)
    }
    setDraft('')
    setDraftTime('')
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

  function dayCell(dateISO: string) {
    const inMonth = dateISO.slice(0, 7) === cursor.toString().slice(0, 7)
    const isToday = dateISO === todayISO
    const isSelected = dateISO === selected
    const items = byDay?.get(dateISO) ?? []
    const pendingCount = items.filter(
      (i) => i.kind === 'event' || (!i.completed && !i.skipped),
    ).length
    return (
      <button
        key={dateISO}
        role="gridcell"
        aria-label={dateISO}
        aria-selected={isSelected}
        tabIndex={isSelected ? 0 : -1}
        onClick={() => setSelected(dateISO)}
        className={`flex h-12 flex-col items-center justify-start rounded-lg pt-1
          text-[14px] transition ${inMonth ? '' : 'opacity-30'} ${
            isSelected ? 'bg-[#007aff]/10' : ''
          }`}
      >
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full ${
            isToday ? 'bg-[#007aff] font-semibold text-white' : ''
          }`}
        >
          {Number(dateISO.slice(8))}
        </span>
        <span className="mt-0.5 flex gap-0.5" aria-hidden>
          {items.slice(0, 3).map((it, i) => (
            <span
              key={i}
              className={`h-1 w-1 rounded-full ${
                it.kind === 'event'
                  ? 'bg-orange-400'
                  : it.completed || it.skipped
                    ? 'bg-neutral-300 dark:bg-neutral-600'
                    : 'bg-[#007aff]'
              }`}
            />
          ))}
          {pendingCount > 3 && (
            <span className="text-[8px] leading-none text-neutral-400">+</span>
          )}
        </span>
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
            style={{ background: cat ? COLOR_TOKENS[cat.colorToken] : '#ff9500' }}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px]">{ev.title}</p>
            <p className="text-[12px] text-neutral-400">
              {time ?? '全天'}
              {span && ` · ${span}`}
            </p>
          </div>
          <button
            aria-label="删除事项"
            onClick={() => void softDeleteEvent(ev.id)}
            className="shrink-0 px-2 text-neutral-300 dark:text-neutral-600"
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
          className={`flex h-[20px] w-[20px] shrink-0 items-center justify-center
            rounded-full border-[1.5px] transition active:scale-90 ${
              completed
                ? 'border-[#007aff] bg-[#007aff] text-white'
                : 'border-neutral-300 dark:border-neutral-600'
            }`}
        >
          {completed && (
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path
                d="M2 6.5L4.5 9L10 3.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
        <div className="min-w-0 flex-1">
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
        </div>
      </li>
    )
  }

  const selectedItems = byDay?.get(selected) ?? []

  return (
    <section>
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">计划</h1>
        {/* 明确的模式切换控件（v4.2 §10：不用下拉手势） */}
        <div
          role="tablist"
          aria-label="视图模式"
          className="flex rounded-lg bg-black/5 p-0.5 text-[13px] dark:bg-white/10"
        >
          {(['month', 'list'] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => switchMode(m)}
              className={`rounded-md px-3 py-1 transition ${
                mode === m
                  ? 'bg-white shadow-sm dark:bg-neutral-700'
                  : 'text-neutral-500'
              }`}
            >
              {m === 'month' ? '月历' : '列表'}
            </button>
          ))}
        </div>
      </div>

      {mode === 'month' ? (
        <>
          <div className="mt-4 flex items-center justify-between px-1">
            <p className="text-[17px] font-semibold">{monthLabel}</p>
            <div className="flex items-center gap-1 text-[#007aff]">
              <button
                aria-label="上个月"
                onClick={() => setCursor(cursor.subtract({ months: 1 }))}
                className="rounded-lg px-2.5 py-1 text-lg active:bg-black/5"
              >
                ‹
              </button>
              <button
                onClick={() => {
                  setCursor(Temporal.PlainDate.from(todayISO).with({ day: 1 }))
                  setSelected(todayISO)
                }}
                className="rounded-lg px-2 py-1 text-[13px] active:bg-black/5"
              >
                今天
              </button>
              <button
                aria-label="下个月"
                onClick={() => setCursor(cursor.add({ months: 1 }))}
                className="rounded-lg px-2.5 py-1 text-lg active:bg-black/5"
              >
                ›
              </button>
            </div>
          </div>

          <div
            role="grid"
            aria-label={monthLabel}
            onKeyDown={onGridKeyDown}
            className="mt-2 rounded-2xl bg-white p-2 dark:bg-neutral-800"
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

          <div className="mt-4">
            <p className="px-1 text-[13px] font-medium text-neutral-400">
              {new Date(selected + 'T00:00:00').toLocaleDateString('zh-CN', {
                month: 'long',
                day: 'numeric',
                weekday: 'long',
              })}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void submitDraft()}
                placeholder={draftKind === 'event' ? '添加事项 / 备注…' : '添加任务…'}
                className="min-w-0 flex-1 rounded-xl bg-white px-3 py-2 text-[15px]
                  outline-none placeholder:text-neutral-400 dark:bg-neutral-800"
              />
              <select
                aria-label="类型"
                value={draftKind}
                onChange={(e) => setDraftKind(e.target.value as 'event' | 'task')}
                className="rounded-lg bg-white px-1.5 py-2 text-[13px] dark:bg-neutral-800"
              >
                <option value="event">事项</option>
                <option value="task">任务</option>
              </select>
              {draftKind === 'event' && (
                <input
                  type="time"
                  aria-label="时间（可选）"
                  value={draftTime}
                  onChange={(e) => setDraftTime(e.target.value)}
                  className="rounded-lg bg-white px-1.5 py-1.5 text-[13px] dark:bg-neutral-800"
                />
              )}
              <button
                onClick={() => void submitDraft()}
                disabled={!draft.trim()}
                aria-label="添加"
                className="h-9 w-9 shrink-0 rounded-xl bg-[#007aff] text-lg text-white
                  disabled:opacity-40"
              >
                +
              </button>
            </div>
            {selectedItems.length > 0 ? (
              <ul className="mt-2 rounded-2xl bg-white px-3 dark:bg-neutral-800">
                {selectedItems.map(itemRow)}
              </ul>
            ) : (
              <p className="mt-3 px-1 text-center text-[13px] text-neutral-400">
                这一天暂无安排
              </p>
            )}
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
                  <ul className="mt-1.5 rounded-2xl bg-white px-3 dark:bg-neutral-800">
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
    </section>
  )
}
