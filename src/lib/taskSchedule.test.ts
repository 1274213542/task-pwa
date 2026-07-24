import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db, type Task } from './db'
import {
  explicitTaskDueAt,
  childProgress,
  descendantTaskIds,
  effectiveTaskSchedule,
  isTaskExecutable,
  leafTaskIds,
  taskDueStatus,
} from './taskSchedule'
import {
  ensureTaskScheduleMigration,
  rollbackTaskScheduleMigration,
} from './taskScheduleMigration'
import {
  completeDailyTask,
  addTaskBatch,
  deleteTaskPlan,
  migrateDailyCompletionHistory,
  pruneDailyCompletionHistory,
  softDeleteTask,
  saveTaskPlan,
  updateTask,
  voidRecord,
} from './tasks'

const timestamp = '2026-07-19T00:00:00.000Z'

function task(id: string, fields: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    rank: id,
    lifecycleStatus: 'active',
    templateVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...fields,
  }
}

beforeEach(async () => {
  await db.open()
  await db.tasks.clear()
  await db.completionRecords.clear()
  await db.taskScheduleMigrations.clear()
})

afterAll(async () => {
  await db.tasks.clear()
  await db.taskScheduleMigrations.clear()
  db.close()
})

describe('task schedules and DDL', () => {
  it('uses civil dates, including today, tomorrow and overdue across clock times', () => {
    expect(taskDueStatus(task('today', { scheduleType: 'today', dueAt: '2026-07-19T00:01' }), '2026-07-19').label).toBe('今天截止')
    expect(taskDueStatus(task('tomorrow', { scheduleType: 'longTerm', dueAt: '2026-07-20T23:59' }), '2026-07-19').label).toBe('明天截止')
    expect(taskDueStatus(task('late', { scheduleType: 'longTerm', dueAt: '2026-07-17T23:59' }), '2026-07-19').label).toBe('已逾期 2 天')
  })

  it('distinguishes an authored DDL from the synthetic date of an ordinary today task', () => {
    const ordinary = task('ordinary', { scheduleType: 'today', startAt: '2026-07-21' })
    const deadline = task('deadline', { scheduleType: 'today', startAt: '2026-07-21', dueAt: '2026-07-21T18:00' })
    const longTerm = task('long-term', { scheduleType: 'longTerm', startAt: '2026-07-21', endDate: '2026-07-31' })
    expect(explicitTaskDueAt(ordinary)).toBeUndefined()
    expect(explicitTaskDueAt(deadline)).toBe('2026-07-21T18:00')
    expect(explicitTaskDueAt(longTerm)).toBe('2026-07-31')
  })

  it('surfaces a long-term task at its start or within its configured due window', () => {
    const hidden = task('hidden', {
      scheduleType: 'longTerm',
      startAt: '2026-07-25',
      dueAt: '2026-08-01',
      surfaceDaysBeforeDue: 3,
    })
    expect(isTaskExecutable(hidden, '2026-07-19')).toBe(false)
    expect(isTaskExecutable(hidden, '2026-07-29')).toBe(true)
    expect(isTaskExecutable(hidden, '2026-07-25')).toBe(true)
  })

  it('inherits parent dates until a child explicitly overrides them', () => {
    const parent = task('parent', { scheduleType: 'longTerm', startAt: '2026-07-20', dueAt: '2026-07-31' })
    const inherited = task('child-a', { parentTaskId: parent.id, inheritsParentSchedule: true })
    const override = task('child-b', {
      parentTaskId: parent.id,
      inheritsParentSchedule: false,
      scheduleType: 'today',
      startAt: '2026-07-22',
      dueAt: '2026-07-22T18:00',
    })
    expect(effectiveTaskSchedule(inherited, [parent, inherited]).dueAt).toBe('2026-07-31')
    expect(effectiveTaskSchedule(override, [parent, override]).dueAt).toBe('2026-07-22T18:00')
  })

  it('keeps missing legacy inheritance flags compatible', () => {
    const parent = task('legacy-parent', { scheduleType: 'longTerm', startAt: '2026-08-01', dueAt: '2026-08-10' })
    const child = task('legacy-child', { parentTaskId: parent.id })
    expect(effectiveTaskSchedule(child, [parent, child])).toMatchObject({
      startAt: '2026-08-01',
      dueAt: '2026-08-10',
      inheritedFrom: parent.id,
    })
  })

  it('counts only leaf tasks for parent progress and daily rate inputs', () => {
    const rows = [
      task('parent'),
      task('child-1', { parentTaskId: 'parent' }),
      task('child-2', { parentTaskId: 'parent' }),
    ]
    expect(leafTaskIds(rows)).toEqual(new Set(['child-1', 'child-2']))
    expect(childProgress('parent', rows, new Set(['child-1']))).toEqual({ completed: 1, total: 2 })
  })

  it('treats an organizational plan as a non-completable group', () => {
    const rows = [
      task('plan', { nodeRole: 'plan' }),
      task('step-1', { parentTaskId: 'plan' }),
      task('step-2', { parentTaskId: 'plan' }),
    ]
    expect(leafTaskIds(rows)).toEqual(new Set(['step-1', 'step-2']))
    expect(childProgress('plan', rows, new Set(['step-2']))).toEqual({ completed: 1, total: 2 })
    expect(descendantTaskIds('plan', rows)).toEqual(new Set(['step-1', 'step-2']))
  })

  it('keeps timeline steps out of checklist progress and completion-rate leaves', () => {
    const rows = [
      task('plan', { nodeRole: 'plan' }),
      task('check', { parentTaskId: 'plan', childKind: 'checklist' }),
      task('timed', { parentTaskId: 'plan', childKind: 'timeline', startAt: '2026-07-22T08:00' }),
    ]
    expect(leafTaskIds(rows)).toEqual(new Set(['check']))
    expect(childProgress('plan', rows, new Set(['timed']))).toEqual({ completed: 0, total: 1 })
  })

  it('creates a plan and differently timed steps atomically', async () => {
    const result = await addTaskBatch({
      value: '8.00 起床\n检查护照\n09:00 公交',
      startDate: '2026-07-22',
      newPlanTitle: '回国',
      schedule: { scheduleType: 'today', startAt: '2026-07-22' },
    })
    expect(result).toMatchObject({ created: 3, failures: [] })
    const rows = (await db.tasks.toArray()).sort((a, b) => a.rank.localeCompare(b.rank))
    const plan = rows.find((row) => row.nodeRole === 'plan')
    expect(plan?.title).toBe('回国')
    expect(rows.filter((row) => row.parentTaskId === plan?.id).map((row) => [row.title, row.startAt, row.childKind])).toEqual([
      ['起床', '2026-07-22T08:00', 'timeline'],
      ['检查护照', '2026-07-22', 'checklist'],
      ['公交', '2026-07-22T09:00', 'timeline'],
    ])

    const failed = await addTaskBatch({ value: '25:00 不应写入', startDate: '2026-07-22' })
    expect(failed.created).toBe(0)
    expect(await db.tasks.count()).toBe(4)
  })

  it('creates, renames and safely removes a plan without destroying its contents', async () => {
    const planId = await saveTaskPlan({ title: '回国', startDate: '2026-07-22' })
    await saveTaskPlan({ id: planId, title: '回国准备' })
    const child = task('kept-child', {
      parentTaskId: planId,
      childKind: 'timeline',
      scheduleType: 'today',
      startAt: '2026-07-22T08:00',
    })
    await db.tasks.add(child)
    await deleteTaskPlan(planId, 'detach')
    expect(await db.tasks.get(planId)).toMatchObject({ title: '回国准备', lifecycleStatus: 'deleted' })
    const detached = await db.tasks.get(child.id)
    expect(detached).toMatchObject({ lifecycleStatus: 'active', startAt: '2026-07-22T08:00' })
    expect(detached?.parentTaskId).toBeUndefined()
    expect(detached?.childKind).toBeUndefined()
  })

  it('materializes inherited dates before deleting a parent', async () => {
    const parent = task('delete-parent', {
      scheduleType: 'longTerm',
      startAt: '2026-08-01',
      dueAt: '2026-08-12',
    })
    const child = task('delete-child', {
      parentTaskId: parent.id,
      inheritsParentSchedule: true,
    })
    await db.tasks.bulkAdd([parent, child])
    await softDeleteTask(parent.id)
    const detached = await db.tasks.get(child.id)
    expect(detached?.parentTaskId).toBeUndefined()
    expect(detached).toMatchObject({
      inheritsParentSchedule: false,
      scheduleType: 'longTerm',
      startAt: '2026-08-01',
      dueAt: '2026-08-12',
    })
  })

  it('migrates legacy rows idempotently and can restore the original snapshot', async () => {
    const legacy = task('legacy', { startDate: '2026-07-19' })
    await db.tasks.add(legacy)
    expect(await ensureTaskScheduleMigration(db)).toBe(1)
    expect(await ensureTaskScheduleMigration(db)).toBe(0)
    expect(await db.tasks.get(legacy.id)).toMatchObject({
      scheduleType: 'today',
      startAt: '2026-07-19',
    })
    expect(await rollbackTaskScheduleMigration(db)).toBe(1)
    expect((await db.tasks.get(legacy.id))?.scheduleType).toBeUndefined()
  })

  it('requires an explicit atomic parent extension when a child due date exceeds it', async () => {
    const parent = task('parent', {
      title: '父任务',
      scheduleType: 'longTerm',
      startDate: '2026-07-20',
      startAt: '2026-07-20',
      dueAt: '2026-07-31T18:00',
    })
    const child = task('child', {
      title: '子任务',
      parentTaskId: parent.id,
      inheritsParentSchedule: true,
      startDate: '2026-07-20',
    })
    await db.tasks.bulkAdd([parent, child])

    const update = {
      title: child.title,
      startDate: '2026-07-20',
      scheduleType: 'longTerm' as const,
      startAt: '2026-07-20',
      dueAt: '2026-08-02T18:00',
      parentTaskId: parent.id,
      inheritsParentSchedule: false,
    }
    await expect(updateTask(child.id, update)).rejects.toThrow('晚于父任务')
    expect((await db.tasks.get(parent.id))?.dueAt).toBe('2026-07-31T18:00')

    await updateTask(child.id, { ...update, extendParentDue: true })
    expect((await db.tasks.get(parent.id))?.dueAt).toBe('2026-08-02T18:00')
    expect((await db.tasks.get(child.id))?.dueAt).toBe('2026-08-02T18:00')
  })

  it('migrates daily history to deterministic ids without deleting completed source records', async () => {
    const daily = task('daily-history', { taskScope: 'daily', completedAt: timestamp })
    await db.tasks.add(daily)
    await db.completionRecords.put({
      id: `${daily.id}:single`,
      taskId: daily.id,
      occurrenceKey: 'single',
      occurrenceDate: '2026-07-14',
      completedDate: '2026-07-14',
      resolution: 'completed',
      resolvedAt: timestamp,
      titleSnapshot: daily.title,
      templateVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    await migrateDailyCompletionHistory([daily])
    expect(await db.completionRecords.get(`${daily.id}:daily:2026-07-14`)).toMatchObject({
      resolution: 'completed',
      occurrenceDate: '2026-07-14',
    })
    expect(await db.completionRecords.get(`${daily.id}:single`)).toMatchObject({ resolution: 'voided' })

    await completeDailyTask(daily, '2026-07-21')
    await completeDailyTask(daily, '2026-07-21')
    expect(await db.completionRecords.where('taskId').equals(daily.id).filter((record) => record.id === `${daily.id}:daily:2026-07-21`).count()).toBe(1)
    await voidRecord(`${daily.id}:daily:2026-07-21`)
    await completeDailyTask(daily, '2026-07-21')
    expect(await db.completionRecords.get(`${daily.id}:daily:2026-07-21`)).toMatchObject({ resolution: 'completed' })

    await pruneDailyCompletionHistory([daily], '2026-07-15')
    expect(await db.completionRecords.get(`${daily.id}:daily:2026-07-14`)).toBeDefined()
    expect(await db.completionRecords.get(`${daily.id}:daily:2026-07-21`)).toBeDefined()
  })
})
