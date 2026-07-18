import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { BUSINESS_TABLES, exportBackup, importBackup, validateBackup } from './backup'

/** 与生产同名的业务表（备份逻辑只依赖表名与 id 主键） */
function makeDb(name: string): Dexie {
  const d = new Dexie(name)
  d.version(8).stores(Object.fromEntries(BUSINESS_TABLES.map((t) => [t, 'id'])))
  return d
}

let db: Dexie
beforeEach(async () => {
  await Dexie.delete('t-backup')
  db = makeDb('t-backup')
  await db.table('tasks').bulkAdd([
    { id: 't1', title: '买牛奶', lifecycleStatus: 'active', realmId: 'rlm-x', owner: 'u1' },
    { id: 't2', title: '写周报', lifecycleStatus: 'deleted' },
  ])
  await db.table('completionRecords').add({
    id: 't1:single',
    taskId: 't1',
    resolution: 'completed',
    titleSnapshot: '买牛奶',
  })
  await db.table('shoppingLocations').add({ id: 'l1', name: '业务超市', type: 'physical' })
  await db.table('syncedPreferences').add({ id: '#prefs', weekStartsOn: 1 })
})

describe('导出', () => {
  it('信封字段完整，含全部业务表', async () => {
    const file = JSON.parse(await exportBackup(db, 'test · 2026-07-16'))
    expect(file.formatVersion).toBe(1)
    expect(file.schemaVersion).toBe(8)
    expect(file.appVersion).toBe('test · 2026-07-16')
    expect(typeof file.exportedAt).toBe('string')
    for (const t of BUSINESS_TABLES) expect(Array.isArray(file.data[t])).toBe(true)
    expect(file.data.tasks).toHaveLength(2) // 软删行也入备份（全量）
  })
})

describe('恢复演练（MS8 验收：导出 → 清空 → 导入 → 完整恢复）', () => {
  it('round-trip 完整恢复，云端归属字段被剥离', async () => {
    const json = await exportBackup(db, 'v')
    for (const t of BUSINESS_TABLES) await db.table(t).clear()
    expect(await db.table('tasks').count()).toBe(0)

    await importBackup(db, json)

    expect(await db.table('tasks').count()).toBe(2)
    const t1 = await db.table('tasks').get('t1')
    expect(t1.title).toBe('买牛奶')
    expect(t1.realmId).toBeUndefined() // 由当前用户重建归属
    expect(t1.owner).toBeUndefined()
    expect((await db.table('completionRecords').get('t1:single')).titleSnapshot).toBe('买牛奶')
    expect((await db.table('syncedPreferences').get('#prefs')).weekStartsOn).toBe(1)
  })

  it('导入覆盖现有数据（清空后写入备份内容）', async () => {
    const json = await exportBackup(db, 'v')
    await db.table('tasks').add({ id: 't3', title: '导入后不应存在' })
    await importBackup(db, json)
    expect(await db.table('tasks').get('t3')).toBeUndefined()
    expect(await db.table('tasks').count()).toBe(2)
  })
})

describe('校验与回滚', () => {
  it('非 JSON / 错误格式版本 / 更高 schema 拒绝', async () => {
    expect(() => validateBackup('not json', 6)).toThrow('JSON')
    expect(() => validateBackup('{"formatVersion":2}', 6)).toThrow('格式版本')
    expect(() =>
      validateBackup('{"formatVersion":1,"schemaVersion":99,"data":{}}', 6),
    ).toThrow('升级')
  })

  it('缺 id 的记录拒绝，不触碰数据库', async () => {
    const bad = JSON.stringify({
      formatVersion: 1,
      schemaVersion: 6,
      exportedAt: '',
      appVersion: '',
      data: { tasks: [{ title: '没有 id' }] },
    })
    await expect(importBackup(db, bad)).rejects.toThrow('缺少 id')
    expect(await db.table('tasks').count()).toBe(2) // 原数据完好
  })

  it('写入中途失败 → 事务回滚，现有数据不丢（导入失败不覆盖现有库）', async () => {
    // id 重复触发 bulkAdd 约束错误 → 整个事务中止
    const dup = JSON.stringify({
      formatVersion: 1,
      schemaVersion: 6,
      exportedAt: '',
      appVersion: '',
      data: { tasks: [{ id: 'x', title: 'a' }, { id: 'x', title: 'b' }] },
    })
    await expect(importBackup(db, dup)).rejects.toThrow()
    expect(await db.table('tasks').count()).toBe(2) // 回滚：原两条仍在
    expect((await db.table('tasks').get('t1')).title).toBe('买牛奶')
  })

  it('旧备份缺表允许（只增演进），已有表被清空为备份状态', async () => {
    const partial = JSON.stringify({
      formatVersion: 1,
      schemaVersion: 5,
      exportedAt: '',
      appVersion: '',
      data: { tasks: [{ id: 'only', title: '唯一' }] },
    })
    await importBackup(db, partial)
    expect(await db.table('tasks').count()).toBe(1)
    expect(await db.table('shoppingLocations').count()).toBe(0)
  })
})
