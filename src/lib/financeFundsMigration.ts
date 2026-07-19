import Dexie, { type Table } from 'dexie'
import type {
  Account,
  FinanceFundsMigrationState,
  FinanceTransaction,
  FundPool,
  FundReservation,
  TransactionFundAllocation,
} from './ledgerTypes'

const MIGRATION_ID = 'finance-funds-v3' as const
export const LEGACY_UNSPECIFIED_POOL_ID = 'fund-pool:legacy-unspecified:JPY'

interface FinanceFundsSnapshot {
  id: string
  createdAt: string
  sourceDatabase: string
  accounts: Record<string, unknown>[]
  financeTransactions: Record<string, unknown>[]
}

function now() {
  return new Date().toISOString()
}

function owns(account: Account) {
  return account.ownership ?? (account.kind === 'external' ? 'external' : 'self')
}

function safetyDb(name: string) {
  const backup = new Dexie(name) as Dexie & {
    snapshots: Table<FinanceFundsSnapshot, string>
  }
  backup.version(1).stores({ snapshots: 'id, createdAt, sourceDatabase' })
  return backup
}

function migrationPool(timestamp: string, openingBalanceMinor: number): FundPool {
  return {
    id: LEGACY_UNSPECIFIED_POOL_ID,
    name: '未指定资金来源',
    purpose: 'unspecified',
    currency: 'JPY',
    // Old spending is represented for traceability but must not fabricate a
    // negative current-purpose balance. This synthetic opening allocation is
    // fully consumed/locked by the migrated rows, leaving current real assets
    // unallocated until the user explicitly assigns them.
    openingBalanceMinor,
    includeInDisposable: false,
    includeInSavings: false,
    restricted: true,
    rank: 'zzzz-legacy',
    lifecycleStatus: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

/**
 * 只为能够明确判断为“本人承担”的旧消费建立未指定分摊。
 * 外部代付保持无资金池，不会被误判为父亲专项或个人自由资金。
 */
export async function ensureFinanceFundsMigration(
  db: Dexie,
  safetyDatabaseName = `${db.name}-finance-funds-safety`,
): Promise<FinanceFundsMigrationState> {
  const states = db.table<FinanceFundsMigrationState, string>('financeFundsMigrations')
  const current = await states.get(MIGRATION_ID)
  if (current?.status === 'complete') return current

  const accounts = await db.table<Account, string>('accounts').toArray()
  const transactions = await db
    .table<FinanceTransaction, string>('financeTransactions')
    .toArray()
  const accountMap = new Map(accounts.map((account) => [account.id, account]))
  const timestamp = now()
  const snapshotId = `${MIGRATION_ID}:${db.name}`
  const backup = safetyDb(safetyDatabaseName)

  try {
    await backup.open()
    await backup.snapshots.put({
      id: snapshotId,
      createdAt: timestamp,
      sourceDatabase: db.name,
      accounts: accounts as unknown as Record<string, unknown>[],
      financeTransactions: transactions as unknown as Record<string, unknown>[],
    })

    const allocations: TransactionFundAllocation[] = []
    const reservations: FundReservation[] = []
    for (const transaction of transactions) {
      if (
        transaction.lifecycleStatus !== 'active' ||
        transaction.fundAllocationVersion ||
        !['expense', 'credit_purchase'].includes(transaction.type)
      ) continue
      const account = accountMap.get(transaction.accountId)
      if (!account || owns(account) !== 'self' || transaction.currency !== 'JPY') continue
      const effect = transaction.type === 'credit_purchase' ? 'reserve' : 'debit'
      const reservationId = effect === 'reserve'
        ? `fund-reservation:migration:${transaction.id}`
        : undefined
      allocations.push({
        id: `fund-allocation:migration:${transaction.id}`,
        transactionId: transaction.id,
        fundPoolId: LEGACY_UNSPECIFIED_POOL_ID,
        amountMinor: transaction.amountMinor,
        currency: transaction.currency,
        effect,
        ...(reservationId && { reservationId }),
        lifecycleStatus: 'active',
        createdAt: transaction.createdAt,
        updatedAt: timestamp,
      })
      if (reservationId) {
        reservations.push({
          id: reservationId,
          transactionId: transaction.id,
          creditAccountId: transaction.accountId,
          fundPoolId: LEGACY_UNSPECIFIED_POOL_ID,
          amountMinor: transaction.amountMinor,
          settledAmountMinor: 0,
          releasedAmountMinor: 0,
          currency: transaction.currency,
          status: 'active',
          createdAt: transaction.createdAt,
          updatedAt: timestamp,
        })
      }
    }

    const migratedIds = [...new Set(allocations.map((row) => row.transactionId))]
    const next: FinanceFundsMigrationState = {
      id: MIGRATION_ID,
      version: 3,
      status: 'complete',
      snapshotId,
      migratedTransactionCount: migratedIds.length,
      startedAt: current?.startedAt ?? timestamp,
      completedAt: now(),
    }

    await db.transaction(
      'rw',
      db.table('fundPools'),
      db.table('transactionFundAllocations'),
      db.table('fundReservations'),
      db.table('financeTransactions'),
      states,
      async () => {
        if (allocations.length > 0) {
          await db.table('fundPools').put(migrationPool(
            timestamp,
            allocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0),
          ))
          await db.table('transactionFundAllocations').bulkPut(allocations)
          if (reservations.length > 0) await db.table('fundReservations').bulkPut(reservations)
          await db.table('financeTransactions').bulkUpdate(
            migratedIds.map((id) => ({
              key: id,
              changes: { fundAllocationVersion: 1, updatedAt: timestamp },
            })),
          )
        }
        await states.put(next)
      },
    )
    return next
  } catch (error) {
    const failed: FinanceFundsMigrationState = {
      id: MIGRATION_ID,
      version: 3,
      status: 'failed',
      snapshotId,
      migratedTransactionCount: 0,
      startedAt: current?.startedAt ?? timestamp,
      error: error instanceof Error ? error.message : String(error),
    }
    await states.put(failed)
    throw error
  } finally {
    backup.close()
  }
}

export async function rollbackFinanceFundsMigration(db: Dexie): Promise<void> {
  const states = db.table<FinanceFundsMigrationState, string>('financeFundsMigrations')
  const timestamp = now()
  await db.transaction(
    'rw',
    db.table('fundPools'),
    db.table('transactionFundAllocations'),
    db.table('fundReservations'),
    db.table('financeTransactions'),
    states,
    async () => {
      const allocations = await db.table<TransactionFundAllocation>('transactionFundAllocations')
        .where('id').startsWith('fund-allocation:migration:').toArray()
      const transactionIds = [...new Set(allocations.map((row) => row.transactionId))]
      await db.table('transactionFundAllocations').where('id').startsWith('fund-allocation:migration:').delete()
      await db.table('fundReservations').where('id').startsWith('fund-reservation:migration:').delete()
      await db.table('fundPools').delete(LEGACY_UNSPECIFIED_POOL_ID)
      if (transactionIds.length > 0) {
        await db.table('financeTransactions').bulkUpdate(
          transactionIds.map((id) => ({
            key: id,
            changes: { fundAllocationVersion: undefined, updatedAt: timestamp },
          })),
        )
      }
      const current = await states.get(MIGRATION_ID)
      await states.put({
        id: MIGRATION_ID,
        version: 3,
        status: 'rolled_back',
        snapshotId: current?.snapshotId,
        migratedTransactionCount: current?.migratedTransactionCount ?? transactionIds.length,
        startedAt: current?.startedAt ?? timestamp,
        completedAt: timestamp,
      })
    },
  )
}
