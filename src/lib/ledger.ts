import { db } from './db'
import type {
  Account,
  CreditCardSettlement,
  CurrencyCode,
  ExchangeRate,
  FinanceTransaction,
  FinanceTransactionType,
  FinanceTransfer,
  Merchant,
  Paycheck,
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

export function transactionBalanceDeltas(
  transaction: FinanceTransaction,
  accounts: Map<string, Account>,
): Map<string, number> {
  const deltas = new Map<string, number>()
  if (transaction.lifecycleStatus !== 'active') return deltas
  const account = accounts.get(transaction.accountId)
  if (!account) return deltas
  const add = (id: string, value: number) => deltas.set(id, (deltas.get(id) ?? 0) + value)

  switch (transaction.type) {
    case 'expense':
      if (account.kind === 'asset') add(account.id, -transaction.amountMinor)
      break
    case 'credit_purchase':
      if (account.kind === 'credit') add(account.id, transaction.amountMinor)
      break
    case 'external_payment':
      break
    case 'income':
      if (account.kind === 'asset') add(account.id, transaction.amountMinor)
      break
    case 'refund':
      if (account.kind === 'credit') add(account.id, -transaction.amountMinor)
      else if (account.kind === 'asset') add(account.id, transaction.amountMinor)
      break
    case 'transfer':
    case 'topup':
      if (account.kind === 'asset') add(account.id, -transaction.amountMinor)
      if (transaction.counterpartyAccountId) {
        const destination = accounts.get(transaction.counterpartyAccountId)
        if (destination?.kind === 'asset') {
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
    if (!account.includeInNetWorth || account.kind === 'external') continue
    const converted = convert(balances.get(account.id) ?? 0, account.currency)
    if (account.kind === 'credit') liabilitiesMinor += converted
    else assetsMinor += converted
  }

  let actualPaidMinor = 0
  let externalPaidMinor = 0
  let incomeMinor = 0
  for (const transaction of activeTransactions) {
    const reportAmount =
      transaction.reportingCurrency === opts.reportingCurrency &&
      Number.isSafeInteger(transaction.reportingAmountMinor)
        ? transaction.reportingAmountMinor!
        : convert(transaction.amountMinor, transaction.currency)
    if (transaction.type === 'external_payment' && transaction.includeInSpending) {
      externalPaidMinor += reportAmount
    } else if (
      (transaction.type === 'expense' || transaction.type === 'credit_purchase') &&
      transaction.includeInSpending
    ) {
      actualPaidMinor += reportAmount
    } else if (transaction.type === 'refund' && transaction.includeInSpending) {
      if (transaction.accountId && activeAccounts.find((a) => a.id === transaction.accountId)?.kind === 'external') {
        externalPaidMinor -= reportAmount
      } else actualPaidMinor -= reportAmount
    } else if (transaction.type === 'income') {
      incomeMinor += reportAmount
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
    missingRates: [...missingRates],
  }
}

export async function saveAccount(input: {
  id?: string
  name: string
  kind: Account['kind']
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
  const timestamp = now()
  const id = input.id ?? crypto.randomUUID()
  await db.accounts.put({
    id,
    name,
    kind: input.kind,
    subtype: input.subtype,
    currency: input.currency,
    openingBalanceMinor: Math.round(input.openingBalanceMinor ?? existing?.openingBalanceMinor ?? 0),
    includeInNetWorth:
      input.includeInNetWorth ?? existing?.includeInNetWorth ?? input.kind !== 'external',
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
  const type: FinanceTransactionType =
    account.kind === 'credit'
      ? 'credit_purchase'
      : account.kind === 'external'
        ? 'external_payment'
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
    occurredAt: existing?.occurredAt ?? `${input.localDate}T12:00:00.000Z`,
    localDate: input.localDate,
    accountId: account.id,
    ...(input.categoryId && { categoryId: input.categoryId }),
    ...(category && { categoryNameSnapshot: category.name }),
    ...(merchant && { merchantId: merchant.id, merchantNameSnapshot: merchant.name }),
    ...(clean(input.note) && { note: clean(input.note) }),
    includeInSpending: input.includeInSpending ?? account.includeInSpending,
    affectsNetWorth: account.kind !== 'external',
    ...(input.reportingCurrency && { reportingCurrency: input.reportingCurrency }),
    ...(Number.isSafeInteger(input.reportingAmountMinor) && {
      reportingAmountMinor: input.reportingAmountMinor,
    }),
    ...(input.exchangeRate && { exchangeRate: input.exchangeRate }),
    ...(input.exchangeRateDate && { exchangeRateDate: input.exchangeRateDate }),
    ...(input.exchangeRateSource && { exchangeRateSource: input.exchangeRateSource }),
    lifecycleStatus: 'active',
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }
  await db.transaction('rw', db.financeTransactions, db.merchants, async () => {
    if (merchant) await db.merchants.put(merchant)
    await db.financeTransactions.put(row)
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
}): Promise<string> {
  positiveMinor(input.amountMinor)
  const account = await db.accounts.get(input.accountId)
  if (!account || account.isArchived || account.kind !== 'asset' || account.currency !== input.currency) {
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
    ...(clean(input.note) && { note: clean(input.note) }),
    ...(input.paycheckId && { paycheckId: input.paycheckId }),
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
  if (source.kind !== 'asset') throw new Error('转出账户必须是个人资产账户')
  const kind = input.kind ?? (destination.kind === 'credit' ? 'credit_payment' : 'transfer')
  if (kind === 'credit_payment' && destination.kind !== 'credit') {
    throw new Error('信用卡还款的目标必须是本人信用卡')
  }
  if (kind !== 'credit_payment' && destination.kind !== 'asset') {
    throw new Error('普通转账或充值的目标必须是个人资产账户')
  }
  const destinationAmountMinor = positiveMinor(
    input.destinationAmountMinor ?? input.sourceAmountMinor,
  )
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
    counterpartyAccountId: destination.id,
    counterpartyAmountMinor: destinationAmountMinor,
    counterpartyCurrency: destination.currency,
    ...(clean(input.note) && { note: clean(input.note) }),
    includeInSpending: false,
    affectsNetWorth: kind === 'credit_payment',
    transferId,
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
    async () => {
      await db.financeTransactions.add(transaction)
      await db.financeTransfers.add(transfer)
      if (settlement) await db.creditCardSettlements.add(settlement)
    },
  )
  return { transactionId, transferId, ...(settlement && { settlementId: settlement.id }) }
}

export async function saveRefund(input: {
  amountMinor: number
  currency: CurrencyCode
  localDate: string
  accountId: string
  linkedTransactionId?: string
  note?: string
  includeInSpending?: boolean
}): Promise<string> {
  positiveMinor(input.amountMinor)
  const account = await db.accounts.get(input.accountId)
  if (!account || account.kind === 'external' || account.currency !== input.currency) {
    throw new Error('退款账户无效或币种不一致')
  }
  const timestamp = now()
  const id = crypto.randomUUID()
  await db.financeTransactions.add({
    id,
    type: 'refund',
    amountMinor: input.amountMinor,
    currency: input.currency,
    occurredAt: `${input.localDate}T12:00:00.000Z`,
    localDate: input.localDate,
    accountId: input.accountId,
    ...(input.linkedTransactionId && { linkedTransactionId: input.linkedTransactionId }),
    ...(clean(input.note) && { note: clean(input.note) }),
    includeInSpending: input.includeInSpending ?? true,
    affectsNetWorth: true,
    lifecycleStatus: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
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
  const entries = await db.workEntries.bulkGet(input.workEntryIds)
  if (entries.some((entry) => !entry || entry.lifecycleStatus !== 'active')) {
    throw new Error('包含不存在的工作记录')
  }
  if (entries.some((entry) => entry?.settlementStatus === 'settled')) {
    throw new Error('同一工作记录不能重复入账')
  }
  const account = await db.accounts.get(input.payoutAccountId)
  if (!account || account.kind !== 'asset' || account.currency !== input.currency) {
    throw new Error('工资入账账户无效或币种不一致')
  }
  const timestamp = now()
  const paycheckId = crypto.randomUUID()
  const transactionId = crypto.randomUUID()
  const paycheck: Paycheck = {
    id: paycheckId,
    workEntryIds: [...input.workEntryIds],
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
  await db.transaction('rw', db.paychecks, db.financeTransactions, db.workEntries, async () => {
    await db.paychecks.add(paycheck)
    await db.financeTransactions.add(transaction)
    await db.workEntries.bulkUpdate(
      input.workEntryIds.map((id) => ({
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
  await db.transaction(
    'rw',
    db.financeTransactions,
    db.financeTransfers,
    db.creditCardSettlements,
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
    },
  )
}
