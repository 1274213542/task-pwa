import type Dexie from 'dexie'

/**
 * 备份与恢复（v4.2 §9）。
 * 只导出业务表；不导出 Dexie Cloud 内部表（$ 前缀/realms/members/roles）、
 * 草稿、localStorage、SW 缓存。导入在单事务内完成，失败自动回滚；
 * 导入行剥离云端归属字段（realmId/owner），由当前登录用户重建私有归属。
 */

export const BUSINESS_TABLES = [
  'tasks',
  'completionRecords',
  'categories',
  'calendarEvents',
  'shoppingItems',
  'shoppingLocations',
  'workRecords',
  'wageSettings',
  'expenseRecords',
  'expenseCategories',
  'syncedPreferences',
] as const

export interface BackupFile {
  formatVersion: 1
  schemaVersion: number
  exportedAt: string
  appVersion: string
  data: Record<string, Record<string, unknown>[]>
}

export async function exportBackup(db: Dexie, appVersion: string): Promise<string> {
  const data: BackupFile['data'] = {}
  for (const t of BUSINESS_TABLES) {
    data[t] = (await db.table(t).toArray()) as Record<string, unknown>[]
  }
  const file: BackupFile = {
    formatVersion: 1,
    schemaVersion: db.verno,
    exportedAt: new Date().toISOString(),
    appVersion,
    data,
  }
  return JSON.stringify(file, null, 1)
}

/** 结构校验：不合法直接抛错，绝不进入写入阶段 */
export function validateBackup(json: string, currentSchemaVersion: number): BackupFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('文件不是有效的 JSON')
  }
  const f = parsed as Partial<BackupFile>
  if (f.formatVersion !== 1) throw new Error('不支持的备份格式版本')
  if (typeof f.schemaVersion !== 'number') throw new Error('缺少 schemaVersion')
  if (f.schemaVersion > currentSchemaVersion)
    throw new Error(
      `备份来自更新的 App 版本（schema v${f.schemaVersion}），请先升级 App 再导入`,
    )
  if (!f.data || typeof f.data !== 'object') throw new Error('缺少 data 段')
  for (const t of BUSINESS_TABLES) {
    const rows = f.data[t]
    if (rows === undefined) continue // 旧备份允许缺表（只增演进）
    if (!Array.isArray(rows)) throw new Error(`表 ${t} 不是数组`)
    for (const r of rows) {
      if (typeof r !== 'object' || r === null || typeof (r as { id?: unknown }).id !== 'string') {
        throw new Error(`表 ${t} 中存在缺少 id 的记录`)
      }
    }
  }
  return f as BackupFile
}

/** 云端归属字段：导入时剥离，由当前用户重新建立（v4.2 §9） */
const CLOUD_OWNERSHIP_PROPS = ['realmId', 'owner'] as const

export async function importBackup(db: Dexie, json: string): Promise<void> {
  const file = validateBackup(json, db.verno)
  const tables = BUSINESS_TABLES.map((t) => db.table(t))
  // 单事务全有全无：任一行写入失败 → 整体回滚，现有数据不受影响
  await db.transaction('rw', tables, async () => {
    for (const t of BUSINESS_TABLES) {
      const rows = (file.data[t] ?? []).map((r) => {
        const clean: Record<string, unknown> = { ...r }
        for (const p of CLOUD_OWNERSHIP_PROPS) delete clean[p]
        return clean
      })
      await db.table(t).clear()
      if (rows.length > 0) await db.table(t).bulkAdd(rows)
    }
  })
}
