import Dexie, { type Table } from 'dexie'
import type {
  Account,
  FinanceMigrationSnapshot,
  FinanceMigrationState,
  FinanceTransaction,
  WorkEntry,
} from './ledgerTypes'

const MIGRATION_ID = 'finance-ledger-v2' as const
export const LEGACY_ACCOUNT_ID = 'account:legacy-unspecified'
const EXPENSE_PREFIX = 'legacy-expense:'
const WORK_PREFIX = 'legacy-work:'

type LegacyExpense = {
  id: string
  amount?: number
  date?: string
  merchant?: string
  categoryId?: string
  categoryNameSnapshot?: string
  note?: string
  paymentMethod?: string
  lifecycleStatus?: 'active' | 'deleted'
  deletedAt?: string
  createdAt?: string
  updatedAt?: string
}

type LegacyWork = {
  id: string
  date?: string
  worked?: boolean
  durationMinutes?: number
  startTime?: string
  endTime?: string
  breakMinutes?: number
  note?: string
  workLocation?: string
  workType?: string
  hourlyRate?: number
  lifecycleStatus?: 'active' | 'deleted'
  deletedAt?: string
  createdAt?: string
  updatedAt?: string
}

function isoNow() {
  return new Date().toISOString()
}

function safeDate(value?: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? '')
    ? value!
    : new Date().toISOString().slice(0, 10)
}

function safetyDb(name: string) {
  const db = new Dexie(name) as Dexie & {
    snapshots: Table<FinanceMigrationSnapshot, string>
  }
  db.version(1).stores({ snapshots: 'id, createdAt, sourceDatabase' })
  return db
}

export async function migrateLegacyFinanceData(
  db: Dexie,
  safetyDatabaseName = `${db.name}-finance-safety`,
): Promise<FinanceMigrationState> {
  const accounts = db.table<Account, string>('accounts')
  const financeTransactions = db.table<FinanceTransaction, string>('financeTransactions')
  const workEntriesTable = db.table<WorkEntry, string>('workEntries')
  const financeMigrations = db.table<FinanceMigrationState, string>('financeMigrations')
  const existing = await financeMigrations.get(MIGRATION_ID)
  if (existing?.status === 'complete') return existing

  const [legacyExpenses, legacyWork] = await Promise.all([
    db.table('expenseRecords').toArray() as Promise<LegacyExpense[]>,
    db.table('workRecords').toArray() as Promise<LegacyWork[]>,
  ])
  const timestamp = isoNow()
  const snapshotId = `${MIGRATION_ID}:${db.name}`
  const backupDb = safetyDb(safetyDatabaseName)

  try {
    // 先在不参与云同步的独立 IndexedDB 中落盘，再触碰新账本表。
    await backupDb.open()
    await backupDb.snapshots.put({
      id: snapshotId,
      createdAt: timestamp,
      sourceDatabase: db.name,
      expenseRecords: legacyExpenses as unknown as Record<string, unknown>[],
      workRecords: legacyWork as unknown as Record<string, unknown>[],
    })

    const account: Account = {
      id: LEGACY_ACCOUNT_ID,
      name: '未指定支付账户',
      kind: 'external',
      subtype: 'unspecified',
      currency: 'JPY',
      openingBalanceMinor: 0,
      includeInNetWorth: false,
      includeInSpending: true,
      note: '由旧版支出迁移；选择真实账户前不会改变个人资产或负债。',
      rank: 'zzzz-legacy',
      lifecycleStatus: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    const transactions: FinanceTransaction[] = legacyExpenses.map((record) => {
      const createdAt = record.createdAt ?? timestamp
      const active = record.lifecycleStatus !== 'deleted'
      return {
        id: `${EXPENSE_PREFIX}${record.id}`,
        type: 'external_payment',
        amountMinor: Math.max(0, Math.round(Number(record.amount) || 0)),
        currency: 'JPY',
        localDate: safeDate(record.date),
        occurredAt: `${safeDate(record.date)}T12:00:00.000Z`,
        accountId: LEGACY_ACCOUNT_ID,
        ...(record.categoryId && { categoryId: record.categoryId }),
        ...(record.categoryNameSnapshot && {
          categoryNameSnapshot: record.categoryNameSnapshot,
        }),
        ...(record.merchant && { merchantNameSnapshot: record.merchant }),
        ...(record.note && { note: record.note }),
        includeInSpending: true,
        affectsNetWorth: false,
        reportingCurrency: 'JPY',
        reportingAmountMinor: Math.max(0, Math.round(Number(record.amount) || 0)),
        exchangeRate: 1,
        exchangeRateDate: safeDate(record.date),
        exchangeRateSource: 'legacy-jpy',
        lifecycleStatus: active ? 'active' : 'deleted',
        ...(record.deletedAt && { deletedAt: record.deletedAt }),
        createdAt,
        updatedAt: record.updatedAt ?? createdAt,
      }
    })

    const workEntries: WorkEntry[] = legacyWork.map((record) => {
      const createdAt = record.createdAt ?? timestamp
      const durationMinutes = Math.max(0, Math.round(Number(record.durationMinutes) || 0))
      const hourlyRateMinor = Math.max(0, Math.round(Number(record.hourlyRate) || 0))
      return {
        id: `${WORK_PREFIX}${record.id}`,
        date: safeDate(record.date),
        worked: Boolean(record.worked),
        ...(record.workType && { workContent: record.workType }),
        ...(record.workLocation && { workLocation: record.workLocation }),
        ...(record.startTime && { startTime: record.startTime }),
        ...(record.endTime && { endTime: record.endTime }),
        durationMinutes,
        breakMinutes: Math.max(0, Math.round(Number(record.breakMinutes) || 0)),
        paidBreak: false,
        hourlyRateMinor,
        currency: 'JPY',
        estimatedGrossMinor: Math.round((durationMinutes / 60) * hourlyRateMinor),
        ...(record.note && { note: record.note }),
        settlementStatus: 'unsettled',
        lifecycleStatus: record.lifecycleStatus === 'deleted' ? 'deleted' : 'active',
        ...(record.deletedAt && { deletedAt: record.deletedAt }),
        createdAt,
        updatedAt: record.updatedAt ?? createdAt,
      }
    })

    const nextState: FinanceMigrationState = {
      id: MIGRATION_ID,
      version: 2,
      status: 'complete',
      snapshotId,
      migratedExpenseCount: transactions.length,
      migratedWorkCount: workEntries.length,
      startedAt: existing?.startedAt ?? timestamp,
      completedAt: isoNow(),
    }

    await db.transaction(
      'rw',
      accounts,
      financeTransactions,
      workEntriesTable,
      financeMigrations,
      async () => {
        if (transactions.length > 0) await accounts.put(account)
        await financeTransactions.bulkPut(transactions)
        await workEntriesTable.bulkPut(workEntries)
        await financeMigrations.put(nextState)
      },
    )
    return nextState
  } catch (error) {
    const failed: FinanceMigrationState = {
      id: MIGRATION_ID,
      version: 2,
      status: 'failed',
      snapshotId,
      migratedExpenseCount: 0,
      migratedWorkCount: 0,
      startedAt: existing?.startedAt ?? timestamp,
      error: error instanceof Error ? error.message : String(error),
    }
    await financeMigrations.put(failed)
    throw error
  } finally {
    backupDb.close()
  }
}

/**
 * 回滚只删除带确定性前缀的迁移副本；旧 expenseRecords/workRecords 从未改写。
 */
export async function rollbackLegacyFinanceMigration(
  db: Dexie,
): Promise<void> {
  const accounts = db.table<Account, string>('accounts')
  const financeTransactions = db.table<FinanceTransaction, string>('financeTransactions')
  const workEntries = db.table<WorkEntry, string>('workEntries')
  const financeMigrations = db.table<FinanceMigrationState, string>('financeMigrations')
  await db.transaction(
    'rw',
    accounts,
    financeTransactions,
    workEntries,
    financeMigrations,
    async () => {
      await financeTransactions.where('id').startsWith(EXPENSE_PREFIX).delete()
      await workEntries.where('id').startsWith(WORK_PREFIX).delete()
      const remaining = await financeTransactions
        .where('accountId')
        .equals(LEGACY_ACCOUNT_ID)
        .count()
      if (remaining === 0) await accounts.delete(LEGACY_ACCOUNT_ID)
      const current = await financeMigrations.get(MIGRATION_ID)
      await financeMigrations.put({
        id: MIGRATION_ID,
        version: 2,
        status: 'rolled_back',
        snapshotId: current?.snapshotId,
        migratedExpenseCount: current?.migratedExpenseCount ?? 0,
        migratedWorkCount: current?.migratedWorkCount ?? 0,
        startedAt: current?.startedAt ?? isoNow(),
        completedAt: isoNow(),
      })
    },
  )
}
