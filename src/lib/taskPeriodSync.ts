import type { CompletionRecord, Task, TaskScope } from './db'
import { db } from './db'
import { checkAfterCompletionIntegrity } from './integrity'
import { periodAnchorISO, taskScopeOf } from './taskPeriods'

export interface TaskPeriodSyncPlan {
  templateCount: number
  repairs: Array<{
    id: string
    changes: Partial<Pick<Task, 'taskScope' | 'startDate' | 'currentSequence' | 'nextDueDate'>>
  }>
  conflicts: string[]
}

/**
 * Fixed occurrences are deterministic projections, not copied task rows.
 * Synchronisation therefore repairs legacy template/cache gaps and validates
 * that the current period can be projected without touching completion data.
 */
export function planTaskPeriodSync(
  tasks: Task[],
  records: CompletionRecord[],
  scope: TaskScope,
  dateISO: string,
): TaskPeriodSyncPlan {
  const recurring = tasks.filter((task) =>
    task.lifecycleStatus === 'active' &&
    Boolean(task.recurrence) &&
    taskScopeOf(task) === scope,
  )
  const repairs: TaskPeriodSyncPlan['repairs'] = []
  const conflicts: string[] = []

  for (const task of recurring) {
    const changes: TaskPeriodSyncPlan['repairs'][number]['changes'] = {}
    if (!task.taskScope) changes.taskScope = 'daily'
    if (!task.startDate) changes.startDate = periodAnchorISO(scope, dateISO)

    if (task.recurrence?.mode === 'after_completion') {
      const taskRecords = records.filter((record) => record.taskId === task.id)
      const integrity = checkAfterCompletionIntegrity(
        task.startDate ? task : { ...task, startDate: changes.startDate },
        taskRecords,
      )
      if (integrity.status === 'cache_mismatch') {
        changes.currentSequence = integrity.expectedSequence
        changes.nextDueDate = integrity.expectedNextDueDate
      } else if (integrity.status === 'conflict') {
        conflicts.push(`${task.title}：${integrity.reason}`)
      }
    }

    if (Object.keys(changes).length > 0) repairs.push({ id: task.id, changes })
  }

  return { templateCount: recurring.length, repairs, conflicts }
}

export async function synchronizeTaskPeriod(
  scope: TaskScope,
  dateISO: string,
): Promise<TaskPeriodSyncPlan> {
  const [tasks, records] = await Promise.all([
    db.tasks.toArray(),
    db.completionRecords.toArray(),
  ])
  const plan = planTaskPeriodSync(tasks, records, scope, dateISO)
  if (plan.conflicts.length > 0) {
    throw new Error(`有 ${plan.conflicts.length} 个周期任务需要确认：${plan.conflicts[0]}`)
  }
  if (plan.repairs.length === 0) return plan

  const updatedAt = new Date().toISOString()
  await db.transaction('rw', db.tasks, async () => {
    for (const repair of plan.repairs) {
      await db.tasks.update(repair.id, { ...repair.changes, updatedAt })
    }
  })
  return plan
}
