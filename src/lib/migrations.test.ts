import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureTaskScope } from './migrations'

const name = 'task-pwa-migration-test'
const v6Stores = {
  tasks: 'id, lifecycleStatus, [lifecycleStatus+rank], [id+currentSequence], categoryId',
  completionRecords: 'id, taskId, occurrenceDate, resolvedAt',
}

afterEach(async () => Dexie.delete(name))

describe('IndexedDB v6 → v7 数据迁移', () => {
  it('只补 daily 作用域，保留任务和完成记录', async () => {
    const oldDb = new Dexie(name)
    oldDb.version(6).stores(v6Stores)
    await oldDb.open()
    await oldDb.table('tasks').add({
      id: 'legacy-task',
      title: '旧任务',
      rank: 'a0',
      lifecycleStatus: 'active',
      templateVersion: 1,
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-01T00:00:00Z',
    })
    await oldDb.table('completionRecords').add({
      id: 'legacy-task:single',
      taskId: 'legacy-task',
      occurrenceDate: '2026-07-01',
      resolvedAt: '2026-07-01T10:00:00Z',
      resolution: 'completed',
    })
    oldDb.close()

    const newDb = new Dexie(name)
    newDb.version(6).stores(v6Stores)
    newDb
      .version(7)
      .stores({
        tasks:
          'id, lifecycleStatus, [lifecycleStatus+rank], [id+currentSequence], categoryId, taskScope',
      })
      .upgrade((tx) =>
        tx
          .table('tasks')
          .toCollection()
          .modify((task) => ensureTaskScope(task)),
      )
    await newDb.open()

    const task = await newDb.table('tasks').get('legacy-task')
    expect(task).toMatchObject({
      id: 'legacy-task',
      title: '旧任务',
      taskScope: 'daily',
    })
    expect(await newDb.table('completionRecords').get('legacy-task:single')).toMatchObject({
      taskId: 'legacy-task',
      resolution: 'completed',
    })
    newDb.close()
  })
})

describe('IndexedDB v7 → v8 财务扩展迁移', () => {
  it('保留旧日历事项并补 pending，新增表可直接写入', async () => {
    const oldDb = new Dexie(`${name}-v8`)
    oldDb.version(7).stores({
      calendarEvents: 'id, lifecycleStatus, startDate, endDate',
    })
    await oldDb.open()
    await oldDb.table('calendarEvents').add({
      id: 'event-1',
      title: '旧日程',
      startDate: '2026-07-18',
      endDate: '2026-07-18',
      lifecycleStatus: 'active',
    })
    oldDb.close()

    const upgraded = new Dexie(`${name}-v8`)
    upgraded.version(7).stores({
      calendarEvents: 'id, lifecycleStatus, startDate, endDate',
    })
    upgraded.version(8).stores({
      calendarEvents: 'id, lifecycleStatus, startDate, endDate, completionStatus',
      workRecords: 'id, lifecycleStatus, date, [lifecycleStatus+date]',
      wageSettings: 'id',
      expenseRecords: 'id, lifecycleStatus, date, categoryId, merchant, [lifecycleStatus+date]',
      expenseCategories: 'id, lifecycleStatus, rank',
    }).upgrade((tx) => tx.table('calendarEvents').toCollection().modify((event) => {
      if (!event.completionStatus) event.completionStatus = 'pending'
    }))
    await upgraded.open()

    expect(await upgraded.table('calendarEvents').get('event-1')).toMatchObject({
      title: '旧日程',
      completionStatus: 'pending',
    })
    await upgraded.table('workRecords').add({ id: 'work-1', date: '2026-07-18' })
    expect(await upgraded.table('workRecords').count()).toBe(1)
    upgraded.close()
    await Dexie.delete(`${name}-v8`)
  })
})
