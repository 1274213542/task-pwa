import type { Task } from './db'

export type TaskStatusFilter = 'all' | 'pending' | 'completed'
export type TaskPropertyFilter = 'all' | 'single' | 'recurring'
export type TaskSortMode = 'manual' | 'updated' | 'created' | 'unfinished'
export type TaskListDensity = 'standard' | 'compact'

export interface TaskViewSettings {
  status: TaskStatusFilter
  property: TaskPropertyFilter
  sort: TaskSortMode
  showCompleted: boolean
  density: TaskListDensity
}

export const DEFAULT_TASK_VIEW_SETTINGS: TaskViewSettings = {
  status: 'all',
  property: 'all',
  sort: 'manual',
  showCompleted: true,
  density: 'standard',
}

export interface TaskViewCandidate {
  task: Pick<Task, 'recurrence' | 'createdAt' | 'updatedAt'>
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
      sort: ['manual', 'updated', 'created', 'unfinished'].includes(value.sort ?? '')
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
  const filtered = items.filter((item) => {
    if (settings.status === 'pending' && item.completed) return false
    if (settings.status === 'completed' && !item.completed) return false
    if (!settings.showCompleted && settings.status !== 'completed' && item.completed) return false
    const recurring = Boolean(item.task.recurrence)
    if (settings.property === 'single' && recurring) return false
    if (settings.property === 'recurring' && !recurring) return false
    return true
  })

  if (settings.sort === 'manual') return filtered

  return filtered
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      if (settings.sort === 'unfinished') {
        const completionOrder = Number(a.item.completed) - Number(b.item.completed)
        if (completionOrder !== 0) return completionOrder
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
}

export function activeTaskViewSettingCount(settings: TaskViewSettings): number {
  return Number(settings.status !== 'all') +
    Number(settings.property !== 'all') +
    Number(settings.sort !== 'manual') +
    Number(!settings.showCompleted) +
    Number(settings.density !== 'standard')
}
