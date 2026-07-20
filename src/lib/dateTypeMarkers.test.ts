import 'fake-indexeddb/auto'
import type Dexie from 'dexie'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ db: undefined as unknown }))

vi.mock('./db', async () => {
  const { default: Dexie } = await import('dexie')
  const db = new Dexie('task-pwa-date-marker-test')
  db.version(1).stores({
    dateTypeDefinitions: 'id, lifecycleStatus, rank',
    dateTypeMarkers: 'id, lifecycleStatus, date, typeId, [date+typeId]',
  })
  state.db = db
  return { db }
})

let markers: typeof import('./dateTypeMarkers')

beforeAll(async () => {
  markers = await import('./dateTypeMarkers')
  await (state.db as Dexie).open()
})

beforeEach(async () => {
  const db = state.db as Dexie
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })
})

afterAll(async () => {
  const db = state.db as Dexie
  db.close()
  await db.delete()
})

describe('月历日期类型标记', () => {
  it('批量写入使用稳定键，重复保存不会产生重复标记', async () => {
    const db = state.db as Dexie
    const typeId = await markers.saveDateTypeDefinition({ name: '上班', colorToken: 'blue' })
    await markers.applyDateTypeMarkers(['2026-07-21', '2026-07-22'], typeId)
    await markers.applyDateTypeMarkers(['2026-07-21'], typeId)

    expect(await db.table('dateTypeMarkers').count()).toBe(2)
    expect(await db.table('dateTypeMarkers').get(`2026-07-21:${typeId}`)).toMatchObject({
      date: '2026-07-21',
      typeId,
      lifecycleStatus: 'active',
    })
  })

  it('清除标记保留同步墓碑并可再次恢复原键', async () => {
    const db = state.db as Dexie
    const typeId = await markers.saveDateTypeDefinition({ name: '上学', colorToken: 'green' })
    const id = `2026-07-23:${typeId}`
    await markers.applyDateTypeMarkers(['2026-07-23'], typeId)
    await markers.clearDateTypeMarkers(['2026-07-23'], typeId)
    expect(await db.table('dateTypeMarkers').get(id)).toMatchObject({ lifecycleStatus: 'deleted' })

    await markers.applyDateTypeMarkers(['2026-07-23'], typeId)
    const restored = await db.table('dateTypeMarkers').get(id)
    expect(restored).toMatchObject({ lifecycleStatus: 'active' })
    expect(restored?.deletedAt).toBeUndefined()
  })
})
