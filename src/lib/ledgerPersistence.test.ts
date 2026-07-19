import 'fake-indexeddb/auto'
import type Dexie from 'dexie'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, FinanceTransaction, WorkEntry } from './ledgerTypes'

const testState = vi.hoisted(() => ({ db: undefined as unknown }))

vi.mock('./db', async () => {
  const { default: Dexie } = await import('dexie')
  const db = new Dexie('task-pwa-ledger-persistence-test')
  db.version(1).stores({
    accounts: 'id, kind, ownership, currency',
    financeTransactions: 'id, type, accountId, linkedTransactionId, lifecycleStatus',
    expenseCategories: 'id, rank, lifecycleStatus',
    merchants: 'id, name, lifecycleStatus',
    financeTransfers: 'id, transactionId, lifecycleStatus',
    creditCardSettlements: 'id, transactionId, status',
    workEntries: 'id, date, settlementStatus, lifecycleStatus',
    paychecks: 'id, status, payoutAccountId',
  })
  testState.db = db
  return { db }
})

let ledger: typeof import('./ledger')

function account(overrides: Partial<Account> & Pick<Account, 'id' | 'name'>): Account {
  const { id, name, ...rest } = overrides
  return {
    id,
    name,
    kind: 'asset',
    ownership: 'self',
    subtype: 'bank',
    currency: 'JPY',
    openingBalanceMinor: 0,
    includeInNetWorth: true,
    includeInSpending: true,
    rank: 'a0',
    lifecycleStatus: 'active',
    createdAt: '2026-07-19T00:00:00.000Z',
    updatedAt: '2026-07-19T00:00:00.000Z',
    ...rest,
  }
}

function transaction(
  overrides: Partial<FinanceTransaction> & Pick<FinanceTransaction, 'id' | 'type' | 'accountId'>,
): FinanceTransaction {
  const { id, type, accountId, ...rest } = overrides
  return {
    id,
    type,
    amountMinor: 10_000,
    currency: 'JPY',
    occurredAt: '2026-07-19T12:00:00.000Z',
    localDate: '2026-07-19',
    accountId,
    includeInSpending: true,
    affectsNetWorth: true,
    lifecycleStatus: 'active',
    createdAt: '2026-07-19T12:00:00.000Z',
    updatedAt: '2026-07-19T12:00:00.000Z',
    ...rest,
  }
}

function workEntry(overrides: Partial<WorkEntry> & Pick<WorkEntry, 'id'>): WorkEntry {
  const { id, ...rest } = overrides
  return {
    id,
    date: '2026-07-19',
    worked: true,
    durationMinutes: 480,
    breakMinutes: 0,
    paidBreak: false,
    hourlyRateMinor: 1250,
    currency: 'JPY',
    estimatedGrossMinor: 10_000,
    settlementStatus: 'unsettled',
    lifecycleStatus: 'active',
    createdAt: '2026-07-19T00:00:00.000Z',
    updatedAt: '2026-07-19T00:00:00.000Z',
    ...rest,
  }
}

beforeAll(async () => {
  ledger = await import('./ledger')
  await (testState.db as Dexie).open()
})

beforeEach(async () => {
  const db = testState.db as Dexie
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })
})

afterAll(async () => {
  const db = testState.db as Dexie
  db.close()
  await db.delete()
})

describe('财务账本持久化约束', () => {
  it('新支出的资金来源只能由支付账户归属派生', async () => {
    const db = testState.db as Dexie
    await db.table('accounts').add(account({
      id: 'family-card',
      name: '家人信用卡',
      kind: 'credit',
      ownership: 'external',
      subtype: 'credit_card',
      includeInNetWorth: false,
    }))

    const id = await ledger.saveSpending({
      amountMinor: 2600,
      currency: 'JPY',
      localDate: '2026-07-19',
      accountId: 'family-card',
      includeInSpending: true,
    })

    expect(await db.table('financeTransactions').get(id)).toMatchObject({
      type: 'external_payment',
      fundingParty: 'external',
      affectsNetWorth: false,
    })
  })

  it('编辑支出日期时同步更新流水排序时间但保留记录身份', async () => {
    const db = testState.db as Dexie
    await db.table('accounts').add(account({ id: 'cash', name: '现金' }))
    const id = await ledger.saveSpending({
      amountMinor: 1800,
      currency: 'JPY',
      localDate: '2026-07-19',
      accountId: 'cash',
    })
    const created = await db.table('financeTransactions').get(id)

    await ledger.saveSpending({
      id,
      amountMinor: 1800,
      currency: 'JPY',
      localDate: '2026-07-22',
      accountId: 'cash',
    })

    expect(await db.table('financeTransactions').get(id)).toMatchObject({
      id,
      localDate: '2026-07-22',
      occurredAt: '2026-07-22T12:00:00.000Z',
      createdAt: created?.createdAt,
    })
  })

  it('退款继承原消费快照并阻止累计超额退款', async () => {
    const db = testState.db as Dexie
    await db.table('accounts').add(account({ id: 'cash', name: '现金' }))
    await db.table('financeTransactions').add(transaction({
      id: 'original',
      type: 'expense',
      accountId: 'cash',
      amountMinor: 10_000,
      fundingParty: 'self',
      categoryId: 'food',
      categoryNameSnapshot: '餐饮',
      merchantId: 'store',
      merchantNameSnapshot: '商店',
      reportingCurrency: 'CNY',
      reportingAmountMinor: 5000,
      exchangeRate: 0.5,
      exchangeRateDate: '2026-07-19',
      exchangeRateSource: 'test',
    }))

    const refundId = await ledger.saveRefund({
      amountMinor: 4000,
      localDate: '2026-07-20',
      linkedTransactionId: 'original',
    })

    expect(await db.table('financeTransactions').get(refundId)).toMatchObject({
      type: 'refund',
      amountMinor: 4000,
      currency: 'JPY',
      accountId: 'cash',
      fundingParty: 'self',
      categoryNameSnapshot: '餐饮',
      merchantNameSnapshot: '商店',
      reportingCurrency: 'CNY',
      reportingAmountMinor: 2000,
      linkedTransactionId: 'original',
    })
    await expect(ledger.saveRefund({
      amountMinor: 7000,
      localDate: '2026-07-21',
      linkedTransactionId: 'original',
    })).rejects.toThrow('退款超过可退金额')
  })

  it('工资按实际到账金额入账并拒绝同一工作记录重复结算', async () => {
    const db = testState.db as Dexie
    await db.table('accounts').bulkAdd([
      account({ id: 'bank', name: '本人银行' }),
      account({
        id: 'external-bank',
        name: '外部账户',
        ownership: 'external',
        includeInNetWorth: false,
      }),
    ])
    await db.table('workEntries').add(workEntry({ id: 'work-1', payoutAccountId: 'bank' }))

    await ledger.settlePaycheck({
      workEntryIds: ['work-1'],
      payoutAccountId: 'bank',
      actualAmountMinor: 8500,
      currency: 'JPY',
      paidDate: '2026-07-20',
    })

    expect(await db.table('paychecks').toArray()).toEqual([
      expect.objectContaining({ estimatedAmountMinor: 10_000, actualAmountMinor: 8500 }),
    ])
    expect(await db.table('financeTransactions').toArray()).toEqual([
      expect.objectContaining({ type: 'income', amountMinor: 8500, accountId: 'bank' }),
    ])
    await expect(ledger.settlePaycheck({
      workEntryIds: ['work-1'],
      payoutAccountId: 'bank',
      actualAmountMinor: 8500,
      currency: 'JPY',
      paidDate: '2026-07-20',
    })).rejects.toThrow('同一工作记录不能重复入账')
  })

  it('普通转账不能伪装成向外部账户付款', async () => {
    const db = testState.db as Dexie
    await db.table('accounts').bulkAdd([
      account({ id: 'bank', name: '本人银行' }),
      account({
        id: 'family-wallet',
        name: '家人钱包',
        ownership: 'external',
        includeInNetWorth: false,
      }),
    ])

    await expect(ledger.saveTransfer({
      sourceAccountId: 'bank',
      destinationAccountId: 'family-wallet',
      sourceAmountMinor: 3000,
      localDate: '2026-07-19',
      kind: 'transfer',
    })).rejects.toThrow('普通转账的目标必须是本人资产账户')

    expect(await db.table('financeTransactions').count()).toBe(0)
    expect(await db.table('financeTransfers').count()).toBe(0)
  })
})
