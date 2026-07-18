import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LEGACY_ACCOUNT_ID,
  migrateLegacyFinanceData,
  rollbackLegacyFinanceMigration,
} from './financeMigration'

const dbName = 'task-pwa-finance-v2-migration-test'
const safetyName = `${dbName}-safety`

function makeDb() {
  const db = new Dexie(dbName)
  db.version(1).stores({
    expenseRecords: 'id, lifecycleStatus, date',
    workRecords: 'id, lifecycleStatus, date',
    accounts: 'id, lifecycleStatus, kind, subtype, currency, rank',
    financeTransactions: 'id, lifecycleStatus, type, localDate, accountId',
    workEntries: 'id, lifecycleStatus, date, settlementStatus',
    financeMigrations: 'id, status, version',
  })
  return db
}

afterEach(async () => {
  await Dexie.delete(dbName)
  await Dexie.delete(safetyName)
})

describe('财务 v2 安全迁移', () => {
  it('先备份，再以确定性 ID 复制；重复运行不重复生成', async () => {
    const db = makeDb()
    await db.open()
    await db.table('expenseRecords').add({
      id: 'expense-1',
      amount: 1280,
      date: '2026-07-18',
      merchant: '药局',
      categoryId: 'expense-life',
      lifecycleStatus: 'active',
      createdAt: '2026-07-18T10:00:00Z',
      updatedAt: '2026-07-18T10:00:00Z',
    })
    await db.table('workRecords').add({
      id: 'work-1',
      date: '2026-07-18',
      worked: true,
      durationMinutes: 480,
      hourlyRate: 1250,
      lifecycleStatus: 'active',
      createdAt: '2026-07-18T10:00:00Z',
      updatedAt: '2026-07-18T10:00:00Z',
    })

    const first = await migrateLegacyFinanceData(db as never, safetyName)
    const second = await migrateLegacyFinanceData(db as never, safetyName)
    expect(first.status).toBe('complete')
    expect(second).toEqual(first)
    expect(await db.table('financeTransactions').count()).toBe(1)
    expect(await db.table('workEntries').count()).toBe(1)
    expect(await db.table('accounts').get(LEGACY_ACCOUNT_ID)).toMatchObject({
      kind: 'external',
      includeInNetWorth: false,
      includeInSpending: true,
    })
    expect(await db.table('financeTransactions').get('legacy-expense:expense-1')).toMatchObject({
      type: 'external_payment',
      amountMinor: 1280,
      affectsNetWorth: false,
    })
    expect(await db.table('workEntries').get('legacy-work:work-1')).toMatchObject({
      estimatedGrossMinor: 10_000,
      settlementStatus: 'unsettled',
    })

    const safety = new Dexie(safetyName)
    safety.version(1).stores({ snapshots: 'id' })
    await safety.open()
    expect(await safety.table('snapshots').count()).toBe(1)
    expect((await safety.table('snapshots').toArray())[0].expenseRecords).toHaveLength(1)
    safety.close()
    db.close()
  })

  it('回滚只移除迁移副本，旧表保持原样', async () => {
    const db = makeDb()
    await db.open()
    await db.table('expenseRecords').add({
      id: 'expense-1',
      amount: 300,
      date: '2026-07-18',
      lifecycleStatus: 'active',
    })
    await migrateLegacyFinanceData(db as never, safetyName)
    await rollbackLegacyFinanceMigration(db as never)
    expect(await db.table('financeTransactions').count()).toBe(0)
    expect(await db.table('accounts').get(LEGACY_ACCOUNT_ID)).toBeUndefined()
    expect(await db.table('expenseRecords').get('expense-1')).toMatchObject({ amount: 300 })
    expect(await db.table('financeMigrations').get('finance-ledger-v2')).toMatchObject({
      status: 'rolled_back',
    })
    db.close()
  })
})
