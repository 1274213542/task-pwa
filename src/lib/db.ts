import Dexie, { type EntityTable } from 'dexie'
import dexieCloud from 'dexie-cloud-addon'
import { DEXIE_CLOUD_URL, cloudEnabled, financeLedgerV2Enabled } from '../config'
import type { Recurrence } from './recurrence'
import { ensureTaskScope } from './migrations'
import type {
  Account,
  CreditCardSettlement,
  ExchangeRate,
  FinanceMigrationState,
  FinanceTransaction,
  FinanceTransfer,
  Merchant,
  Paycheck,
  RecurringTransactionInstance,
  RecurringTransactionRule,
  WorkEntry,
  WorkTemplate,
} from './ledgerTypes'
import { migrateLegacyFinanceData } from './financeMigration'
import { ensureFinanceOwnershipMigration } from './financeOwnershipMigration'
import { ensureTaskScheduleMigration } from './taskScheduleMigration'

/**
 * 数据模型见技术方案 v4.2 §8。
 * schema 冻结前（MS2 纵向切片验收通过前）允许破坏性调整，
 * 此期间云端只连可随时清空的开发数据库。
 */

export type LifecycleStatus = 'active' | 'deleted'
export type Resolution = 'completed' | 'skipped' | 'voided'
export type TaskScope = 'daily' | 'weekly'
export type TaskScheduleType = 'today' | 'longTerm' | 'unscheduled'
export type TaskNodeRole = 'task' | 'plan'
export type MarkerSymbol = 'dot' | 'flower' | 'star' | 'diamond' | 'spark' | 'squircle'
export type UIThemeId = 'violet-lime' | 'aqua-garden' | 'mono-green' | 'soft-mix'

export interface Task {
  id: string
  title: string
  /** Missing on legacy rows and therefore read as an executable task. */
  nodeRole?: TaskNodeRole
  notes?: string
  categoryId?: string
  rank: string
  startDate?: string // PlainDate ISO
  endDate?: string // 周期任务的结束日；缺省 = 持续有效
  /**
   * 排期使用设备本地民用时间：YYYY-MM-DD 或 YYYY-MM-DDTHH:mm。
   * startDate/endDate 继续保留为旧数据与周期模板锚点，不能改写或清除。
   */
  scheduleType?: TaskScheduleType
  startAt?: string
  dueAt?: string
  showBeforeStart?: boolean
  surfaceDaysBeforeDue?: number
  completedAt?: string
  parentTaskId?: string
  inheritsParentSchedule?: boolean
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
  completionStatus?: 'pending' | 'completed' // v8 前旧记录缺省按 pending 读取
  completedAt?: string
  lifecycleStatus: LifecycleStatus
  deletedAt?: string
  createdAt: string
  updatedAt: string
}

export interface DateTypeDefinition {
  id: string
  name: string
  colorToken: ColorToken
  rank: string
  lifecycleStatus: LifecycleStatus
  deletedAt?: string
  createdAt: string
  updatedAt: string
}

export interface DateTypeMarker {
  /** Deterministic `${date}:${typeId}` key keeps offline and multi-device writes idempotent. */
  id: string
  date: string
  typeId: string
  lifecycleStatus: LifecycleStatus
  deletedAt?: string
  createdAt: string
  updatedAt: string
}

/**
 * The removed fund-allocation feature shipped IndexedDB stores in v11. Keep
 * those records opaque and backed up so an upgrade never deletes user data;
 * current screens and finance calculations do not read or write them.
 */
interface LegacyFinanceCompatibilityRow {
  id: string
  [key: string]: unknown
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

export interface WorkRecord {
  id: string
  date: string // PlainDate ISO，按设备本地日期归档
  worked: boolean
  durationMinutes: number
  startTime?: string // HH:MM，本地民用时间
  endTime?: string
  breakMinutes?: number
  note?: string
  workLocation?: string
  workType?: string
  /** 创建/确认记录时的时薪快照；修改默认时薪不会改写历史。 */
  hourlyRate: number
  currency: 'JPY'
  lifecycleStatus: LifecycleStatus
  deletedAt?: string
  createdAt: string
  updatedAt: string
}

export interface WageSettings {
  id: '#wage'
  defaultHourlyRate: number
  currency: 'JPY'
  updatedAt: string
}

export interface ExpenseCategory {
  id: string
  name: string
  icon?: MarkerSymbol
  colorToken: ColorToken
  rank: string
  sortOrder?: number
  archived?: boolean
  defaultAccountId?: string
  lifecycleStatus: LifecycleStatus
  deletedAt?: string
  createdAt: string
  updatedAt: string
}

export interface ExpenseRecord {
  id: string
  amount: number
  date: string // PlainDate ISO
  merchant?: string
  categoryId?: string
  categoryNameSnapshot?: string
  note?: string
  paymentMethod?: string
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
  /** 全局财务展示偏好；只影响结果展示，不进入任何业务流水。 */
  financeAmountsVisible?: boolean
  updatedAt: string
}

export interface TaskScheduleMigrationState {
  id: '#task-schedule-v12'
  version: 12
  status: 'pending' | 'complete' | 'rolled-back'
  /** 仅保存迁移前受影响任务，供本地原样回滚。 */
  backup: Task[]
  createdAt: string
  completedAt?: string
  rolledBackAt?: string
}

export const db = new Dexie('task-pwa', { addons: [dexieCloud] }) as Dexie & {
  tasks: EntityTable<Task, 'id'>
  completionRecords: EntityTable<CompletionRecord, 'id'>
  syncedPreferences: EntityTable<SyncedPreferences, 'id'>
  categories: EntityTable<Category, 'id'>
  calendarEvents: EntityTable<CalendarEvent, 'id'>
  dateTypeDefinitions: EntityTable<DateTypeDefinition, 'id'>
  dateTypeMarkers: EntityTable<DateTypeMarker, 'id'>
  shoppingItems: EntityTable<ShoppingItem, 'id'>
  shoppingLocations: EntityTable<ShoppingLocation, 'id'>
  workRecords: EntityTable<WorkRecord, 'id'>
  wageSettings: EntityTable<WageSettings, 'id'>
  expenseRecords: EntityTable<ExpenseRecord, 'id'>
  expenseCategories: EntityTable<ExpenseCategory, 'id'>
  accounts: EntityTable<Account, 'id'>
  financeTransactions: EntityTable<FinanceTransaction, 'id'>
  financeTransfers: EntityTable<FinanceTransfer, 'id'>
  creditCardSettlements: EntityTable<CreditCardSettlement, 'id'>
  exchangeRates: EntityTable<ExchangeRate, 'id'>
  workTemplates: EntityTable<WorkTemplate, 'id'>
  workEntries: EntityTable<WorkEntry, 'id'>
  paychecks: EntityTable<Paycheck, 'id'>
  merchants: EntityTable<Merchant, 'id'>
  financeMigrations: EntityTable<FinanceMigrationState, 'id'>
  fundPools: EntityTable<LegacyFinanceCompatibilityRow, 'id'>
  transactionFundAllocations: EntityTable<LegacyFinanceCompatibilityRow, 'id'>
  fundPoolTransfers: EntityTable<LegacyFinanceCompatibilityRow, 'id'>
  fundReservations: EntityTable<LegacyFinanceCompatibilityRow, 'id'>
  recurringTransactionRules: EntityTable<RecurringTransactionRule, 'id'>
  recurringTransactionInstances: EntityTable<RecurringTransactionInstance, 'id'>
  savingsGoals: EntityTable<LegacyFinanceCompatibilityRow, 'id'>
  budgetPlans: EntityTable<LegacyFinanceCompatibilityRow, 'id'>
  financialProjections: EntityTable<LegacyFinanceCompatibilityRow, 'id'>
  financeFundsMigrations: EntityTable<LegacyFinanceCompatibilityRow, 'id'>
  taskScheduleMigrations: EntityTable<TaskScheduleMigrationState, 'id'>
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

// v8：在现有任务/日历/购物数据旁新增财务域；旧记录只补安全默认值。
// 不改旧主键、不复制任务、不清理任何 IndexedDB 数据。
db.version(8)
  .stores({
    calendarEvents:
      'id, lifecycleStatus, startDate, endDate, completionStatus',
    shoppingItems:
      'id, lifecycleStatus, purchaseStatus, locationId, purchasedAt, [locationId+rank]',
    workRecords: 'id, lifecycleStatus, date, [lifecycleStatus+date]',
    wageSettings: 'id',
    expenseRecords:
      'id, lifecycleStatus, date, categoryId, merchant, [lifecycleStatus+date]',
    expenseCategories: 'id, lifecycleStatus, rank',
  })
  .upgrade(async (tx) => {
    await tx
      .table('calendarEvents')
      .toCollection()
      .modify((event: CalendarEvent) => {
        if (!event.completionStatus) event.completionStatus = 'pending'
      })
  })

// v9：只新增账本表，不在版本升级钩子中改写任何已同步的旧表。
// Dexie Cloud 不支持依赖 Version.upgrade() 迁移同步表；兼容迁移在 ready 后
// 通过确定性 ID 执行，旧记录始终保留并可回滚。
db.version(9).stores({
  accounts:
    'id, lifecycleStatus, kind, subtype, currency, rank, [lifecycleStatus+rank]',
  financeTransactions:
    'id, lifecycleStatus, type, localDate, accountId, counterpartyAccountId, categoryId, merchantId, transferId, paycheckId, [lifecycleStatus+localDate], [accountId+localDate]',
  financeTransfers:
    'id, lifecycleStatus, kind, localDate, sourceAccountId, destinationAccountId, transactionId',
  creditCardSettlements:
    'id, status, creditAccountId, paymentAccountId, dueDate, transactionId',
  exchangeRates:
    'id, baseCurrency, quoteCurrency, rateDate, source, [baseCurrency+quoteCurrency+rateDate]',
  workTemplates: 'id, lifecycleStatus, rank, [lifecycleStatus+rank]',
  workEntries:
    'id, lifecycleStatus, date, settlementStatus, payoutAccountId, templateId, paycheckId, [lifecycleStatus+date]',
  paychecks: 'id, status, payoutAccountId, expectedPayDate, paidAt',
  merchants: 'id, lifecycleStatus, name, useCount, lastUsedAt',
  financeMigrations: 'id, status, version',
})
  .upgrade(async (tx) => {
    await tx
      .table('tasks')
      .toCollection()
      .modify((task: Task) => {
        ensureTaskScope(task)
      })
  })

// v10：账户类型与账户归属解耦，并为可管理的支出分类补充稳定字段。
// 实际字段回填在 ready 后幂等执行，避免在 Dexie Cloud 同步表的
// Version.upgrade 中批量改写旧数据。
db.version(10).stores({
  accounts:
    'id, lifecycleStatus, kind, ownership, subtype, currency, rank, [lifecycleStatus+rank]',
  financeTransactions:
    'id, lifecycleStatus, type, fundingParty, localDate, accountId, counterpartyAccountId, categoryId, merchantId, transferId, paycheckId, [lifecycleStatus+localDate], [accountId+localDate]',
  expenseCategories: 'id, lifecycleStatus, archived, rank, sortOrder',
})

// v11：只新增资金池域表及可选索引，不在版本升级中改写任何同步旧表。
// 历史流水的“未指定资金来源”兼容关系由 ready 后的幂等迁移建立。
db.version(11).stores({
  financeTransactions:
    'id, lifecycleStatus, type, fundingParty, localDate, accountId, counterpartyAccountId, categoryId, merchantId, transferId, paycheckId, recurringInstanceId, [lifecycleStatus+localDate], [accountId+localDate]',
  expenseCategories:
    'id, lifecycleStatus, archived, rank, sortOrder, defaultAccountId, defaultFundPoolId',
  fundPools:
    'id, lifecycleStatus, purpose, currency, accountId, rank, [lifecycleStatus+rank]',
  transactionFundAllocations:
    'id, lifecycleStatus, transactionId, fundPoolId, reservationId, [transactionId+fundPoolId]',
  fundPoolTransfers:
    'id, lifecycleStatus, sourcePoolId, destinationPoolId, localDate, currency',
  fundReservations:
    'id, status, transactionId, creditAccountId, fundPoolId, [creditAccountId+status]',
  recurringTransactionRules:
    'id, lifecycleStatus, enabled, billingDay, startDate, endDate, rank',
  recurringTransactionInstances:
    'id, ruleId, billingPeriod, scheduledDate, status, transactionId, [ruleId+billingPeriod]',
  savingsGoals: 'id, lifecycleStatus, fundPoolId, currency, rank',
  budgetPlans: 'id, month, currency, [month+currency]',
  financialProjections: 'id, month, currency, [month+currency]',
  financeFundsMigrations: 'id, status, version',
})

// v12：任务排期、DDL 与父子关系。只增加可选索引；旧字段、主键、
// 周期完成记录与 rank 全部保留。字段回填由 ready 后的幂等迁移完成，
// 迁移前快照保存在 taskScheduleMigrations，支持原样回滚。
db.version(12).stores({
  tasks:
    'id, lifecycleStatus, [lifecycleStatus+rank], [id+currentSequence], categoryId, taskScope, scheduleType, parentTaskId, dueAt',
  taskScheduleMigrations: 'id, status, version',
})

// v13: lightweight date labels used by the plan calendar. The two new tables
// are additive and use deterministic marker ids, so offline and cloud replays
// cannot create duplicates. Legacy fund tables remain untouched as inert
// compatibility stores; removing a Dexie store would destroy existing data.
db.version(13).stores({
  dateTypeDefinitions: 'id, lifecycleStatus, rank, [lifecycleStatus+rank]',
  dateTypeMarkers: 'id, lifecycleStatus, date, typeId, [date+typeId]',
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
      financeAmountsVisible: true,
      updatedAt: new Date().toISOString(),
    })
  } else if (!existing.uiTheme || existing.financeAmountsVisible === undefined) {
    await db.syncedPreferences.update('#prefs', {
      ...(!existing.uiTheme && { uiTheme: 'violet-lime' as const }),
      ...(existing.financeAmountsVisible === undefined && { financeAmountsVisible: true }),
      updatedAt: new Date().toISOString(),
    })
  }

  const wage = await db.wageSettings.get('#wage')
  if (!wage) {
    await db.wageSettings.put({
      id: '#wage',
      defaultHourlyRate: 0,
      currency: 'JPY',
      updatedAt: new Date().toISOString(),
    })
  }

  if ((await db.expenseCategories.count()) === 0) {
    const createdAt = new Date().toISOString()
    await db.expenseCategories.bulkPut([
      { id: 'expense-food', name: '餐饮', icon: 'dot', colorToken: 'orange', rank: '0001', sortOrder: 0, archived: false, lifecycleStatus: 'active', createdAt, updatedAt: createdAt },
      { id: 'expense-shopping', name: '购物', icon: 'dot', colorToken: 'pink', rank: '0002', sortOrder: 1, archived: false, lifecycleStatus: 'active', createdAt, updatedAt: createdAt },
      { id: 'expense-transit', name: '交通', icon: 'dot', colorToken: 'blue', rank: '0003', sortOrder: 2, archived: false, lifecycleStatus: 'active', createdAt, updatedAt: createdAt },
      { id: 'expense-life', name: '生活', icon: 'dot', colorToken: 'green', rank: '0004', sortOrder: 3, archived: false, lifecycleStatus: 'active', createdAt, updatedAt: createdAt },
      { id: 'expense-study', name: '学习', icon: 'dot', colorToken: 'purple', rank: '0005', sortOrder: 4, archived: false, lifecycleStatus: 'active', createdAt, updatedAt: createdAt },
    ])
  }

  if (financeLedgerV2Enabled) {
    await migrateLegacyFinanceData(db)
    await ensureFinanceOwnershipMigration(db)
  }
  if ((await db.dateTypeDefinitions.count()) === 0) {
    const timestamp = new Date().toISOString()
    await db.dateTypeDefinitions.bulkPut([
      { id: 'date-type-work', name: '上班', colorToken: 'blue', rank: '0001', lifecycleStatus: 'active', createdAt: timestamp, updatedAt: timestamp },
      { id: 'date-type-school', name: '上学', colorToken: 'green', rank: '0002', lifecycleStatus: 'active', createdAt: timestamp, updatedAt: timestamp },
      { id: 'date-type-other', name: '其他', colorToken: 'purple', rank: '0003', lifecycleStatus: 'active', createdAt: timestamp, updatedAt: timestamp },
    ])
  }
  await ensureTaskScheduleMigration(db)
})
