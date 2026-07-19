import { db } from './db'
import { appendRank } from './rank'
import { accountOwnership, calculateAccountBalances } from './ledger'
import { calculateFundPoolStates } from './fundMath'
import type {
  BudgetPlan,
  CurrencyCode,
  FinancialProjection,
  FundPoolPurpose,
  SavingsGoal,
} from './ledgerTypes'

const now = () => new Date().toISOString()

function positiveMinor(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('金额必须大于 0')
  return value
}

export async function loadFundPoolStates(excludeTransactionId?: string, excludeTransferId?: string) {
  const [pools, allocations, transfers, reservations] = await Promise.all([
    db.fundPools.where('lifecycleStatus').equals('active').sortBy('rank'),
    db.transactionFundAllocations.where('lifecycleStatus').equals('active').toArray(),
    db.fundPoolTransfers.where('lifecycleStatus').equals('active').toArray(),
    db.fundReservations.toArray(),
  ])
  return {
    pools,
    states: calculateFundPoolStates({
      pools,
      allocations: excludeTransactionId
        ? allocations.filter((row) => row.transactionId !== excludeTransactionId)
        : allocations,
      transfers: excludeTransferId
        ? transfers.filter((row) => row.id !== excludeTransferId)
        : transfers,
      reservations: excludeTransactionId
        ? reservations.filter((row) => row.transactionId !== excludeTransactionId)
        : reservations,
    }),
  }
}

export async function actualAssetBalanceByCurrency() {
  const [accounts, transactions] = await Promise.all([
    db.accounts.where('lifecycleStatus').equals('active').toArray(),
    db.financeTransactions.where('lifecycleStatus').equals('active').toArray(),
  ])
  const balances = calculateAccountBalances(accounts, transactions)
  const result = new Map<CurrencyCode, number>()
  for (const account of accounts) {
    if (account.kind !== 'asset' || accountOwnership(account) !== 'self') continue
    result.set(account.currency, (result.get(account.currency) ?? 0) + (balances.get(account.id) ?? 0))
  }
  return result
}

export async function unallocatedByCurrency(excludeTransferId?: string) {
  const [assets, { pools, states }] = await Promise.all([
    actualAssetBalanceByCurrency(),
    loadFundPoolStates(undefined, excludeTransferId),
  ])
  const result = new Map(assets)
  for (const pool of pools) {
    result.set(pool.currency, (result.get(pool.currency) ?? 0) - (states.get(pool.id)?.grossMinor ?? 0))
  }
  return result
}

export async function saveFundPool(input: {
  id?: string
  name: string
  purpose: FundPoolPurpose
  currency: CurrencyCode
  accountId?: string
  openingBalanceMinor?: number
  includeInDisposable?: boolean
  includeInSavings?: boolean
  restricted?: boolean
  colorToken?: string
  icon?: string
}): Promise<string> {
  const name = input.name.trim()
  if (!name) throw new Error('请输入资金池名称')
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new Error('币种必须使用 ISO 三字代码')
  const existing = input.id ? await db.fundPools.get(input.id) : undefined
  const active = await db.fundPools.where('lifecycleStatus').equals('active').sortBy('rank')
  const duplicate = active.find((pool) =>
    pool.id !== input.id && pool.name.localeCompare(name, undefined, { sensitivity: 'base' }) === 0,
  )
  if (duplicate) throw new Error('已经存在同名资金池')
  if (input.accountId) {
    const account = await db.accounts.get(input.accountId)
    if (!account || account.currency !== input.currency || accountOwnership(account) !== 'self') {
      throw new Error('关联账户不存在、属于外部或币种不一致')
    }
  }
  const openingBalanceMinor = Math.max(0, Math.round(input.openingBalanceMinor ?? existing?.openingBalanceMinor ?? 0))
  if (!existing && openingBalanceMinor > 0) {
    const unallocated = await unallocatedByCurrency()
    if (openingBalanceMinor > (unallocated.get(input.currency) ?? 0)) {
      throw new Error('未分配资金不足，不能创建超过实际资产的资金池')
    }
  }
  const timestamp = now()
  const id = input.id ?? crypto.randomUUID()
  const savingsPurpose = ['savings', 'emergency', 'travel'].includes(input.purpose)
  await db.fundPools.put({
    id,
    name,
    purpose: input.purpose,
    currency: input.currency,
    ...(input.accountId && { accountId: input.accountId }),
    openingBalanceMinor,
    includeInDisposable: input.includeInDisposable ?? existing?.includeInDisposable ?? input.purpose === 'free',
    includeInSavings: input.includeInSavings ?? existing?.includeInSavings ?? savingsPurpose,
    restricted: input.restricted ?? existing?.restricted ?? input.purpose !== 'free',
    ...(input.colorToken && { colorToken: input.colorToken }),
    ...(input.icon && { icon: input.icon }),
    rank: existing?.rank ?? appendRank(active.at(-1)?.rank),
    lifecycleStatus: 'active',
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  })
  return id
}

export async function setFundPoolArchived(id: string): Promise<void> {
  const { states } = await loadFundPoolStates()
  const state = states.get(id)
  if (state && (state.grossMinor !== 0 || state.reservedMinor !== 0)) {
    throw new Error('请先将余额和锁定金额转出，再停用资金池')
  }
  const timestamp = now()
  await db.fundPools.update(id, {
    lifecycleStatus: 'deleted',
    deletedAt: timestamp,
    updatedAt: timestamp,
  })
}

export async function saveFundPoolTransfer(input: {
  id?: string
  sourcePoolId?: string
  destinationPoolId?: string
  amountMinor: number
  currency: CurrencyCode
  localDate: string
  note?: string
}): Promise<string> {
  positiveMinor(input.amountMinor)
  if (!input.sourcePoolId && !input.destinationPoolId) throw new Error('请选择原资金池或目标资金池')
  if (input.sourcePoolId === input.destinationPoolId) throw new Error('原资金池与目标资金池不能相同')
  const [source, destination, existing] = await Promise.all([
    input.sourcePoolId ? db.fundPools.get(input.sourcePoolId) : undefined,
    input.destinationPoolId ? db.fundPools.get(input.destinationPoolId) : undefined,
    input.id ? db.fundPoolTransfers.get(input.id) : undefined,
  ])
  for (const pool of [source, destination]) {
    if (pool && (pool.lifecycleStatus !== 'active' || pool.currency !== input.currency)) {
      throw new Error('资金池不存在、已停用或币种不一致')
    }
  }
  const { states } = await loadFundPoolStates(undefined, existing?.id)
  if (source && input.amountMinor > (states.get(source.id)?.availableMinor ?? 0)) {
    throw new Error('原资金池可用金额不足')
  }
  if (!source) {
    const unallocated = await unallocatedByCurrency(existing?.id)
    if (input.amountMinor > (unallocated.get(input.currency) ?? 0)) throw new Error('未分配资金不足')
  }
  const timestamp = now()
  const id = input.id ?? crypto.randomUUID()
  await db.fundPoolTransfers.put({
    id,
    ...(source && { sourcePoolId: source.id }),
    ...(destination && { destinationPoolId: destination.id }),
    amountMinor: input.amountMinor,
    currency: input.currency,
    localDate: input.localDate,
    ...(input.note?.trim() && { note: input.note.trim() }),
    lifecycleStatus: 'active',
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  })
  return id
}

export async function softDeleteFundPoolTransfer(id: string) {
  const timestamp = now()
  await db.fundPoolTransfers.update(id, {
    lifecycleStatus: 'deleted',
    deletedAt: timestamp,
    updatedAt: timestamp,
  })
}

export async function saveSavingsGoal(input: {
  id?: string
  name: string
  fundPoolId: string
  targetAmountMinor: number
  targetDate?: string
}) {
  const pool = await db.fundPools.get(input.fundPoolId)
  if (!pool || pool.lifecycleStatus !== 'active' || !pool.includeInSavings) throw new Error('请选择储蓄类资金池')
  positiveMinor(input.targetAmountMinor)
  const existing = input.id ? await db.savingsGoals.get(input.id) : undefined
  const active = await db.savingsGoals.where('lifecycleStatus').equals('active').sortBy('rank')
  const timestamp = now()
  const id = input.id ?? crypto.randomUUID()
  const row: SavingsGoal = {
    id,
    name: input.name.trim() || pool.name,
    fundPoolId: pool.id,
    targetAmountMinor: input.targetAmountMinor,
    currency: pool.currency,
    ...(input.targetDate && { targetDate: input.targetDate }),
    rank: existing?.rank ?? appendRank(active.at(-1)?.rank),
    lifecycleStatus: 'active',
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }
  await db.savingsGoals.put(row)
  return id
}

export async function saveBudgetPlan(input: Omit<BudgetPlan, 'id' | 'createdAt' | 'updatedAt'>) {
  const id = `budget:${input.month}:${input.currency}`
  const existing = await db.budgetPlans.get(id)
  const timestamp = now()
  await db.budgetPlans.put({
    ...input,
    id,
    expectedIncomeMinor: Math.max(0, Math.round(input.expectedIncomeMinor)),
    remainingLivingBudgetMinor: Math.max(0, Math.round(input.remainingLivingBudgetMinor)),
    plannedExpenseMinor: Math.max(0, Math.round(input.plannedExpenseMinor)),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  })
  return id
}

export function calculateFinancialProjection(input: Omit<FinancialProjection, 'id' | 'projectedSavingsMinor' | 'calculatedAt' | 'assumptionsVersion'>): FinancialProjection {
  return {
    ...input,
    id: `projection:${input.month}:${input.currency}`,
    projectedSavingsMinor:
      input.expectedIncomeMinor -
      input.recurringExpenseMinor -
      input.occurredExpenseMinor -
      input.plannedExpenseMinor -
      input.remainingLivingBudgetMinor,
    calculatedAt: now(),
    assumptionsVersion: 1,
  }
}
