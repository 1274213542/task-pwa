import 'fake-indexeddb/auto'
import type Dexie from 'dexie'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account, FinanceTransaction, WorkEntry } from './ledgerTypes'

const testState = vi.hoisted(() => ({ db: undefined as unknown }))

vi.mock('./db', async () => {
  const { default: Dexie } = await import('dexie')
  const db = new Dexie('task-pwa-ledger-persistence-test')
  db.version(1).stores({
    accounts: 'id, kind, ownership, currency, lifecycleStatus',
    financeTransactions: 'id, type, accountId, linkedTransactionId, categoryId, lifecycleStatus',
    expenseCategories: 'id, rank, lifecycleStatus',
    expenseRecords: 'id, categoryId',
    merchants: 'id, name, lifecycleStatus',
    financeTransfers: 'id, transactionId, lifecycleStatus',
    creditCardSettlements: 'id, transactionId, status',
    workEntries: 'id, date, settlementStatus, lifecycleStatus',
    paychecks: 'id, status, payoutAccountId',
    recurringTransactionRules: 'id, lifecycleStatus, rank',
    recurringTransactionInstances: 'id, ruleId, billingPeriod, status, scheduledDate',
  })
  testState.db = db
  return { db }
})

let ledger: typeof import('./ledger')
let recurring: typeof import('./recurringFinance')
let expenseCategories: typeof import('./expenseCategories')

function account(overrides: Partial<Account> & Pick<Account, 'id' | 'name'>): Account {
  const { id, name, ...rest } = overrides
  return {
    id,
    name,
    kind: 'asset',
    ownership: 'self',
    subtype: 'bank',
    currency: 'JPY',
    openingBalanceMinor: 100_000,
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
  recurring = await import('./recurringFinance')
  expenseCategories = await import('./expenseCategories')
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
  it('工作记录保留出退勤时间，并以扣除休息后的有效工时计算预计工资', async () => {
    const db = testState.db as Dexie
    const id = await ledger.saveWorkEntry({
      date: '2026-07-21',
      worked: true,
      startTime: '22:00',
      endTime: '02:00',
      durationMinutes: 210,
      breakMinutes: 30,
      hourlyRateMinor: 1200,
      currency: 'JPY',
    })

    expect(await db.table('workEntries').get(id)).toMatchObject({
      startTime: '22:00',
      endTime: '02:00',
      durationMinutes: 210,
      breakMinutes: 30,
      estimatedGrossMinor: 4200,
    })
  })

  it('支出分类可新增、重命名、排序并在归档时迁移既有流水', async () => {
    const db = testState.db as Dexie
    const foodId = await expenseCategories.saveExpenseCategory({ name: '餐饮' })
    const travelId = await expenseCategories.saveExpenseCategory({ name: '旅行' })
    await expenseCategories.saveExpenseCategory({ id: travelId, name: '旅行与住宿' })
    await expenseCategories.moveExpenseCategory(travelId, -1)
    await db.table('financeTransactions').add(transaction({
      id: 'travel-expense',
      type: 'external_payment',
      accountId: 'external-card',
      categoryId: travelId,
      categoryNameSnapshot: '旅行与住宿',
      fundingParty: 'external',
      affectsNetWorth: false,
    }))

    await expenseCategories.archiveExpenseCategory(travelId, foodId)

    expect(await db.table('expenseCategories').get(travelId)).toMatchObject({
      archived: true,
      lifecycleStatus: 'deleted',
    })
    expect(await db.table('financeTransactions').get('travel-expense')).toMatchObject({
      categoryId: foodId,
      categoryNameSnapshot: '餐饮',
    })
  })

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

  it('本人信用卡消费增加负债，还款只结算负债且不重复统计支出', async () => {
    const db = testState.db as Dexie
    await db.table('accounts').bulkAdd([
      account({ id: 'bank', name: '本人银行' }),
      account({
        id: 'card',
        name: '本人信用卡',
        kind: 'credit',
        subtype: 'credit_card',
        openingBalanceMinor: 0,
      }),
    ])
    const purchaseId = await ledger.saveSpending({
      amountMinor: 10_000,
      currency: 'JPY',
      localDate: '2026-07-19',
      accountId: 'card',
    })
    expect(await db.table('financeTransactions').get(purchaseId)).toMatchObject({
      type: 'credit_purchase',
      includeInSpending: true,
    })
    await ledger.saveTransfer({
      sourceAccountId: 'bank',
      destinationAccountId: 'card',
      sourceAmountMinor: 10_000,
      localDate: '2026-07-25',
      kind: 'credit_payment',
    })
    const allTransactions = await db.table('financeTransactions').toArray()
    const balances = ledger.calculateAccountBalances(
      await db.table('accounts').toArray(),
      allTransactions,
    )
    expect(balances.get('bank')).toBe(90_000)
    expect(balances.get('card')).toBe(0)
    expect(allTransactions.filter((row) => row.includeInSpending)).toHaveLength(1)
  })

  it('资产账户支出受实际余额约束，删除后完整恢复余额', async () => {
    const db = testState.db as Dexie
    await db.table('accounts').add(account({ id: 'bank', name: '本人银行', openingBalanceMinor: 100_000 }))
    const id = await ledger.saveSpending({
      amountMinor: 100_000,
      currency: 'JPY',
      localDate: '2026-07-19',
      accountId: 'bank',
    })

    await expect(ledger.saveSpending({
      amountMinor: 1,
      currency: 'JPY',
      localDate: '2026-07-20',
      accountId: 'bank',
    })).rejects.toThrow('支付账户余额不足')

    await ledger.softDeleteFinanceTransaction(id)
    const balances = ledger.calculateAccountBalances(
      await db.table('accounts').toArray(),
      await db.table('financeTransactions').toArray(),
    )
    expect(balances.get('bank')).toBe(100_000)
  })

  it('固定扣款使用规则与账期唯一键，短月和连续刷新不会重复入账', async () => {
    const db = testState.db as Dexie
    await db.table('accounts').add(account({ id: 'bank', name: '本人银行', openingBalanceMinor: 200_000 }))
    const ruleId = await recurring.saveRecurringRule({
      name: '房租',
      amountMinor: 100_000,
      currency: 'JPY',
      accountId: 'bank',
      billingDay: 31,
      startDate: '2026-02-01',
      postingMode: 'automatic',
    })

    const first = await recurring.processDueRecurringRules('2026-02-28')
    const second = await recurring.processDueRecurringRules('2026-02-28')
    expect(first.posted).toBe(1)
    expect(second.posted).toBe(0)
    expect(await db.table('financeTransactions').count()).toBe(1)
    expect(await db.table('recurringTransactionInstances').get(
      recurring.recurringInstanceId(ruleId, '2026-02'),
    )).toMatchObject({ scheduledDate: '2026-02-28', status: 'posted' })
  })

})
