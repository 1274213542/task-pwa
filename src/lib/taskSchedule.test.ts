import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db, type Task } from './db'
import {
  childProgress,
  effectiveTaskSchedule,
  isTaskExecutable,
  leafTaskIds,
  taskDueStatus,
} from './taskSchedule'
import {
  ensureTaskScheduleMigration,
  rollbackTaskScheduleMigration,
} from './taskScheduleMigration'
import { updateTask } from './tasks'

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

  it('counts only leaf tasks for parent progress and daily rate inputs', () => {
    const rows = [
      task('parent'),
      task('child-1', { parentTaskId: 'parent' }),
      task('child-2', { parentTaskId: 'parent' }),
    ]
    expect(leafTaskIds(rows)).toEqual(new Set(['child-1', 'child-2']))
    expect(childProgress('parent', rows, new Set(['child-1']))).toEqual({ completed: 1, total: 2 })
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
})
