import Dexie, { type EntityTable } from 'dexie'
import dexieCloud from 'dexie-cloud-addon'
import { DEXIE_CLOUD_URL, cloudEnabled } from '../config'
import type { Recurrence } from './recurrence'
import { ensureTaskScope } from './migrations'

/**
 * 数据模型见技术方案 v4.2 §8。
 * schema 冻结前（MS2 纵向切片验收通过前）允许破坏性调整，
 * 此期间云端只连可随时清空的开发数据库。
 */

export type LifecycleStatus = 'active' | 'deleted'
export type Resolution = 'completed' | 'skipped' | 'voided'
export type TaskScope = 'daily' | 'weekly'
export type MarkerSymbol = 'dot' | 'flower' | 'star' | 'diamond' | 'spark' | 'squircle'
export type UIThemeId = 'violet-lime' | 'aqua-garden' | 'mono-green' | 'soft-mix'

export interface Task {
  id: string
  title: string
  notes?: string
  categoryId?: string
  rank: string
  startDate?: string // PlainDate ISO
  endDate?: string // 周期任务的结束日；缺省 = 持续有效
  taskScope?: TaskScope // v7：旧记录缺省按 daily 读取，迁移时补齐
  visualToken?: ColorToken // 可选视觉覆盖；缺省继承分类或当前主题
  markerSymbol?: MarkerSymbol
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
  resolvedAt: string // Instant（UTC 时刻）
  completedDate?: string // 实际完成的本地民用日期（after_completion 推进基准，v4.2 §8.1）
  titleSnapshot: string
  categoryIdSnapshot?: string // 完成当时的分类（分类删除后历史仍可读，v4.2 §6）
  categoryNameSnapshot?: string
  templateVersion: number
  createdAt: string
  updatedAt: string
}

export type ColorToken =
  | 'gray'
  | 'blue'
  | 'green'
  | 'orange'
  | 'pink'
  | 'purple'

export interface Category {
  id: string
  name: string
  colorToken: ColorToken
  markerSymbol?: MarkerSymbol // 旧分类缺省使用 dot
  rank: string
  lifecycleStatus: LifecycleStatus
  deletedAt?: string
  createdAt: string
  updatedAt: string
}

export interface CalendarEvent {
  id: string
  title: string
  notes?: string
  allDay: boolean
  startDate: string // PlainDate
  endDate: string // 必填；单日 = startDate（IndexedDB 复合索引不容缺失，v4.2 §8）
  startAt?: string // Instant，非全天时使用
  endAt?: string
  timezone?: string // IANA，定时事件记录创建时的时区
  categoryId?: string
  visualToken?: ColorToken
  markerSymbol?: MarkerSymbol
  lifecycleStatus: LifecycleStatus
  deletedAt?: string
  createdAt: string
  updatedAt: string
}

export type PurchaseStatus = 'pending' | 'purchased'

export interface ShoppingLocation {
  id: string
  name: string
  type: 'physical' | 'online' // 购买渠道由 type 表达，具体地点/网站即记录本身（v4.2 §8.1）
  address?: string
  url?: string
  note?: string
  rank: string
  lifecycleStatus: LifecycleStatus
  deletedAt?: string
  createdAt: string
  updatedAt: string
}

export interface ShoppingItem {
  id: string
  name: string
  quantity?: number // 数量/单位/备注分离（v4.2 §9 修正，不合并 qtyNote）
  unit?: string
  note?: string
  locationId?: string
  locationNameSnapshot?: string // 购买时快照：地点删除后历史仍可读
  rank: string
  purchaseStatus: PurchaseStatus // 恒有值（IndexedDB 不可索引 undefined）
  purchasedAt?: string // Instant；有值 ⇔ purchased（同事务一致）
  lifecycleStatus: LifecycleStatus
  deletedAt?: string
  createdAt: string
  updatedAt: string
}

export interface SyncedPreferences {
  id: string // '#prefs'：官方私有单例模式（# 前缀 + put + db.on.ready）
  weekStartsOn: 1 | 0
  theme: 'system' | 'light' | 'dark'
  uiTheme?: UIThemeId // 旧数据缺省使用 violet-lime
  actionColor?: ColorToken // 可选主操作按钮颜色；缺省使用主题深色
  defaultCompletedDisplay: 'keep' | 'collapse' | 'hide'
  fullSwipeToComplete: boolean
  updatedAt: string
}

export const db = new Dexie('task-pwa', { addons: [dexieCloud] }) as Dexie & {
  tasks: EntityTable<Task, 'id'>
  completionRecords: EntityTable<CompletionRecord, 'id'>
  syncedPreferences: EntityTable<SyncedPreferences, 'id'>
  categories: EntityTable<Category, 'id'>
  calendarEvents: EntityTable<CalendarEvent, 'id'>
  shoppingItems: EntityTable<ShoppingItem, 'id'>
  shoppingLocations: EntityTable<ShoppingLocation, 'id'>
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

// v4：分类表 + 任务按分类索引。只增不改，无数据迁移。
db.version(4).stores({
  tasks:
    'id, lifecycleStatus, [lifecycleStatus+rank], [id+currentSequence], categoryId',
  categories: 'id, lifecycleStatus',
})

// v5：日历事项表（无 recurrence——周期语义只在 Task，v4.2 §8.1）
db.version(5).stores({
  calendarEvents: 'id, lifecycleStatus, startDate, endDate',
})

// v6：购物清单与购买地点
db.version(6).stores({
  shoppingItems: 'id, lifecycleStatus, purchaseStatus, locationId, purchasedAt',
  shoppingLocations: 'id, lifecycleStatus',
})

// v7：每日 / 每周任务作用域。仅补字段与索引，原任务、完成记录及 ID 全部保留。
db.version(7)
  .stores({
    tasks:
      'id, lifecycleStatus, [lifecycleStatus+rank], [id+currentSequence], categoryId, taskScope',
  })
  .upgrade(async (tx) => {
    await tx
      .table('tasks')
      .toCollection()
      .modify((task: Task) => {
        ensureTaskScope(task)
      })
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
      uiTheme: 'violet-lime',
      defaultCompletedDisplay: 'keep',
      fullSwipeToComplete: false,
      updatedAt: new Date().toISOString(),
    })
  } else if (!existing.uiTheme) {
    await db.syncedPreferences.update('#prefs', {
      uiTheme: 'violet-lime',
      updatedAt: new Date().toISOString(),
    })
  }
})
