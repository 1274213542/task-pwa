import type { Task } from './db'
import { latestFixedOnOrBefore, type Recurrence, type Weekday } from './recurrence'
import {
  calendarDateForTask,
  civilDateOf,
  effectiveTaskSchedule,
  explicitTaskDueAt,
  taskMapOf,
  taskNodeRoleOf,
  taskScheduleTypeOf,
} from './taskSchedule'
import { taskScopeOf } from './taskPeriods'

export type TaskView = 'today' | 'longTerm'

/**
 * A non-recurring “今日任务” is a dated task instance, not a daily template.
 * Keep this projection pure: the task's stored schedule decides which civil
 * date owns it, and completion history never rewrites that ownership.
 */
export function isOneTimeTaskAssignedToDate(
  task: Task,
  dateISO: string,
  tasks: Task[],
): boolean {
  if (taskNodeRoleOf(task) === 'plan' || effectiveRecurrence(task)) return false
  const scheduledDate = calendarDateForTask(task, tasks)
  if (scheduledDate) return scheduledDate === dateISO
  return taskScheduleTypeOf(task) === 'today' && civilDateOf(task.createdAt) === dateISO
}

/**
 * Safe read adapter for records written before 今日任务 / 长期任务 replaced
 * 每日任务 / 每周任务. Old weekly rows behaved as weekly templates even when
 * they did not yet carry a structured recurrence rule.
 */
export function effectiveRecurrence(task: Task): Recurrence | undefined {
  if (taskNodeRoleOf(task) === 'plan') return undefined
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

export function isTodayTaskDefinition(
  task: Task,
  todayISO: string,
  tasks: Task[],
  taskMap = taskMapOf(tasks),
): boolean {
  if (taskNodeRoleOf(task) === 'plan') return false
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

  const schedule = effectiveTaskSchedule(task, taskMap)
  const startDate = civilDateOf(schedule.startAt) ?? task.startDate
  const dueDate = civilDateOf(explicitTaskDueAt(task, taskMap))
  if (dueDate && dueDate <= todayISO) return true
  return schedule.type === 'today' && (!startDate || startDate <= todayISO)
}

export function isLongTermTaskDefinition(
  task: Task,
  todayISO: string,
  tasks: Task[],
  taskMap = taskMapOf(tasks),
): boolean {
  if (taskNodeRoleOf(task) === 'plan') return true
  let parentId = task.parentTaskId
  const visited = new Set<string>()
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = taskMap.get(parentId)
    if (!parent) break
    if (taskNodeRoleOf(parent) === 'plan') return true
    parentId = parent.parentTaskId
  }
  if (effectiveRecurrence(task)) return true
  if (taskScopeOf(task) === 'weekly') return true
  const schedule = effectiveTaskSchedule(task, taskMap)
  const startDate = civilDateOf(schedule.startAt) ?? task.startDate
  const dueDate = civilDateOf(explicitTaskDueAt(task, taskMap))
  return schedule.type === 'longTerm' ||
    schedule.type === 'unscheduled' ||
    Boolean(startDate && startDate > todayISO) ||
    Boolean(dueDate && dueDate > todayISO)
}

export function taskViewFromStorage(value: string | null): TaskView {
  if (value === 'longTerm' || value === 'weekly') return 'longTerm'
  return 'today'
}
