import Dexie, { type EntityTable } from 'dexie'
import dexieCloud from 'dexie-cloud-addon'
import { DEXIE_CLOUD_URL, cloudEnabled } from '../config'
import type { Recurrence } from './recurrence'

/**
 * 数据模型见技术方案 v4.2 §8。
 * schema 冻结前（MS2 纵向切片验收通过前）允许破坏性调整，
 * 此期间云端只连可随时清空的开发数据库。
 */

export type LifecycleStatus = 'active' | 'deleted'
export type Resolution = 'completed' | 'skipped' | 'voided'

export interface Task {
  id: string
  title: string
  notes?: string
  categoryId?: string
  rank: string
  startDate?: string // PlainDate ISO
  endDate?: string // 周期任务的结束日；缺省 = 持续有效
  recurrence?: Recurrence
  currentSequence?: number // 仅 after_completion：当前活动实例序号（可推导缓存）
  nextDueDate?: string //     仅 after_completion：当前实例到期日（可推导缓存）
  lifecycleStatus: LifecycleStatus
  deletedAt?: string
  templateVersion: number
  createdAt: string
  updatedAt: string
}

export interface CompletionRecord {
  id: string // `${taskId}:${occurrenceKey}`，确定性主键（v4.2 §7.1）
  taskId: string
  occurrenceKey: string // 'single' | `fixed:${date}` | `ac:${seq}`
  occurrenceDate: string
  resolution: Resolution
  resolvedAt: string
  titleSnapshot: string
  templateVersion: number
  createdAt: string
  updatedAt: string
}

export interface SyncedPreferences {
  id: string // '#prefs'：官方私有单例模式（# 前缀 + put + db.on.ready）
  weekStartsOn: 1 | 0
  theme: 'system' | 'light' | 'dark'
  defaultCompletedDisplay: 'keep' | 'collapse' | 'hide'
  fullSwipeToComplete: boolean
  updatedAt: string
}

export const db = new Dexie('task-pwa', { addons: [dexieCloud] }) as Dexie & {
  tasks: EntityTable<Task, 'id'>
  completionRecords: EntityTable<CompletionRecord, 'id'>
  syncedPreferences: EntityTable<SyncedPreferences, 'id'>
}

db.version(2).stores({
  // IndexedDB 不可索引 undefined/null/boolean → 恒有值的 lifecycleStatus（v4.2 §8）
  tasks: 'id, lifecycleStatus, [lifecycleStatus+rank]',
  completionRecords: 'id, taskId, occurrenceDate, resolvedAt',
  syncedPreferences: 'id',
})

// v3：after_completion 条件事务所需的复合索引（v4.2 §7.3）。只加索引不迁数据。
db.version(3).stores({
  tasks: 'id, lifecycleStatus, [lifecycleStatus+rank], [id+currentSequence]',
})

if (cloudEnabled) {
  db.cloud.configure({
    databaseUrl: DEXIE_CLOUD_URL,
    // 零登录墙（比 v4.2 原定 requireAuth:true 更贴合"网络不是打开前提"）：
    // 未登录纯本地使用，设置页手动登录后 dexie-cloud 迁移本地数据并开始同步
    requireAuth: false,
  })
}

// 私有单例初始化：官方模式 —— db.on.ready + put，仅缺失时写入
db.on('ready', async () => {
  const existing = await db.syncedPreferences.get('#prefs')
  if (!existing) {
    await db.syncedPreferences.put({
      id: '#prefs',
      weekStartsOn: 1,
      theme: 'system',
      defaultCompletedDisplay: 'keep',
      fullSwipeToComplete: false,
      updatedAt: new Date().toISOString(),
    })
  }
})
