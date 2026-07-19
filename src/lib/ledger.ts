import { db } from './db'
import { financeFundsV3Enabled } from '../config'
import { calculateFundPoolStates, prorateMinor } from './fundMath'
import type {
  Account,
  CreditCardSettlement,
  CurrencyCode,
  ExchangeRate,
  FinanceTransaction,
  FinanceTransactionType,
  FinanceTransfer,
  FundingParty,
  FundReservation,
  Merchant,
  Paycheck,
  TransactionFundAllocation,
} from './ledgerTypes'

const now = () => new Date().toISOString()

export function currencyDecimals(currency: CurrencyCode): number {
  return currency === 'JPY' ? 0 : 2
}

export function toMinor(amount: number, currency: CurrencyCode): number {
  if (!Number.isFinite(amount)) throw new Error('金额无效')
  return Math.round(amount * 10 ** currencyDecimals(currency))
}

export function fromMinor(amountMinor: number, currency: CurrencyCode): number {
  return amountMinor / 10 ** currencyDecimals(currency)
}

export function convertMinor(
  amountMinor: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rate: number,
): number {
  if (from === to) return amountMinor
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('汇率无效')
  return toMinor(fromMinor(amountMinor, from) * rate, to)
}

function clean(value?: string) {
  const result = value?.trim()
  return result || undefined
}

function positiveMinor(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('金额必须大于 0')
  return value
}

export function accountOwnership(account?: Account): FundingParty {
  if (!account) return 'self'
  return account.ownership ?? (account.kind === 'external' ? 'external' : 'self')
}

export function transactionFundingParty(
  transaction: FinanceTransaction,
  accounts: Map<string, Account>,
  linkedTransactions?: Map<string, FinanceTransaction>,
): FundingParty {
  if (transaction.fundingParty) return transaction.fundingParty
  if (transaction.type === 'refund' && transaction.linkedTransactionId) {
    const linked = linkedTransactions?.get(transaction.linkedTransactionId)
    if (linked) return transactionFundingParty(linked, accounts, linkedTransactions)
  }
  if (transaction.type === 'external_payment') return 'external'
  return accountOwnership(accounts.get(transaction.accountId))
}

export function transactionBalanceDeltas(
  transaction: FinanceTransaction,
  accounts: Map<string, Account>,
): Map<string, number> {
  const deltas = new Map<string, number>()
  if (transaction.lifecycleStatus !== 'active') return deltas
  const account = accounts.get(transaction.accountId)
  if (!account) return deltas
  const fundingParty = transactionFundingParty(transaction, accounts)
  const add = (id: string, value: number) => deltas.set(id, (deltas.get(id) ?? 0) + value)

  switch (transaction.type) {
    case 'expense':
      if (fundingParty === 'self' && account.kind === 'asset') add(account.id, -transaction.amountMinor)
      break
    case 'credit_purchase':
      if (fundingParty === 'self' && account.kind === 'credit') add(account.id, transaction.amountMinor)
      break
    case 'external_payment':
      break
    case 'income':
      if (account.kind === 'asset') add(account.id, transaction.amountMinor)
      break
    case 'refund':
      if (fundingParty === 'external') break
      if (account.kind === 'credit') add(account.id, -transaction.amountMinor)
      else if (account.kind === 'asset') add(account.id, transaction.amountMinor)
      break
    case 'transfer':
    case 'topup':
      if (account.kind === 'asset') add(account.id, -transaction.amountMinor)
      if (transaction.counterpartyAccountId) {
        const destination = accounts.get(transaction.counterpartyAccountId)
        if (destination?.kind === 'asset' && accountOwnership(destination) === 'self') {
          add(destination.id, transaction.counterpartyAmountMinor ?? transaction.amountMinor)
        }
      }
      break
    case 'credit_payment':
      if (account.kind === 'asset') add(account.id, -transaction.amountMinor)
      if (transaction.counterpartyAccountId) {
        const credit = accounts.get(transaction.counterpartyAccountId)
        if (credit?.kind === 'credit') {
          add(credit.id, -(transaction.counterpartyAmountMinor ?? transaction.amountMinor))
        }
      }
      break
    case 'initial_balance':
    case 'adjustment': {
      const sign = transaction.direction === 'outflow' ? -1 : 1
      add(account.id, sign * transaction.amountMinor)
      break
    }
  }
  return deltas
}

export function calculateAccountBalances(
  accounts: Account[],
  transactions: FinanceTransaction[],
): Map<string, number> {
  const accountMap = new Map(accounts.map((account) => [account.id, account]))
  const balances = new Map(
    accounts.map((account) => [account.id, account.openingBalanceMinor]),
  )
  for (const transaction of transactions) {
    for (const [accountId, delta] of transactionBalanceDeltas(transaction, accountMap)) {
      balances.set(accountId, (balances.get(accountId) ?? 0) + delta)
    }
  }
  return balances
}

export function findRate(
  rates: ExchangeRate[],
  from: CurrencyCode,
  to: CurrencyCode,
): number | undefined {
  if (from === to) return 1
  const direct = rates
    .filter((rate) => rate.baseCurrency === from && rate.quoteCurrency === to)
    .sort((a, b) => b.rateDate.localeCompare(a.rateDate))[0]
  if (direct) return direct.rate
  const inverse = rates
    .filter((rate) => rate.baseCurrency === to && rate.quoteCurrency === from)
    .sort((a, b) => b.rateDate.localeCompare(a.rateDate))[0]
  return inverse?.rate ? 1 / inverse.rate : undefined
}

export function ledgerSummary(opts: {
  accounts: Account[]
  transactions: FinanceTransaction[]
  rates: ExchangeRate[]
  reportingCurrency: CurrencyCode
  startDate?: string
  endDate?: string
}) {
  const activeAccounts = opts.accounts.filter((account) => account.lifecycleStatus === 'active')
  const activeTransactions = opts.transactions.filter(
    (transaction) =>
      transaction.lifecycleStatus === 'active' &&
      (!opts.startDate || transaction.localDate >= opts.startDate) &&
      (!opts.endDate || transaction.localDate <= opts.endDate),
  )
  const allBalanceTransactions = opts.transactions.filter(
    (transaction) => transaction.lifecycleStatus === 'active',
  )
  const balances = calculateAccountBalances(activeAccounts, allBalanceTransactions)
  const accountMap = new Map(activeAccounts.map((account) => [account.id, account]))
  const transactionMap = new Map(
    opts.transactions.map((transaction) => [transaction.id, transaction]),
  )
  let assetsMinor = 0
  let liabilitiesMinor = 0
  const missingRates = new Set<string>()
  const convert = (amountMinor: number, currency: CurrencyCode) => {
    const rate = findRate(opts.rates, currency, opts.reportingCurrency)
    if (rate === undefined) {
      missingRates.add(`${currency}/${opts.reportingCurrency}`)
      return 0
    }
    return convertMinor(amountMinor, currency, opts.reportingCurrency, rate)
  }

  for (const account of activeAccounts) {
    if (!account.includeInNetWorth || accountOwnership(account) === 'external') continue
    const converted = convert(balances.get(account.id) ?? 0, account.currency)
    if (account.kind === 'credit') liabilitiesMinor += converted
    else assetsMinor += converted
  }

  let actualPaidMinor = 0
  let externalPaidMinor = 0
  let incomeMinor = 0
  let assetAccountDecreaseMinor = 0
  for (const transaction of activeTransactions) {
    const reportAmount =
      transaction.reportingCurrency === opts.reportingCurrency &&
      Number.isSafeInteger(transaction.reportingAmountMinor)
        ? transaction.reportingAmountMinor!
        : convert(transaction.amountMinor, transaction.currency)
    const fundingParty = transactionFundingParty(transaction, accountMap, transactionMap)
    if (
      (transaction.type === 'external_payment' ||
        transaction.type === 'expense' ||
        transaction.type === 'credit_purchase') &&
      transaction.includeInSpending
    ) {
      if (fundingParty === 'external') externalPaidMinor += reportAmount
      else actualPaidMinor += reportAmount
    } else if (transaction.type === 'refund' && transaction.includeInSpending) {
      if (fundingParty === 'external') externalPaidMinor -= reportAmount
      else actualPaidMinor -= reportAmount
    } else if (transaction.type === 'income') {
      incomeMinor += reportAmount
    }
    if (
      fundingParty === 'self' &&
      (transaction.type === 'expense' ||
        transaction.type === 'credit_payment' ||
        (transaction.type === 'adjustment' && transaction.direction === 'outflow'))
    ) {
      assetAccountDecreaseMinor += reportAmount
    }
  }

  return {
    balances,
    assetsMinor,
    liabilitiesMinor,
    netWorthMinor: assetsMinor - liabilitiesMinor,
    actualPaidMinor,
    externalPaidMinor,
    consumptionMinor: actualPaidMinor + externalPaidMinor,
    incomeMinor,
    assetAccountDecreaseMinor,
    missingRates: [...missingRates],
  }
}

export async function saveAccount(input: {
  id?: string
  name: string
  kind: Account['kind']
  ownership?: Account['ownership']
  subtype: Account['subtype']
  currency: CurrencyCode
  openingBalanceMinor?: number
  includeInNetWorth?: boolean
  includeInSpending?: boolean
  institution?: string
  note?: string
  billingCycleDay?: number
  paymentDueDay?: number
  defaultPaymentAccountId?: string
}): Promise<string> {
  const name = clean(input.name)
  if (!name) throw new Error('请输入账户名称')
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new Error('币种必须使用 ISO 三字代码')
  for (const [label, value] of [
    ['账单日', input.billingCycleDay],
    ['还款日', input.paymentDueDay],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 31)) {
      throw new Error(`${label}必须是 1–31 之间的整数`)
    }
  }
  const existing = input.id ? await db.accounts.get(input.id) : undefined
  const ownership = input.ownership ?? existing?.ownership ?? (input.kind === 'external' ? 'external' : 'self')
  const timestamp = now()
  const id = input.id ?? crypto.randomUUID()
  await db.accounts.put({
    id,
    name,
    kind: input.kind,
    ownership,
    subtype: input.subtype,
    currency: input.currency,
    openingBalanceMinor: Math.round(input.openingBalanceMinor ?? existing?.openingBalanceMinor ?? 0),
    includeInNetWorth:
      ownership === 'external'
        ? false
        : input.includeInNetWorth ?? existing?.includeInNetWorth ?? input.kind !== 'external',
    includeInSpending:
      input.includeInSpending ?? existing?.includeInSpending ?? true,
    ...(clean(input.institution) && { institution: clean(input.institution) }),
    ...(clean(input.note) && { note: clean(input.note) }),
    rank: existing?.rank ?? Date.now().toString(36).padStart(10, '0'),
    ...(input.billingCycleDay && { billingCycleDay: input.billingCycleDay }),
    ...(input.paymentDueDay && { paymentDueDay: input.paymentDueDay }),
    ...(input.defaultPaymentAccountId && {
      defaultPaymentAccountId: input.defaultPaymentAccountId,
    }),
    ...(existing?.isArchived && { isArchived: true, archivedAt: existing.archivedAt }),
    lifecycleStatus: 'active',
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  })
  return id
}

export async function setAccountArchived(id: string, archived: boolean): Promise<void> {
  const account = await db.accounts.get(id)
  if (!account) return
  await db.accounts.update(id, {
    isArchived: archived,
    archivedAt: archived ? now() : undefined,
    updatedAt: now(),
  })
}

export async function moveAccount(id: string, direction: -1 | 1): Promise<void> {
  const accounts = await db.accounts.where('lifecycleStatus').equals('active').sortBy('rank')
  const index = accounts.findIndex((account) => account.id === id)
  const swapIndex = index + direction
  if (index < 0 || swapIndex < 0 || swapIndex >= accounts.length) return
  const current = accounts[index]
  const swap = accounts[swapIndex]
  const timestamp = now()
  await db.transaction('rw', db.accounts, async () => {
    await db.accounts.update(current.id, { rank: swap.rank, updatedAt: timestamp })
    await db.accounts.update(swap.id, { rank: current.rank, updatedAt: timestamp })
  })
}

export async function saveSpending(input: {
  id?: string
  amountMinor: number
  currency: CurrencyCode
  localDate: string
  accountId: string
  categoryId?: string
  merchantName?: string
  note?: string
  includeInSpending?: boolean
  reportingCurrency?: CurrencyCode
  reportingAmountMinor?: number
  exchangeRate?: number
  exchangeRateDate?: string
  exchangeRateSource?: string
  fundAllocations?: Array<{ fundPoolId: string; amountMinor: number }>
}): Promise<string> {
  positiveMinor(input.amountMinor)
  const account = await db.accounts.get(input.accountId)
  if (!account || account.lifecycleStatus !== 'active' || account.isArchived) throw new Error('请选择有效账户')
  if (account.currency !== input.currency) throw new Error('交易币种必须与支付账户一致')
  const category = input.categoryId
    ? await db.expenseCategories.get(input.categoryId)
    : undefined
  const existing = input.id ? await db.financeTransactions.get(input.id) : undefined
  const merchantName = clean(input.merchantName)
  const knownMerchants = merchantName ? await db.merchants.toArray() : []
  const knownMerchant = knownMerchants.find(
    (merchant) =>
      merchant.lifecycleStatus === 'active' &&
      merchant.name.localeCompare(merchantName!, undefined, { sensitivity: 'base' }) === 0,
  )
  const timestamp = now()
  // The payment account is the source of truth for new transactions. When an
  // existing transaction is edited without changing accounts, preserve its
  // historical funding snapshot even if the account is reclassified later.
  const fundingParty =
    existing?.accountId === account.id && existing.fundingParty
      ? existing.fundingParty
      : accountOwnership(account)
  const type: FinanceTransactionType =
    fundingParty === 'external'
      ? 'external_payment'
      : account.kind === 'credit'
      ? 'credit_purchase'
      : 'expense'
  const id = input.id ?? crypto.randomUUID()
  const merchant: Merchant | undefined = merchantName
    ? {
        id: knownMerchant?.id ?? crypto.randomUUID(),
        name: merchantName,
        ...(input.categoryId && { defaultCategoryId: input.categoryId }),
        defaultAccountId: account.id,
        defaultCurrency: input.currency,
        useCount: (knownMerchant?.useCount ?? 0) + (existing ? 0 : 1),
        lastUsedAt: timestamp,
        lifecycleStatus: 'active',
        createdAt: knownMerchant?.createdAt ?? timestamp,
        updatedAt: timestamp,
      }
    : undefined
  const row: FinanceTransaction = {
    id,
    type,
    amountMinor: input.amountMinor,
    currency: input.currency,
    // Keep the sortable timestamp aligned with the edited civil date. The
    // record identity/createdAt stay stable, but moving an expense to another
    // day must also move it in the transaction timeline.
    occurredAt: `${input.localDate}T12:00:00.000Z`,
    localDate: input.localDate,
    accountId: account.id,
    fundingParty,
    ...(input.categoryId && { categoryId: input.categoryId }),
    ...(category && { categoryNameSnapshot: category.name }),
    ...(merchant && { merchantId: merchant.id, merchantNameSnapshot: merchant.name }),
    ...(clean(input.note) && { note: clean(input.note) }),
    includeInSpending: input.includeInSpending ?? account.includeInSpending,
    affectsNetWorth: fundingParty === 'self' && accountOwnership(account) === 'self',
    ...(input.reportingCurrency && { reportingCurrency: input.reportingCurrency }),
    ...(Number.isSafeInteger(input.reportingAmountMinor) && {
      reportingAmountMinor: input.reportingAmountMinor,
    }),
    ...(input.exchangeRate && { exchangeRate: input.exchangeRate }),
    ...(input.exchangeRateDate && { exchangeRateDate: input.exchangeRateDate }),
    ...(input.exchangeRateSource && { exchangeRateSource: input.exchangeRateSource }),
    ...(financeFundsV3Enabled && fundingParty === 'self' && { fundAllocationVersion: 1 as const }),
    lifecycleStatus: 'active',
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }
  await db.transaction(
    'rw',
    [
      db.accounts,
      db.financeTransactions,
      db.merchants,
      db.fundPools,
      db.fundPoolTransfers,
      db.transactionFundAllocations,
      db.fundReservations,
    ],
    async () => {
    if (existing) {
      const linkedRefund = await db.financeTransactions
        .filter((candidate) =>
          candidate.lifecycleStatus === 'active' &&
          candidate.type === 'refund' &&
          candidate.linkedTransactionId === existing.id,
        )
        .first()
      if (linkedRefund) throw new Error('已有退款的消费不能直接修改，请先删除退款')
      const settledReservation = await db.fundReservations
        .where('transactionId')
        .equals(existing.id)
        .filter((reservation) => reservation.settledAmountMinor > 0)
        .first()
      if (settledReservation) throw new Error('已还款的信用卡消费不能直接修改')
    }

    const normalized = new Map<string, number>()
    for (const allocation of input.fundAllocations ?? []) {
      positiveMinor(allocation.amountMinor)
      normalized.set(
        allocation.fundPoolId,
        (normalized.get(allocation.fundPoolId) ?? 0) + allocation.amountMinor,
      )
    }
    const requested = [...normalized].map(([fundPoolId, amountMinor]) => ({ fundPoolId, amountMinor }))
    if (financeFundsV3Enabled && fundingParty === 'self') {
      if (requested.length === 0) throw new Error('请选择承担资金池')
      if (requested.reduce((sum, allocation) => sum + allocation.amountMinor, 0) !== input.amountMinor) {
        throw new Error('资金池分摊金额必须等于支出金额')
      }
    }
    if (fundingParty === 'external' && requested.length > 0) {
      throw new Error('外部代付默认不扣减本人的资金池')
    }

    const allTransactions = await db.financeTransactions
      .where('lifecycleStatus')
      .equals('active')
      .filter((transaction) => transaction.id !== id)
      .toArray()
    if (fundingParty === 'self' && account.kind === 'asset') {
      const allAccounts = await db.accounts.where('lifecycleStatus').equals('active').toArray()
      const available = calculateAccountBalances(allAccounts, allTransactions).get(account.id) ?? 0
      if (input.amountMinor > available) {
        throw new Error(`支付账户余额不足，差额 ${fromMinor(input.amountMinor - available, input.currency)}`)
      }
    }

    const [pools, allocations, transfers, reservations] = await Promise.all([
      db.fundPools.where('lifecycleStatus').equals('active').toArray(),
      db.transactionFundAllocations.where('lifecycleStatus').equals('active').filter((allocation) => allocation.transactionId !== id).toArray(),
      db.fundPoolTransfers.where('lifecycleStatus').equals('active').toArray(),
      db.fundReservations.filter((reservation) => reservation.transactionId !== id).toArray(),
    ])
    const poolMap = new Map(pools.map((pool) => [pool.id, pool]))
    const states = calculateFundPoolStates({ pools, allocations, transfers, reservations })
    for (const allocation of requested) {
      const pool = poolMap.get(allocation.fundPoolId)
      if (!pool || pool.currency !== input.currency) throw new Error('资金池不存在、已停用或币种不一致')
      const available = states.get(pool.id)?.availableMinor ?? 0
      if (allocation.amountMinor > available) {
        throw new Error(`${pool.name}可用金额不足，差额 ${fromMinor(allocation.amountMinor - available, pool.currency)}`)
      }
    }

    const effect = account.kind === 'credit' ? 'reserve' : 'debit'
    const nextAllocations: TransactionFundAllocation[] = requested.map((allocation) => {
      const reservationId = effect === 'reserve' ? `${id}:reservation:${allocation.fundPoolId}` : undefined
      return {
        id: `${id}:fund:${allocation.fundPoolId}:${effect}`,
        transactionId: id,
        fundPoolId: allocation.fundPoolId,
        amountMinor: allocation.amountMinor,
        currency: input.currency,
        effect,
        ...(reservationId && { reservationId }),
        lifecycleStatus: 'active',
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      }
    })
    const nextReservations: FundReservation[] = effect === 'reserve'
      ? requested.map((allocation) => ({
          id: `${id}:reservation:${allocation.fundPoolId}`,
          transactionId: id,
          creditAccountId: account.id,
          fundPoolId: allocation.fundPoolId,
          amountMinor: allocation.amountMinor,
          settledAmountMinor: 0,
          releasedAmountMinor: 0,
          currency: input.currency,
          status: 'active',
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        }))
      : []

    const oldAllocations = await db.transactionFundAllocations.where('transactionId').equals(id).toArray()
    const desiredAllocationIds = new Set(nextAllocations.map((allocation) => allocation.id))
    for (const old of oldAllocations) {
      if (!desiredAllocationIds.has(old.id)) {
        await db.transactionFundAllocations.update(old.id, {
          lifecycleStatus: 'deleted',
          deletedAt: timestamp,
          updatedAt: timestamp,
        })
      }
    }
    const oldReservations = await db.fundReservations.where('transactionId').equals(id).toArray()
    const desiredReservationIds = new Set(nextReservations.map((reservation) => reservation.id))
    for (const old of oldReservations) {
      if (!desiredReservationIds.has(old.id)) {
        await db.fundReservations.update(old.id, { status: 'voided', updatedAt: timestamp })
      }
    }
    if (merchant) await db.merchants.put(merchant)
    await db.financeTransactions.put(row)
    if (nextAllocations.length > 0) await db.transactionFundAllocations.bulkPut(nextAllocations)
    if (nextReservations.length > 0) await db.fundReservations.bulkPut(nextReservations)
  })
  return id
}

export async function saveIncome(input: {
  amountMinor: number
  currency: CurrencyCode
  localDate: string
  accountId: string
  note?: string
  paycheckId?: string
  reportingCurrency?: CurrencyCode
  reportingAmountMinor?: number
  exchangeRate?: number
  exchangeRateDate?: string
  exchangeRateSource?: string
}): Promise<string> {
  positiveMinor(input.amountMinor)
  const account = await db.accounts.get(input.accountId)
  if (!account || account.isArchived || account.kind !== 'asset' || accountOwnership(account) !== 'self' || account.currency !== input.currency) {
    throw new Error('收入必须进入同币种的个人资产账户')
  }
  const timestamp = now()
  const id = crypto.randomUUID()
  await db.financeTransactions.add({
    id,
    type: 'income',
    amountMinor: input.amountMinor,
    currency: input.currency,
    occurredAt: `${input.localDate}T12:00:00.000Z`,
    localDate: input.localDate,
    accountId: account.id,
    fundingParty: 'self',
    ...(clean(input.note) && { note: clean(input.note) }),
    ...(input.paycheckId && { paycheckId: input.paycheckId }),
    ...(input.reportingCurrency && { reportingCurrency: input.reportingCurrency }),
    ...(Number.isSafeInteger(input.reportingAmountMinor) && {
      reportingAmountMinor: input.reportingAmountMinor,
    }),
    ...(input.exchangeRate && { exchangeRate: input.exchangeRate }),
    ...(input.exchangeRateDate && { exchangeRateDate: input.exchangeRateDate }),
    ...(input.exchangeRateSource && { exchangeRateSource: input.exchangeRateSource }),
    includeInSpending: false,
    affectsNetWorth: true,
    reportingCurrency: input.currency,
    reportingAmountMinor: input.amountMinor,
    exchangeRate: 1,
    exchangeRateDate: input.localDate,
    exchangeRateSource: 'same-currency',
    lifecycleStatus: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  return id
}

export async function saveTransfer(input: {
  sourceAccountId: string
  destinationAccountId: string
  sourceAmountMinor: number
  destinationAmountMinor?: number
  localDate: string
  kind?: FinanceTransfer['kind']
  exchangeRate?: number
  note?: string
  dueDate?: string
}): Promise<{ transactionId: string; transferId: string; settlementId?: string }> {
  positiveMinor(input.sourceAmountMinor)
  const [source, destination] = await Promise.all([
    db.accounts.get(input.sourceAccountId),
    db.accounts.get(input.destinationAccountId),
  ])
  if (!source || !destination || source.isArchived || destination.isArchived) throw new Error('转出或转入账户不存在或已停用')
  if (source.kind !== 'asset' || accountOwnership(source) !== 'self') throw new Error('转出账户必须是个人资产账户')
  const kind = input.kind ?? (destination.kind === 'credit' ? 'credit_payment' : 'transfer')
  if (kind === 'credit_payment' && (destination.kind !== 'credit' || accountOwnership(destination) !== 'self')) {
    throw new Error('信用卡还款的目标必须是本人信用卡')
  }
  if (kind === 'topup' && (destination.kind !== 'asset' || accountOwnership(destination) !== 'self')) {
    throw new Error('充值目标必须是本人储值或资产账户')
  }
  if (kind === 'transfer' && (destination.kind !== 'asset' || accountOwnership(destination) !== 'self')) {
    throw new Error('普通转账的目标必须是本人资产账户')
  }
  const destinationAmountMinor = positiveMinor(
    input.destinationAmountMinor ?? input.sourceAmountMinor,
  )
  const [allAccounts, allTransactions] = await Promise.all([
    db.accounts.where('lifecycleStatus').equals('active').toArray(),
    db.financeTransactions.where('lifecycleStatus').equals('active').toArray(),
  ])
  const sourceBalance = calculateAccountBalances(allAccounts, allTransactions).get(source.id) ?? 0
  if (input.sourceAmountMinor > sourceBalance) {
    throw new Error(`转出账户余额不足，差额 ${fromMinor(input.sourceAmountMinor - sourceBalance, source.currency)}`)
  }
  const timestamp = now()
  const transactionId = crypto.randomUUID()
  const transferId = crypto.randomUUID()
  const transaction: FinanceTransaction = {
    id: transactionId,
    type: kind,
    amountMinor: input.sourceAmountMinor,
    currency: source.currency,
    occurredAt: `${input.localDate}T12:00:00.000Z`,
    localDate: input.localDate,
    accountId: source.id,
    fundingParty: 'self',
    counterpartyAccountId: destination.id,
    counterpartyAmountMinor: destinationAmountMinor,
    counterpartyCurrency: destination.currency,
    ...(clean(input.note) && { note: clean(input.note) }),
    includeInSpending: false,
    affectsNetWorth: kind === 'credit_payment',
    transferId,
    ...(financeFundsV3Enabled && kind === 'credit_payment' && { fundAllocationVersion: 1 as const }),
    lifecycleStatus: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const transfer: FinanceTransfer = {
    id: transferId,
    transactionId,
    sourceAccountId: source.id,
    destinationAccountId: destination.id,
    sourceAmountMinor: input.sourceAmountMinor,
    sourceCurrency: source.currency,
    destinationAmountMinor,
    destinationCurrency: destination.currency,
    ...(input.exchangeRate && { exchangeRate: input.exchangeRate }),
    kind,
    localDate: input.localDate,
    ...(clean(input.note) && { note: clean(input.note) }),
    lifecycleStatus: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  let settlement: CreditCardSettlement | undefined
  if (kind === 'credit_payment') {
    settlement = {
      id: crypto.randomUUID(),
      creditAccountId: destination.id,
      paymentAccountId: source.id,
      transferId,
      transactionId,
      ...(input.dueDate && { dueDate: input.dueDate }),
      amountMinor: destinationAmountMinor,
      currency: destination.currency,
      status: 'paid',
      paidAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  }
  await db.transaction(
    'rw',
    db.financeTransactions,
    db.financeTransfers,
    db.creditCardSettlements,
    db.transactionFundAllocations,
    db.fundReservations,
    async () => {
      await db.financeTransactions.add(transaction)
      await db.financeTransfers.add(transfer)
      if (settlement) await db.creditCardSettlements.add(settlement)
      if (financeFundsV3Enabled && kind === 'credit_payment') {
        let remaining = destinationAmountMinor
        const reservations = (await db.fundReservations
          .where('[creditAccountId+status]')
          .equals([destination.id, 'active'])
          .toArray())
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        const allocations: TransactionFundAllocation[] = []
        for (const reservation of reservations) {
          if (remaining <= 0) break
          const open = Math.max(
            0,
            reservation.amountMinor - reservation.settledAmountMinor - reservation.releasedAmountMinor,
          )
          const amountMinor = Math.min(open, remaining)
          if (amountMinor <= 0) continue
          remaining -= amountMinor
          const settledAmountMinor = reservation.settledAmountMinor + amountMinor
          const status = settledAmountMinor + reservation.releasedAmountMinor >= reservation.amountMinor
            ? 'settled'
            : 'active'
          await db.fundReservations.update(reservation.id, {
            settledAmountMinor,
            status,
            updatedAt: timestamp,
          })
          allocations.push({
            id: `${transactionId}:fund:${reservation.id}:debit`,
            transactionId,
            fundPoolId: reservation.fundPoolId,
            amountMinor,
            currency: reservation.currency,
            effect: 'debit',
            reservationId: reservation.id,
            lifecycleStatus: 'active',
            createdAt: timestamp,
            updatedAt: timestamp,
          })
        }
        if (allocations.length > 0) await db.transactionFundAllocations.bulkPut(allocations)
      }
    },
  )
  return { transactionId, transferId, ...(settlement && { settlementId: settlement.id }) }
}

export async function saveRefund(input: {
  amountMinor: number
  localDate: string
  linkedTransactionId: string
  note?: string
}): Promise<string> {
  positiveMinor(input.amountMinor)
  const id = crypto.randomUUID()
  await db.transaction(
    'rw',
    db.accounts,
    db.financeTransactions,
    db.transactionFundAllocations,
    db.fundReservations,
    async () => {
    // Validate and add in one write transaction so concurrent taps cannot both
    // observe the same remaining amount and over-refund the original purchase.
    const linked = await db.financeTransactions.get(input.linkedTransactionId)
    if (
      !linked ||
      linked.lifecycleStatus !== 'active' ||
      !['expense', 'credit_purchase', 'external_payment'].includes(linked.type)
    ) {
      throw new Error('请选择有效的原消费记录')
    }
    const account = await db.accounts.get(linked.accountId)
    if (!account || account.currency !== linked.currency) {
      throw new Error('原消费的账户或币种信息异常')
    }
    const transactions = await db.financeTransactions.toArray()
    const linkedRefunds = transactions
      .filter(
        (transaction) =>
          transaction.lifecycleStatus === 'active' &&
          transaction.type === 'refund' &&
          transaction.linkedTransactionId === linked.id,
      )
    const refundedMinor = linkedRefunds.reduce((sum, transaction) => sum + transaction.amountMinor, 0)
    if (refundedMinor + input.amountMinor > linked.amountMinor) {
      const remaining = Math.max(0, linked.amountMinor - refundedMinor)
      throw new Error(`退款超过可退金额，剩余 ${fromMinor(remaining, linked.currency)}`)
    }
    const fundingParty = transactionFundingParty(
      linked,
      new Map([[account.id, account]]),
    )
    const reportingAmountMinor = Number.isSafeInteger(linked.reportingAmountMinor)
      ? Math.round((linked.reportingAmountMinor! * input.amountMinor) / linked.amountMinor)
      : undefined
    const timestamp = now()
    const fundRows: TransactionFundAllocation[] = []
    if (financeFundsV3Enabled && fundingParty === 'self') {
      if (linked.type === 'expense') {
        const original = await db.transactionFundAllocations
          .where('transactionId')
          .equals(linked.id)
          .filter((allocation) => allocation.lifecycleStatus === 'active' && allocation.effect === 'debit')
          .toArray()
        for (const { row: allocation, amountMinor } of prorateMinor(original, input.amountMinor)) {
          fundRows.push({
            id: `${id}:fund:${allocation.fundPoolId}:credit`,
            transactionId: id,
            fundPoolId: allocation.fundPoolId,
            amountMinor,
            currency: allocation.currency,
            effect: 'credit',
            lifecycleStatus: 'active',
            createdAt: timestamp,
            updatedAt: timestamp,
          })
        }
      } else if (linked.type === 'credit_purchase') {
        let remaining = input.amountMinor
        const reservations = await db.fundReservations
          .where('transactionId')
          .equals(linked.id)
          .toArray()
        const openRows = reservations.map((reservation) => ({
          reservation,
          amountMinor: Math.max(
            0,
            reservation.amountMinor - reservation.settledAmountMinor - reservation.releasedAmountMinor,
          ),
        })).filter((row) => row.amountMinor > 0)
        const releaseTarget = Math.min(
          remaining,
          openRows.reduce((sum, row) => sum + row.amountMinor, 0),
        )
        for (const { row, amountMinor } of prorateMinor(openRows, releaseTarget)) {
          remaining -= amountMinor
          const releasedAmountMinor = row.reservation.releasedAmountMinor + amountMinor
          const status = releasedAmountMinor + row.reservation.settledAmountMinor >= row.reservation.amountMinor
            ? 'released'
            : 'active'
          await db.fundReservations.update(row.reservation.id, {
            releasedAmountMinor,
            status,
            updatedAt: timestamp,
          })
          fundRows.push({
            id: `${id}:fund:${row.reservation.id}:release`,
            transactionId: id,
            fundPoolId: row.reservation.fundPoolId,
            amountMinor,
            currency: row.reservation.currency,
            effect: 'release',
            reservationId: row.reservation.id,
            lifecycleStatus: 'active',
            createdAt: timestamp,
            updatedAt: timestamp,
          })
        }
        if (remaining > 0) {
          const previousRefundIds = new Set(linkedRefunds.map((refund) => refund.id))
          const previousCredits = (await db.transactionFundAllocations.toArray())
            .filter((allocation) =>
              allocation.lifecycleStatus === 'active' &&
              allocation.effect === 'credit' &&
              previousRefundIds.has(allocation.transactionId),
            )
          const creditedByPool = new Map<string, number>()
          for (const allocation of previousCredits) {
            creditedByPool.set(
              allocation.fundPoolId,
              (creditedByPool.get(allocation.fundPoolId) ?? 0) + allocation.amountMinor,
            )
          }
          const paidRows = reservations.map((reservation) => ({
            reservation,
            amountMinor: Math.max(
              0,
              reservation.settledAmountMinor - (creditedByPool.get(reservation.fundPoolId) ?? 0),
            ),
          })).filter((row) => row.amountMinor > 0)
          for (const { row, amountMinor } of prorateMinor(paidRows, remaining)) {
            fundRows.push({
              id: `${id}:fund:${row.reservation.fundPoolId}:credit`,
              transactionId: id,
              fundPoolId: row.reservation.fundPoolId,
              amountMinor,
              currency: row.reservation.currency,
              effect: 'credit',
              reservationId: row.reservation.id,
              lifecycleStatus: 'active',
              createdAt: timestamp,
              updatedAt: timestamp,
            })
          }
        }
      }
    }
    await db.financeTransactions.add({
      id,
      type: 'refund',
      amountMinor: input.amountMinor,
      currency: linked.currency,
      occurredAt: `${input.localDate}T12:00:00.000Z`,
      localDate: input.localDate,
      accountId: linked.accountId,
      fundingParty,
      linkedTransactionId: linked.id,
      ...(linked.categoryId && { categoryId: linked.categoryId }),
      ...(linked.categoryNameSnapshot && {
        categoryNameSnapshot: linked.categoryNameSnapshot,
      }),
      ...(linked.merchantId && { merchantId: linked.merchantId }),
      ...(linked.merchantNameSnapshot && {
        merchantNameSnapshot: linked.merchantNameSnapshot,
      }),
      ...(clean(input.note) && { note: clean(input.note) }),
      includeInSpending: linked.includeInSpending,
      affectsNetWorth: fundingParty === 'self' && accountOwnership(account) === 'self',
      ...(linked.reportingCurrency && { reportingCurrency: linked.reportingCurrency }),
      ...(reportingAmountMinor !== undefined && { reportingAmountMinor }),
      ...(linked.exchangeRate && { exchangeRate: linked.exchangeRate }),
      ...(linked.exchangeRateDate && { exchangeRateDate: linked.exchangeRateDate }),
      ...(linked.exchangeRateSource && { exchangeRateSource: linked.exchangeRateSource }),
      ...(financeFundsV3Enabled && fundingParty === 'self' && { fundAllocationVersion: 1 }),
      lifecycleStatus: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    if (fundRows.length > 0) await db.transactionFundAllocations.bulkPut(fundRows)
  })
  return id
}

export async function saveWorkTemplate(input: {
  id?: string
  name: string
  workContent?: string
  employer?: string
  workLocation?: string
  breakMinutes?: number
  paidBreak?: boolean
  hourlyRateMinor: number
  currency: CurrencyCode
  payoutAccountId?: string
  expectedPayDay?: number
}): Promise<string> {
  const name = clean(input.name)
  if (!name) throw new Error('请输入模板名称')
  const existing = input.id ? await db.workTemplates.get(input.id) : undefined
  const timestamp = now()
  const id = input.id ?? crypto.randomUUID()
  await db.workTemplates.put({
    id,
    name,
    ...(clean(input.workContent) && { workContent: clean(input.workContent) }),
    ...(clean(input.employer) && { employer: clean(input.employer) }),
    ...(clean(input.workLocation) && { workLocation: clean(input.workLocation) }),
    breakMinutes: Math.max(0, Math.round(input.breakMinutes ?? 0)),
    paidBreak: Boolean(input.paidBreak),
    hourlyRateMinor: Math.max(0, Math.round(input.hourlyRateMinor)),
    currency: input.currency,
    ...(input.payoutAccountId && { payoutAccountId: input.payoutAccountId }),
    ...(input.expectedPayDay && { expectedPayDay: input.expectedPayDay }),
    rank: existing?.rank ?? Date.now().toString(36).padStart(10, '0'),
    lifecycleStatus: 'active',
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  })
  return id
}

export async function saveWorkEntry(input: {
  id?: string
  date: string
  worked: boolean
  workContent?: string
  employer?: string
  workLocation?: string
  startTime?: string
  endTime?: string
  durationMinutes: number
  breakMinutes?: number
  paidBreak?: boolean
  hourlyRateMinor: number
  currency: CurrencyCode
  expectedPayDate?: string
  payoutAccountId?: string
  templateId?: string
  note?: string
}): Promise<string> {
  const existing = input.id ? await db.workEntries.get(input.id) : undefined
  if (existing?.settlementStatus === 'settled') throw new Error('已结算记录不能直接修改')
  const durationMinutes = input.worked ? Math.max(0, Math.round(input.durationMinutes)) : 0
  if (input.worked && durationMinutes <= 0) throw new Error('请输入有效工时')
  const hourlyRateMinor = Math.max(0, Math.round(input.hourlyRateMinor))
  const timestamp = now()
  const id = input.id ?? crypto.randomUUID()
  await db.workEntries.put({
    id,
    date: input.date,
    worked: input.worked,
    ...(clean(input.workContent) && { workContent: clean(input.workContent) }),
    ...(clean(input.employer) && { employer: clean(input.employer) }),
    ...(clean(input.workLocation) && { workLocation: clean(input.workLocation) }),
    ...(input.startTime && { startTime: input.startTime }),
    ...(input.endTime && { endTime: input.endTime }),
    durationMinutes,
    breakMinutes: Math.max(0, Math.round(input.breakMinutes ?? 0)),
    paidBreak: Boolean(input.paidBreak),
    hourlyRateMinor,
    currency: input.currency,
    estimatedGrossMinor: Math.round((durationMinutes / 60) * hourlyRateMinor),
    ...(input.expectedPayDate && { expectedPayDate: input.expectedPayDate }),
    ...(input.payoutAccountId && { payoutAccountId: input.payoutAccountId }),
    ...(input.templateId && { templateId: input.templateId }),
    ...(clean(input.note) && { note: clean(input.note) }),
    settlementStatus: 'unsettled',
    lifecycleStatus: 'active',
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  })
  return id
}

export async function settlePaycheck(input: {
  workEntryIds: string[]
  payoutAccountId: string
  actualAmountMinor: number
  currency: CurrencyCode
  paidDate: string
  note?: string
}): Promise<string> {
  positiveMinor(input.actualAmountMinor)
  const workEntryIds = [...new Set(input.workEntryIds)]
  if (!workEntryIds.length) throw new Error('请选择工作记录')
  const timestamp = now()
  const paycheckId = crypto.randomUUID()
  const transactionId = crypto.randomUUID()
  await db.transaction('rw', db.accounts, db.paychecks, db.financeTransactions, db.workEntries, async () => {
    // Read and validate inside the write transaction. Concurrent taps then
    // serialize, and the second attempt observes the settled snapshot.
    const entries = await db.workEntries.bulkGet(workEntryIds)
    if (entries.some((entry) => !entry || entry.lifecycleStatus !== 'active')) {
      throw new Error('包含不存在的工作记录')
    }
    if (entries.some((entry) => entry?.settlementStatus === 'settled')) {
      throw new Error('同一工作记录不能重复入账')
    }
    if (entries.some((entry) => entry?.currency !== input.currency)) {
      throw new Error('不同币种的工作记录需要分开入账')
    }
    const account = await db.accounts.get(input.payoutAccountId)
    if (!account || account.kind !== 'asset' || accountOwnership(account) !== 'self' || account.currency !== input.currency) {
      throw new Error('工资入账账户无效或币种不一致')
    }
    const paycheck: Paycheck = {
      id: paycheckId,
      workEntryIds,
      payoutAccountId: input.payoutAccountId,
      currency: input.currency,
      estimatedAmountMinor: entries.reduce(
        (sum, entry) => sum + (entry?.estimatedGrossMinor ?? 0),
        0,
      ),
      actualAmountMinor: input.actualAmountMinor,
      paidAt: timestamp,
      incomeTransactionId: transactionId,
      status: 'paid',
      ...(clean(input.note) && { note: clean(input.note) }),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const transaction: FinanceTransaction = {
      id: transactionId,
      type: 'income',
      amountMinor: input.actualAmountMinor,
      currency: input.currency,
      occurredAt: `${input.paidDate}T12:00:00.000Z`,
      localDate: input.paidDate,
      accountId: account.id,
      fundingParty: 'self',
      note: clean(input.note) ?? '工资实际入账',
      includeInSpending: false,
      affectsNetWorth: true,
      paycheckId,
      reportingCurrency: input.currency,
      reportingAmountMinor: input.actualAmountMinor,
      exchangeRate: 1,
      exchangeRateDate: input.paidDate,
      exchangeRateSource: 'same-currency',
      lifecycleStatus: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.paychecks.add(paycheck)
    await db.financeTransactions.add(transaction)
    await db.workEntries.bulkUpdate(
      workEntryIds.map((id) => ({
        key: id,
        changes: { settlementStatus: 'settled', paycheckId, updatedAt: timestamp },
      })),
    )
  })
  return paycheckId
}

export async function softDeleteFinanceTransaction(id: string): Promise<void> {
  const timestamp = now()
  const transaction = await db.financeTransactions.get(id)
  if (!transaction) return
  if (transaction.paycheckId) throw new Error('工资入账请从工资结算中撤销')
  if (transaction.type === 'credit_purchase') {
    const settled = await db.fundReservations
      .where('transactionId')
      .equals(transaction.id)
      .filter((reservation) => reservation.settledAmountMinor > 0)
      .first()
    if (settled) throw new Error('该信用卡消费已经还款，不能直接删除')
  }
  if (['expense', 'credit_purchase', 'external_payment'].includes(transaction.type)) {
    const linkedRefund = await db.financeTransactions
      .filter(
        (candidate) =>
          candidate.lifecycleStatus === 'active' &&
          candidate.type === 'refund' &&
          candidate.linkedTransactionId === transaction.id,
      )
      .first()
    if (linkedRefund) throw new Error('请先删除该消费的关联退款')
  }
  await db.transaction(
    'rw',
    db.financeTransactions,
    db.financeTransfers,
    db.creditCardSettlements,
    db.transactionFundAllocations,
    db.fundReservations,
    async () => {
      await db.financeTransactions.update(id, {
        lifecycleStatus: 'deleted',
        deletedAt: timestamp,
        updatedAt: timestamp,
      })
      if (transaction.transferId) {
        await db.financeTransfers.update(transaction.transferId, {
          lifecycleStatus: 'deleted',
          updatedAt: timestamp,
        })
        const settlement = await db.creditCardSettlements
          .where('transactionId')
          .equals(id)
          .first()
        if (settlement) {
          await db.creditCardSettlements.update(settlement.id, {
            status: 'voided',
            updatedAt: timestamp,
          })
        }
      }
      const fundRows = await db.transactionFundAllocations
        .where('transactionId')
        .equals(id)
        .filter((allocation) => allocation.lifecycleStatus === 'active')
        .toArray()
      for (const allocation of fundRows) {
        if (allocation.reservationId) {
          const reservation = await db.fundReservations.get(allocation.reservationId)
          if (reservation) {
            if (transaction.type === 'credit_payment' && allocation.effect === 'debit') {
              const settledAmountMinor = Math.max(0, reservation.settledAmountMinor - allocation.amountMinor)
              await db.fundReservations.update(reservation.id, {
                settledAmountMinor,
                status: settledAmountMinor + reservation.releasedAmountMinor >= reservation.amountMinor
                  ? reservation.status
                  : 'active',
                updatedAt: timestamp,
              })
            } else if (transaction.type === 'refund' && allocation.effect === 'release') {
              const releasedAmountMinor = Math.max(0, reservation.releasedAmountMinor - allocation.amountMinor)
              await db.fundReservations.update(reservation.id, {
                releasedAmountMinor,
                status: reservation.settledAmountMinor + releasedAmountMinor >= reservation.amountMinor
                  ? reservation.status
                  : 'active',
                updatedAt: timestamp,
              })
            }
          }
        }
        await db.transactionFundAllocations.update(allocation.id, {
          lifecycleStatus: 'deleted',
          deletedAt: timestamp,
          updatedAt: timestamp,
        })
      }
      if (transaction.type === 'credit_purchase') {
        await db.fundReservations
          .where('transactionId')
          .equals(transaction.id)
          .modify({ status: 'voided', updatedAt: timestamp })
      }
    },
  )
}
