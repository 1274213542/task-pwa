import type { Task } from './db'
import { todayLocalISO } from './dates'
import { effectiveTaskSchedule, taskDueStatus, taskSmartPriority } from './taskSchedule'

export type TaskStatusFilter = 'all' | 'pending' | 'completed'
export type TaskPropertyFilter = 'all' | 'single' | 'recurring'
export type TaskScheduleFilter = 'all' | 'today' | 'longTerm' | 'dated' | 'undated' | 'overdue'
export type TaskSortMode = 'smart' | 'manual' | 'updated' | 'created' | 'unfinished'
export type TaskListDensity = 'standard' | 'compact'

export interface TaskViewSettings {
  status: TaskStatusFilter
  property: TaskPropertyFilter
  schedule: TaskScheduleFilter
  sort: TaskSortMode
  showCompleted: boolean
  density: TaskListDensity
}

export const DEFAULT_TASK_VIEW_SETTINGS: TaskViewSettings = {
  status: 'all',
  property: 'all',
  schedule: 'all',
  sort: 'smart',
  showCompleted: true,
  density: 'standard',
}

export interface TaskViewCandidate {
  task: Pick<Task, 'recurrence' | 'createdAt' | 'updatedAt'> & Partial<Task>
  completed: boolean
}

export function parseTaskViewSettings(raw: string | null): TaskViewSettings {
  if (!raw) return DEFAULT_TASK_VIEW_SETTINGS
  try {
    const value = JSON.parse(raw) as Partial<TaskViewSettings>
    return {
      status: ['all', 'pending', 'completed'].includes(value.status ?? '')
        ? value.status as TaskStatusFilter
        : DEFAULT_TASK_VIEW_SETTINGS.status,
      property: ['all', 'single', 'recurring'].includes(value.property ?? '')
        ? value.property as TaskPropertyFilter
        : DEFAULT_TASK_VIEW_SETTINGS.property,
      schedule: ['all', 'today', 'longTerm', 'dated', 'undated', 'overdue'].includes(value.schedule ?? '')
        ? value.schedule as TaskScheduleFilter
        : DEFAULT_TASK_VIEW_SETTINGS.schedule,
      sort: ['smart', 'manual', 'updated', 'created', 'unfinished'].includes(value.sort ?? '')
        ? value.sort as TaskSortMode
        : DEFAULT_TASK_VIEW_SETTINGS.sort,
      showCompleted: value.showCompleted ?? DEFAULT_TASK_VIEW_SETTINGS.showCompleted,
      density: ['standard', 'compact'].includes(value.density ?? '')
        ? value.density as TaskListDensity
        : DEFAULT_TASK_VIEW_SETTINGS.density,
    }
  } catch {
    return DEFAULT_TASK_VIEW_SETTINGS
  }
}

/** Stable projection: filters never mutate task data or its manual rank. */
export function applyTaskViewSettings<T extends TaskViewCandidate>(
  items: T[],
  settings: TaskViewSettings,
): T[] {
  const today = todayLocalISO()
  const allTasks = items.map((item) => item.task as Task)
  const filtered = items.filter((item) => {
    if (settings.status === 'pending' && item.completed) return false
    if (settings.status === 'completed' && !item.completed) return false
    if (!settings.showCompleted && settings.status !== 'completed' && item.completed) return false
    const recurring = Boolean(item.task.recurrence)
    if (settings.property === 'single' && recurring) return false
    if (settings.property === 'recurring' && !recurring) return false
    const task = item.task as Task
    const type = effectiveTaskSchedule(task, allTasks).type
    const due = taskDueStatus(task, today, allTasks)
    if (settings.schedule === 'today' && type !== 'today') return false
    if (settings.schedule === 'longTerm' && type !== 'longTerm') return false
    if (settings.schedule === 'dated' && !due.dueDate) return false
    if (settings.schedule === 'undated' && due.dueDate) return false
    if (settings.schedule === 'overdue' && due.tone !== 'overdue') return false
    return true
  })

  const sorted = settings.sort === 'manual' ? filtered : filtered
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      if (settings.sort === 'unfinished') {
        const completionOrder = Number(a.item.completed) - Number(b.item.completed)
        if (completionOrder !== 0) return completionOrder
      }
      if (settings.sort === 'smart') {
        const order = taskSmartPriority(a.item.task as Task, a.item.completed, today, allTasks) -
          taskSmartPriority(b.item.task as Task, b.item.completed, today, allTasks)
        if (order !== 0) return order
      }
      if (settings.sort === 'updated') {
        const order = b.item.task.updatedAt.localeCompare(a.item.task.updatedAt)
        if (order !== 0) return order
      }
      if (settings.sort === 'created') {
        const order = b.item.task.createdAt.localeCompare(a.item.task.createdAt)
        if (order !== 0) return order
      }
      return a.index - b.index
    })
    .map(({ item }) => item)

  if (sorted.some((item) => !item.task.id)) return sorted

  // A parent is the visual group anchor. Children remain immediately below it
  // even when smart sorting changes the groups' order.
  const byParent = new Map<string, T[]>()
  for (const item of sorted) {
    if (!item.task.parentTaskId) continue
    const list = byParent.get(item.task.parentTaskId) ?? []
    list.push(item)
    byParent.set(item.task.parentTaskId, list)
  }
  const visibleIds = new Set(sorted.map((item) => item.task.id).filter(Boolean))
  const output: T[] = []
  const visited = new Set<string>()
  const append = (item: T) => {
    if (!item.task.id || visited.has(item.task.id)) return
    visited.add(item.task.id)
    output.push(item)
    for (const child of byParent.get(item.task.id) ?? []) append(child)
  }
  for (const item of sorted) {
    if (!item.task.parentTaskId || !visibleIds.has(item.task.parentTaskId)) append(item)
  }
  for (const item of sorted) append(item)
  return output
}

export function activeTaskViewSettingCount(settings: TaskViewSettings): number {
  return Number(settings.status !== 'all') +
    Number(settings.property !== 'all') +
    Number(settings.schedule !== 'all') +
    Number(settings.sort !== 'smart') +
    Number(!settings.showCompleted) +
    Number(settings.density !== 'standard')
}
