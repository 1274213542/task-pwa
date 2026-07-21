import type { Task } from './db'
import { latestFixedOnOrBefore, type Recurrence, type Weekday } from './recurrence'
import { civilDateOf, effectiveTaskSchedule, explicitTaskDueAt } from './taskSchedule'
import { taskScopeOf } from './taskPeriods'

export type TaskView = 'today' | 'longTerm'

/**
 * Safe read adapter for records written before 今日任务 / 长期任务 replaced
 * 每日任务 / 每周任务. Old weekly rows behaved as weekly templates even when
 * they did not yet carry a structured recurrence rule.
 */
export function effectiveRecurrence(task: Task): Recurrence | undefined {
  if (task.recurrence) return task.recurrence
  if (taskScopeOf(task) !== 'weekly') return undefined
  const anchor = task.startDate ?? civilDateOf(task.startAt)
  const weekday = anchor
    ? (new Date(`${anchor}T12:00:00`).getDay() || 7) as Weekday
    : 1
  return {
    mode: 'fixed_schedule',
    frequency: 'weekly',
    interval: 1,
    weekdays: [weekday],
    overflowPolicy: 'clamp',
  }
}

export function isTodayTaskDefinition(task: Task, todayISO: string, tasks: Task[]): boolean {
  const recurrence = effectiveRecurrence(task)
  if (recurrence?.mode === 'fixed_schedule') {
    return Boolean(latestFixedOnOrBefore(
      recurrence,
      task.startDate ?? civilDateOf(task.startAt) ?? todayISO,
      task.endDate,
      todayISO,
    ))
  }
  if (recurrence?.mode === 'after_completion') {
    return (task.nextDueDate ?? task.startDate ?? todayISO) <= todayISO
  }

  const schedule = effectiveTaskSchedule(task, tasks)
  const startDate = civilDateOf(schedule.startAt) ?? task.startDate
  const dueDate = civilDateOf(explicitTaskDueAt(task, tasks))
  if (dueDate && dueDate <= todayISO) return true
  return schedule.type === 'today' && (!startDate || startDate <= todayISO)
}

export function isLongTermTaskDefinition(task: Task, todayISO: string, tasks: Task[]): boolean {
  if (effectiveRecurrence(task)) return true
  if (taskScopeOf(task) === 'weekly') return true
  const schedule = effectiveTaskSchedule(task, tasks)
  const startDate = civilDateOf(schedule.startAt) ?? task.startDate
  const dueDate = civilDateOf(explicitTaskDueAt(task, tasks))
  return schedule.type === 'longTerm' ||
    schedule.type === 'unscheduled' ||
    Boolean(startDate && startDate > todayISO) ||
    Boolean(dueDate && dueDate > todayISO)
}

export function taskViewFromStorage(value: string | null): TaskView {
  if (value === 'longTerm' || value === 'weekly') return 'longTerm'
  return 'today'
}
