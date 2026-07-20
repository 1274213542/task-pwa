import { Temporal } from 'temporal-polyfill'
import type { Task, TaskScheduleType } from './db'

export interface EffectiveTaskSchedule {
  type: TaskScheduleType
  startAt?: string
  dueAt?: string
  showBeforeStart: boolean
  surfaceDaysBeforeDue: number
  inheritedFrom?: string
}

export type DueTone = 'none' | 'future' | 'soon' | 'today' | 'overdue' | 'completed'

export interface TaskDueStatus {
  tone: DueTone
  label?: string
  days: number | null
  dueDate?: string
}

export const civilDateOf = (value?: string): string | undefined => {
  if (!value) return undefined
  const date = value.slice(0, 10)
  try {
    return Temporal.PlainDate.from(date).toString()
  } catch {
    return undefined
  }
}

export function taskScheduleTypeOf(task: Pick<Task, 'scheduleType' | 'recurrence' | 'startDate' | 'endDate'>): TaskScheduleType {
  if (task.scheduleType) return task.scheduleType
  if (task.recurrence) return 'today'
  if (task.startDate && task.endDate && task.endDate > task.startDate) return 'longTerm'
  return task.startDate ? 'today' : 'unscheduled'
}

/** Safe read projection for both migrated rows and data arriving from an older device. */
export function effectiveTaskSchedule(
  task: Task,
  tasks: Task[] | Map<string, Task> = [],
): EffectiveTaskSchedule {
  const map = tasks instanceof Map ? tasks : new Map(tasks.map((item) => [item.id, item]))
  const visited = new Set<string>()
  let source = task
  while (source.parentTaskId && source.inheritsParentSchedule !== false) {
    if (visited.has(source.id)) break
    visited.add(source.id)
    const parent = map.get(source.parentTaskId)
    if (!parent) break
    source = parent
  }
  const type = task.inheritsParentSchedule !== false && source.id !== task.id
    ? taskScheduleTypeOf(source)
    : taskScheduleTypeOf(task)
  const startAt = task.inheritsParentSchedule !== false && source.id !== task.id
    ? source.startAt ?? source.startDate
    : task.startAt ?? task.startDate
  const dueAt = task.inheritsParentSchedule !== false && source.id !== task.id
    ? source.dueAt ?? (type === 'longTerm' ? source.endDate : type === 'today' ? startAt : undefined)
    : task.dueAt ?? (type === 'longTerm' ? task.endDate : type === 'today' ? startAt : undefined)

  return {
    type,
    startAt,
    dueAt,
    showBeforeStart: task.showBeforeStart ?? source.showBeforeStart ?? false,
    surfaceDaysBeforeDue: task.surfaceDaysBeforeDue ?? source.surfaceDaysBeforeDue ?? 3,
    ...(source.id !== task.id && { inheritedFrom: source.id }),
  }
}

export function legacyTaskSchedulePatch(task: Task): Partial<Task> {
  const type = taskScheduleTypeOf(task)
  return {
    scheduleType: type,
    ...(task.startAt === undefined && task.startDate && { startAt: task.startDate }),
    ...(task.dueAt === undefined && type === 'longTerm' && task.endDate && { dueAt: task.endDate }),
    showBeforeStart: task.showBeforeStart ?? false,
    surfaceDaysBeforeDue: task.surfaceDaysBeforeDue ?? 3,
    inheritsParentSchedule: task.parentTaskId
      ? task.inheritsParentSchedule ?? true
      : false,
  }
}

export function taskDueStatus(
  task: Task,
  todayISO: string,
  tasks: Task[] | Map<string, Task> = [],
  completedAt?: string,
): TaskDueStatus {
  const completion = completedAt ?? task.completedAt
  if (completion) {
    const date = civilDateOf(completion)
    return {
      tone: 'completed',
      label: date ? `已于 ${Number(date.slice(5, 7))}月${Number(date.slice(8))}日完成` : '已完成',
      days: null,
    }
  }

  const dueDate = civilDateOf(effectiveTaskSchedule(task, tasks).dueAt)
  if (!dueDate) return { tone: 'none', days: null }
  const days = Temporal.PlainDate.from(todayISO).until(Temporal.PlainDate.from(dueDate)).days
  if (days < 0) return { tone: 'overdue', label: `已逾期 ${Math.abs(days)} 天`, days, dueDate }
  if (days === 0) return { tone: 'today', label: '今天截止', days, dueDate }
  if (days === 1) return { tone: 'soon', label: '明天截止', days, dueDate }
  if (days <= 3) return { tone: 'soon', label: `还剩 ${days} 天`, days, dueDate }
  return { tone: 'future', label: `还剩 ${days} 天`, days, dueDate }
}

export function taskScheduleLabel(task: Task, todayISO: string, tasks: Task[] = [], completedAt?: string): string {
  const schedule = effectiveTaskSchedule(task, tasks)
  const due = taskDueStatus(task, todayISO, tasks, completedAt)
  const prefix = schedule.type === 'today'
    ? '今日必须完成'
    : schedule.type === 'longTerm'
      ? '长期任务'
      : '未排期'
  return due.label ? `${prefix} · ${due.label}` : prefix
}

export function isTaskExecutable(task: Task, todayISO: string, tasks: Task[] = []): boolean {
  const schedule = effectiveTaskSchedule(task, tasks)
  if (schedule.type === 'unscheduled') return false
  const start = civilDateOf(schedule.startAt)
  if (!start || start <= todayISO || schedule.showBeforeStart) return true
  const due = civilDateOf(schedule.dueAt)
  if (!due) return false
  const days = Temporal.PlainDate.from(todayISO).until(Temporal.PlainDate.from(due)).days
  return days <= schedule.surfaceDaysBeforeDue
}

export function calendarDateForTask(task: Task, tasks: Task[] = []): string | undefined {
  const schedule = effectiveTaskSchedule(task, tasks)
  return civilDateOf(schedule.dueAt) ?? civilDateOf(schedule.startAt) ?? task.startDate
}

export function taskSmartPriority(task: Task, completed: boolean, todayISO: string, tasks: Task[] = []): number {
  if (completed) return 90
  const schedule = effectiveTaskSchedule(task, tasks)
  const due = taskDueStatus(task, todayISO, tasks)
  if (due.tone === 'overdue') return 0
  if (due.tone === 'today') return 10
  if (due.tone === 'soon') return 20
  if (schedule.type === 'today') return 30
  if ((task.taskScope ?? 'daily') === 'daily' && !due.dueDate) return 40
  if (schedule.type === 'longTerm' && isTaskExecutable(task, todayISO, tasks)) return 50
  if (due.dueDate) return 60
  if (schedule.type === 'longTerm') return 70
  return 80
}

export function leafTaskIds(tasks: Task[]): Set<string> {
  const parents = new Set(tasks.filter((task) => task.lifecycleStatus === 'active' && task.parentTaskId).map((task) => task.parentTaskId!))
  return new Set(tasks.filter((task) => !parents.has(task.id)).map((task) => task.id))
}

export function childProgress(
  taskId: string,
  tasks: Task[],
  completedTaskIds: Set<string>,
): { completed: number; total: number } | undefined {
  const children = tasks.filter((task) => task.lifecycleStatus === 'active' && task.parentTaskId === taskId)
  if (children.length === 0) return undefined
  const counts = children.map((child) => {
    const nested = childProgress(child.id, tasks, completedTaskIds)
    return nested ?? { completed: Number(completedTaskIds.has(child.id)), total: 1 }
  })
  return {
    completed: counts.reduce((sum, count) => sum + count.completed, 0),
    total: counts.reduce((sum, count) => sum + count.total, 0),
  }
}

export function wouldCreateParentCycle(taskId: string, parentTaskId: string | undefined, tasks: Task[]): boolean {
  let current = parentTaskId
  const visited = new Set<string>([taskId])
  while (current) {
    if (visited.has(current)) return true
    visited.add(current)
    current = tasks.find((task) => task.id === current)?.parentTaskId
  }
  return false
}
