import { Temporal } from 'temporal-polyfill'
import type { Task, TaskScope } from './db'
import type { FixedScheduleRule } from './recurrence'

/** 周一为一周起点，所有计算基于设备本地 PlainDate。 */
export function weekStartISO(dateISO: string): string {
  const date = Temporal.PlainDate.from(dateISO)
  return date.subtract({ days: date.dayOfWeek - 1 }).toString()
}

export function weekEndISO(dateISO: string): string {
  return Temporal.PlainDate.from(weekStartISO(dateISO)).add({ days: 6 }).toString()
}

/** 云端旧记录可能在迁移后到达，因此读取时仍保留安全默认值。 */
export function taskScopeOf(task: Pick<Task, 'taskScope'>): TaskScope {
  return task.taskScope ?? 'daily'
}

export function periodAnchorISO(scope: TaskScope, dateISO: string): string {
  return scope === 'weekly' ? weekStartISO(dateISO) : dateISO
}

export function defaultFixedRecurrence(scope: TaskScope): FixedScheduleRule {
  return scope === 'weekly'
    ? {
        mode: 'fixed_schedule',
        frequency: 'weekly',
        interval: 1,
        weekdays: [1],
        overflowPolicy: 'clamp',
      }
    : {
        mode: 'fixed_schedule',
        frequency: 'daily',
        interval: 1,
        overflowPolicy: 'clamp',
      }
}

/** 每周固定任务整周共享一个确定性 occurrenceKey。 */
export function periodOccurrenceKey(scope: TaskScope, dateISO: string): string {
  return `fixed:${periodAnchorISO(scope, dateISO)}`
}
