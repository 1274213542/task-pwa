import type Dexie from 'dexie'
import type { Task, TaskScheduleMigrationState } from './db'
import { legacyTaskSchedulePatch } from './taskSchedule'

const MIGRATION_ID = '#task-schedule-v12' as const

export async function ensureTaskScheduleMigration(db: Dexie): Promise<number> {
  const tasks = (await db.table('tasks').toArray()) as Task[]
  const missing = tasks.filter((task) => !task.scheduleType)
  const table = db.table('taskScheduleMigrations')
  const existing = await table.get(MIGRATION_ID) as TaskScheduleMigrationState | undefined
  if (missing.length === 0) {
    if (!existing) {
      const timestamp = new Date().toISOString()
      await table.put({
        id: MIGRATION_ID,
        version: 12,
        status: 'complete',
        backup: [],
        createdAt: timestamp,
        completedAt: timestamp,
      } satisfies TaskScheduleMigrationState)
    }
    return 0
  }

  const backedUpIds = new Set(existing?.backup.map((task) => task.id) ?? [])
  const backup = [
    ...(existing?.backup ?? []),
    ...missing.filter((task) => !backedUpIds.has(task.id)),
  ]
  const startedAt = existing?.createdAt ?? new Date().toISOString()

  await db.transaction('rw', [db.table('tasks'), table], async () => {
    await table.put({
      id: MIGRATION_ID,
      version: 12,
      status: 'pending',
      backup,
      createdAt: startedAt,
    } satisfies TaskScheduleMigrationState)
    const updatedAt = new Date().toISOString()
    for (const task of missing) {
      await db.table('tasks').update(task.id, {
        ...legacyTaskSchedulePatch(task),
        updatedAt,
      })
    }
    await table.put({
      id: MIGRATION_ID,
      version: 12,
      status: 'complete',
      backup,
      createdAt: startedAt,
      completedAt: new Date().toISOString(),
    } satisfies TaskScheduleMigrationState)
  })
  return missing.length
}

export async function rollbackTaskScheduleMigration(db: Dexie): Promise<number> {
  const table = db.table('taskScheduleMigrations')
  const state = await table.get(MIGRATION_ID) as TaskScheduleMigrationState | undefined
  if (!state || state.backup.length === 0) return 0
  await db.transaction('rw', [db.table('tasks'), table], async () => {
    await db.table('tasks').bulkPut(state.backup)
    await table.put({
      ...state,
      status: 'rolled-back',
      rolledBackAt: new Date().toISOString(),
    } satisfies TaskScheduleMigrationState)
  })
  return state.backup.length
}
