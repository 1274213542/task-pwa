import { Temporal } from 'temporal-polyfill'
import type { CalendarEvent, CompletionRecord, Task } from './db'
import { describeRecurrence, fixedOccurrencesInRange } from './recurrence'

/**
 * 月历网格与统一投影（v4.2 §8 CalendarItemView）。
 * 任务不复制存储：普通任务按 startDate、周期任务虚拟展开、
 * after_completion 按 nextDueDate、日程按日切片，三路合并按日分桶。
 */

/** 42 格月历（6 行 × 7 列），含前后月补位 */
export function monthGrid(
  year: number,
  month: number,
  weekStartsOn: 1 | 0, // 1=周一起，0=周日起
): string[] {
  const first = Temporal.PlainDate.from({ year, month, day: 1 })
  const lead = (7 + first.dayOfWeek - (weekStartsOn === 0 ? 7 : weekStartsOn)) % 7
  let d = first.subtract({ days: lead })
  const out: string[] = []
  for (let i = 0; i < 42; i++) {
    out.push(d.toString())
    d = d.add({ days: 1 })
  }
  return out
}

export type CalItem =
  | {
      kind: 'task'
      task: Task
      occurrenceKey: string
      date: string
      completed: boolean
      skipped: boolean
      subtitle?: string
    }
  | { kind: 'event'; event: CalendarEvent; date: string }

/** 窗口内全部条目按日分桶（rangeStart/rangeEnd 含两端） */
export function buildCalendarItems(
  tasks: Task[],
  records: CompletionRecord[],
  events: CalendarEvent[],
  rangeStart: string,
  rangeEnd: string,
): Map<string, CalItem[]> {
  const recMap = new Map(records.map((r) => [r.id, r]))
  const byDay = new Map<string, CalItem[]>()
  const push = (date: string, item: CalItem) => {
    if (date < rangeStart || date > rangeEnd) return
    if (!byDay.has(date)) byDay.set(date, [])
    byDay.get(date)!.push(item)
  }
  const status = (taskId: string, key: string) => {
    const r = recMap.get(`${taskId}:${key}`)
    return {
      completed: r?.resolution === 'completed',
      skipped: r?.resolution === 'skipped',
    }
  }

  for (const task of tasks) {
    const r = task.recurrence
    if (!r) {
      const date = task.startDate
      if (!date) continue
      push(date, {
        kind: 'task',
        task,
        occurrenceKey: 'single',
        date,
        ...status(task.id, 'single'),
      })
    } else if (r.mode === 'fixed_schedule') {
      const start = task.startDate ?? rangeStart
      for (const date of fixedOccurrencesInRange(
        r,
        start,
        task.endDate,
        rangeStart,
        rangeEnd,
      )) {
        push(date, {
          kind: 'task',
          task,
          occurrenceKey: `fixed:${date}`,
          date,
          ...status(task.id, `fixed:${date}`),
          subtitle: describeRecurrence(r),
        })
      }
    } else {
      const due = task.nextDueDate
      if (due) {
        push(due, {
          kind: 'task',
          task,
          occurrenceKey: `ac:${task.currentSequence ?? 1}`,
          date: due,
          completed: false,
          skipped: false,
          subtitle: describeRecurrence(r),
        })
      }
    }
  }

  for (const ev of events) {
    // 跨日事项按日切片渲染（存储不复制）
    let d = Temporal.PlainDate.from(
      ev.startDate > rangeStart ? ev.startDate : rangeStart,
    )
    const end = Temporal.PlainDate.from(
      ev.endDate < rangeEnd ? ev.endDate : rangeEnd,
    )
    while (Temporal.PlainDate.compare(d, end) <= 0) {
      push(d.toString(), { kind: 'event', event: ev, date: d.toString() })
      d = d.add({ days: 1 })
    }
  }

  return byDay
}
