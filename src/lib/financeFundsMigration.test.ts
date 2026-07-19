import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureFinanceFundsMigration,
  LEGACY_UNSPECIFIED_POOL_ID,
  legacyUnspecifiedPoolId,
  rollbackFinanceFundsMigration,
} from './financeFundsMigration'
import type { Account, FinanceTransaction } from './ledgerTypes'

const created: string[] = []
const timestamp = '2026-07-19T00:00:00.000Z'

function testDb() {
  const name = `fund-migration-${crypto.randomUUID()}`
  created.push(name, `${name}-safety`)
  const db = new Dexie(name)
  db.version(1).stores({
    accounts: 'id, lifecycleStatus',
    financeTransactions: 'id, lifecycleStatus, fundAllocationVersion',
    fundPools: 'id, lifecycleStatus',
    transactionFundAllocations: 'id, transactionId, lifecycleStatus',
    fundReservations: 'id, transactionId',
    financeFundsMigrations: 'id, status',
  })
  return db
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((name) => Dexie.delete(name)))
})

describe('旧财务数据安全迁移', () => {
  it('重复执行不复制分摊，且旧消费只进入未指定来源', async () => {
    const db = testDb()
    await db.open()
    const account: Account = {
      id: 'bank', name: '日本银行', kind: 'asset', subtype: 'bank', currency: 'JPY',
      openingBalanceMinor: 200_000, includeInNetWorth: true, includeInSpending: true,
      rank: 'a', lifecycleStatus: 'active', createdAt: timestamp, updatedAt: timestamp,
    }
    const transaction: FinanceTransaction = {
      id: 'old-expense', type: 'expense', amountMinor: 10_000, currency: 'JPY',
      occurredAt: timestamp, localDate: '2026-07-19', accountId: account.id,
      includeInSpending: true, affectsNetWorth: true, lifecycleStatus: 'active',
      createdAt: timestamp, updatedAt: timestamp,
    }
    await db.table('accounts').put(account)
    await db.table('financeTransactions').put(transaction)

    const first = await ensureFinanceFundsMigration(db, `${db.name}-safety`)
    const second = await ensureFinanceFundsMigration(db, `${db.name}-safety`)
    expect(first.status).toBe('complete')
    expect(second.migratedTransactionCount).toBe(1)
    expect(await db.table('transactionFundAllocations').count()).toBe(1)
    expect((await db.table('fundPools').get(LEGACY_UNSPECIFIED_POOL_ID)).openingBalanceMinor).toBe(10_000)
    expect((await db.table('financeTransactions').get(transaction.id)).fundAllocationVersion).toBe(1)

    await rollbackFinanceFundsMigration(db)
    expect(await db.table('transactionFundAllocations').count()).toBe(0)
    expect(await db.table('fundPools').get(LEGACY_UNSPECIFIED_POOL_ID)).toBeUndefined()
    expect((await db.table('financeTransactions').get(transaction.id)).fundAllocationVersion).toBeUndefined()
    db.close()
  })

  it('按旧流水原币种建立未指定资金池，外部代付仍不扣本人资金', async () => {
    const db = testDb()
    await db.open()
    const selfWallet: Account = {
      id: 'alipay', name: '支付宝', kind: 'asset', ownership: 'self', subtype: 'wallet', currency: 'CNY',
      openingBalanceMinor: 100_000, includeInNetWorth: true, includeInSpending: true,
      rank: 'a', lifecycleStatus: 'active', createdAt: timestamp, updatedAt: timestamp,
    }
    const externalCard: Account = {
      id: 'father-card', name: '父亲信用卡', kind: 'credit', ownership: 'external', subtype: 'credit_card', currency: 'CNY',
      openingBalanceMinor: 0, includeInNetWorth: false, includeInSpending: true,
      rank: 'b', lifecycleStatus: 'active', createdAt: timestamp, updatedAt: timestamp,
    }
    await db.table('accounts').bulkPut([selfWallet, externalCard])
    await db.table('financeTransactions').bulkPut([
      {
        id: 'old-cny', type: 'expense', amountMinor: 1234, currency: 'CNY', occurredAt: timestamp,
        localDate: '2026-07-19', accountId: selfWallet.id, fundingParty: 'self', includeInSpending: true,
        affectsNetWorth: true, lifecycleStatus: 'active', createdAt: timestamp, updatedAt: timestamp,
      },
      {
        id: 'old-external', type: 'credit_purchase', amountMinor: 5000, currency: 'CNY', occurredAt: timestamp,
        localDate: '2026-07-19', accountId: externalCard.id, fundingParty: 'external', includeInSpending: true,
        affectsNetWorth: false, lifecycleStatus: 'active', createdAt: timestamp, updatedAt: timestamp,
      },
    ])

    await ensureFinanceFundsMigration(db, `${db.name}-safety`)
    expect((await db.table('fundPools').get(legacyUnspecifiedPoolId('CNY'))).openingBalanceMinor).toBe(1234)
    expect(await db.table('transactionFundAllocations').where('transactionId').equals('old-cny').count()).toBe(1)
    expect(await db.table('transactionFundAllocations').where('transactionId').equals('old-external').count()).toBe(0)
    db.close()
  })
})
