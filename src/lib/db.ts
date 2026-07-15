import Dexie, { type EntityTable } from 'dexie'

/**
 * 数据模型见技术方案 v4.2 §8。
 * MS1 只落 tasks 与 completionRecords 两张表；schema 冻结前（MS2 纵向切片
 * 验收通过前）允许破坏性调整，此期间不接入正式 Dexie Cloud 数据库。
 */

export type LifecycleStatus = 'active' | 'deleted'
export type Resolution = 'completed' | 'skipped' | 'voided'

export interface Task {
  id: string
  title: string
  notes?: string
  categoryId?: string
  rank: string
  startDate?: string // PlainDate ISO，MS1 暂不做日期筛选
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

export const db = new Dexie('task-pwa') as Dexie & {
  tasks: EntityTable<Task, 'id'>
  completionRecords: EntityTable<CompletionRecord, 'id'>
}

db.version(1).stores({
  // IndexedDB 不可索引 undefined/null/boolean → 用恒有值的 lifecycleStatus（v4.2 §8）
  tasks: 'id, lifecycleStatus, [lifecycleStatus+rank]',
  completionRecords: 'id, taskId, occurrenceDate, resolvedAt',
})
