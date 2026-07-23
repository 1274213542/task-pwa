import { db } from './db'
import type {
  Account,
  CreditCardSettlement,
  CurrencyCode,
  ExchangeRate,
  FinanceTransaction,
  FinanceTransactionType,
  FinanceTransfer,
  FundingParty,
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

export function accountOwnership(account?: Account): FundingParty {
  if (!account) return 'self'
  return account.ownership ?? (account.kind === 'external' ? 'external' : 'self')
}

export function accountCurrencies(account?: Account): CurrencyCode[] {
  if (!account) return []
  return [...new Set([account.currency, ...(account.supportedCurrencies ?? [])])]
}

export function accountSupportsCurrency(account: Account | undefined, currency: CurrencyCode): boolean {
  return Boolean(account && accountCurrencies(account).includes(currency))
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
  const deltasByCurrency = transactionBalanceDeltasByCurrency(transaction, accounts)
  const deltas = new Map<string, number>()
  for (const [accountId, currencyDeltas] of deltasByCurrency) {
    const account = accounts.get(accountId)
    if (!account) continue
    deltas.set(accountId, currencyDeltas.get(account.currency) ?? 0)
  }
  return deltas
}

export function transactionBalanceDeltasByCurrency(
  transaction: FinanceTransaction,
  accounts: Map<string, Account>,
): Map<string, Map<CurrencyCode, number>> {
  const deltas = new Map<string, Map<CurrencyCode, number>>()
  if (transaction.lifecycleStatus !== 'active') return deltas
  const account = accounts.get(transaction.accountId)
  if (!account) return deltas
  const fundingParty = transactionFundingParty(transaction, accounts)
  const add = (id: string, currency: CurrencyCode, value: number) => {
    const accountDeltas = deltas.get(id) ?? new Map<CurrencyCode, number>()
    accountDeltas.set(currency, (accountDeltas.get(currency) ?? 0) + value)
    deltas.set(id, accountDeltas)
  }
  switch (transaction.type) {
    case 'expense':
      if (fundingParty === 'self' && account.kind === 'asset') {
        add(account.id, transaction.currency, -transaction.amountMinor)
      }
      break
    case 'credit_purchase':
      if (fundingParty === 'self' && account.kind === 'credit') {
        add(account.id, transaction.currency, transaction.amountMinor)
      }
      break
    case 'external_payment':
      break
    case 'income':
      if (account.kind === 'asset') add(account.id, transaction.currency, transaction.amountMinor)
      break
    case 'refund':
      if (fundingParty === 'external') break
      if (account.kind === 'credit') add(account.id, transaction.currency, -transaction.amountMinor)
      else if (account.kind === 'asset') add(account.id, transaction.currency, transaction.amountMinor)
      break
    case 'transfer':
    case 'topup':
      if (account.kind === 'asset') {
        add(
          account.id,
          transaction.currency,
          -(transaction.amountMinor + (transaction.feeMinor ?? 0)),
        )
      }
      if (transaction.counterpartyAccountId) {
        const destination = accounts.get(transaction.counterpartyAccountId)
        if (destination?.kind === 'asset' && accountOwnership(destination) === 'self') {
          add(
            destination.id,
            transaction.counterpartyCurrency ?? destination.currency,
            transaction.counterpartyAmountMinor ?? transaction.amountMinor,
          )
        }
      }
      break
    case 'credit_payment':
      if (account.kind === 'asset') {
        add(
          account.id,
          transaction.currency,
          -(transaction.amountMinor + (transaction.feeMinor ?? 0)),
        )
      }
      if (transaction.counterpartyAccountId) {
        const credit = accounts.get(transaction.counterpartyAccountId)
        if (credit?.kind === 'credit') {
          add(
            credit.id,
            transaction.counterpartyCurrency ?? credit.currency,
            -(transaction.counterpartyAmountMinor ?? transaction.amountMinor),
          )
        }
      }
      break
    case 'initial_balance':
    case 'adjustment': {
      const sign = transaction.direction === 'outflow' ? -1 : 1
      add(account.id, transaction.currency, sign * transaction.amountMinor)
      break
    }
  }
  return deltas
}

export function calculateAccountBalancesByCurrency(
  accounts: Account[],
  transactions: FinanceTransaction[],
): Map<string, Map<CurrencyCode, number>> {
  const accountMap = new Map(accounts.map((account) => [account.id, account]))
  const balances = new Map<string, Map<CurrencyCode, number>>()
  for (const account of accounts) {
    const openingCurrency = account.openingBalanceCurrency ?? account.currency
    balances.set(
      account.id,
      new Map([[openingCurrency, account.openingBalanceMinor]]),
    )
  }
  for (const transaction of transactions) {
    for (const [accountId, currencyDeltas] of transactionBalanceDeltasByCurrency(
      transaction,
      accountMap,
    )) {
      const accountBalances = balances.get(accountId) ?? new Map<CurrencyCode, number>()
      for (const [currency, delta] of currencyDeltas) {
        accountBalances.set(currency, (accountBalances.get(currency) ?? 0) + delta)
      }
      balances.set(accountId, accountBalances)
    }
  }
  return balances
}

export function calculateAccountBalances(
  accounts: Account[],
  transactions: FinanceTransaction[],
): Map<string, number> {
  const balancesByCurrency = calculateAccountBalancesByCurrency(accounts, transactions)
  return new Map(accounts.map((account) => [
    account.id,
    balancesByCurrency.get(account.id)?.get(account.currency) ?? 0,
  ]))
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
  const balancesByCurrency = calculateAccountBalancesByCurrency(
    activeAccounts,
    allBalanceTransactions,
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
    for (const [currency, balance] of balancesByCurrency.get(account.id) ?? []) {
      const converted = convert(balance, currency)
      if (account.kind === 'credit') liabilitiesMinor += converted
      else assetsMinor += converted
    }
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
    const reportFee = transaction.feeMinor
      ? convert(transaction.feeMinor, transaction.currency)
      : 0
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
      reportFee > 0 &&
      ['transfer', 'topup', 'credit_payment'].includes(transaction.type)
    ) {
      actualPaidMinor += reportFee
    }
    if (
      fundingParty === 'self' &&
      (transaction.type === 'expense' ||
        transaction.type === 'transfer' ||
        transaction.type === 'topup' ||
        transaction.type === 'credit_payment' ||
        (transaction.type === 'adjustment' && transaction.direction === 'outflow'))
    ) {
      assetAccountDecreaseMinor += reportAmount + reportFee
    }
  }

  return {
    balances,
    balancesByCurrency,
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
  supportedCurrencies?: CurrencyCode[]
  openingBalanceCurrency?: CurrencyCode
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
  const supportedCurrencies = [...new Set([input.currency, ...(input.supportedCurrencies ?? [])]
    .map((currency) => currency.trim().toUpperCase() as CurrencyCode))]
  if (supportedCurrencies.some((currency) => !/^[A-Z]{3}$/.test(currency))) {
    throw new Error('支持币种必须使用 ISO 三字代码')
  }
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
  const openingBalanceCurrency =
    input.openingBalanceCurrency ??
    existing?.openingBalanceCurrency ??
    existing?.currency ??
    input.currency
  if (!supportedCurrencies.includes(openingBalanceCurrency)) {
    supportedCurrencies.push(openingBalanceCurrency)
  }
  const timestamp = now()
  const id = input.id ?? crypto.randomUUID()
  await db.accounts.put({
    id,
    name,
    kind: input.kind,
    ownership,
    ...((input.ownership || existing?.ownershipConfirmedAt) && {
      ownershipConfirmedAt: input.ownership
        ? timestamp
        : existing?.ownershipConfirmedAt,
    }),
    subtype: input.subtype,
    currency: input.currency,
    ...(supportedCurrencies.length > 1 && { supportedCurrencies }),
    openingBalanceCurrency,
    openingBalanceMinor: Math.round(input.openingBalanceMinor ?? existing?.openingBalanceMinor ?? 0),
    includeInNetWorth:
      ownership === 'external'
        ? false
        : input.includeInNetWorth ?? existing?.includeInNetWorth ?? input.kind !== 'external',
    includeInSpending:
      input.includeInSpending ?? existing?.includeInSpending ?? true,
    ...((clean(input.institution) ?? existing?.institution) && {
      institution: clean(input.institution) ?? existing?.institution,
    }),
    ...((clean(input.note) ?? existing?.note) && {
      note: clean(input.note) ?? existing?.note,
    }),
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
  if (!accountSupportsCurrency(account, input.currency)) throw new Error('交易币种不在支付账户支持范围内')
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
    ...existing,
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
    categoryId: input.categoryId || undefined,
    categoryNameSnapshot: category?.name,
    merchantId: merchant?.id,
    merchantNameSnapshot: merchant?.name,
    note: clean(input.note),
    includeInSpending: input.includeInSpending ?? account.includeInSpending,
    affectsNetWorth: fundingParty === 'self' && accountOwnership(account) === 'self',
    reportingCurrency: input.reportingCurrency,
    reportingAmountMinor: Number.isSafeInteger(input.reportingAmountMinor)
      ? input.reportingAmountMinor
      : undefined,
    exchangeRate: input.exchangeRate,
    exchangeRateDate: input.exchangeRateDate,
    exchangeRateSource: input.exchangeRateSource,
    lifecycleStatus: 'active',
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }
  await db.transaction(
    'rw',
    [db.accounts, db.financeTransactions, db.merchants],
    async () => {
    if (existing) {
      const linkedRefunds = await db.financeTransactions
        .filter((candidate) =>
          candidate.lifecycleStatus === 'active' &&
          candidate.type === 'refund' &&
          candidate.linkedTransactionId === existing.id,
        )
        .toArray()
      if (
        linkedRefunds.length > 0 &&
        linkedRefunds.some((refund) => refund.currency !== input.currency)
      ) {
        throw new Error('已有退款的消费不能修改币种')
      }
      const refundedMinor = linkedRefunds.reduce(
        (sum, refund) => sum + refund.amountMinor,
        0,
      )
      if (refundedMinor > input.amountMinor) {
        throw new Error(`消费金额不能低于已退款金额 ${fromMinor(refundedMinor, input.currency)}`)
      }
    }

    const allTransactions = await db.financeTransactions
      .where('lifecycleStatus')
      .equals('active')
      .filter((transaction) => transaction.id !== id)
      .toArray()
    if (fundingParty === 'self' && account.kind === 'asset') {
      const allAccounts = await db.accounts.where('lifecycleStatus').equals('active').toArray()
      const available =
        calculateAccountBalancesByCurrency(allAccounts, allTransactions)
          .get(account.id)
          ?.get(input.currency) ?? 0
      if (input.amountMinor > available) {
        throw new Error(`支付账户余额不足，差额 ${fromMinor(input.amountMinor - available, input.currency)}`)
      }
    }

    if (merchant) await db.merchants.put(merchant)
    await db.financeTransactions.put(row)
  })
  return id
}

export async function saveIncome(input: {
  id?: string
  amountMinor: number
  currency: CurrencyCode
  localDate: string
  accountId: string
  categoryId?: string
  sourceName?: string
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
  if (
    !account ||
    account.isArchived ||
    account.kind !== 'asset' ||
    accountOwnership(account) !== 'self' ||
    !accountSupportsCurrency(account, input.currency)
  ) {
    throw new Error('收入必须进入同币种的个人资产账户')
  }
  const existing = input.id ? await db.financeTransactions.get(input.id) : undefined
  if (existing?.paycheckId && existing.currency !== input.currency) {
    throw new Error('工资入账记录不能修改币种')
  }
  const category = input.categoryId
    ? await db.expenseCategories.get(input.categoryId)
    : undefined
  const timestamp = now()
  const id = input.id ?? crypto.randomUUID()
  const row: FinanceTransaction = {
    ...existing,
    id,
    type: 'income',
    amountMinor: input.amountMinor,
    currency: input.currency,
    occurredAt: `${input.localDate}T12:00:00.000Z`,
    localDate: input.localDate,
    accountId: account.id,
    fundingParty: 'self',
    categoryId: input.categoryId || undefined,
    categoryNameSnapshot: category?.name,
    merchantNameSnapshot: clean(input.sourceName),
    note: clean(input.note),
    paycheckId: existing?.paycheckId ?? input.paycheckId,
    includeInSpending: false,
    affectsNetWorth: true,
    reportingCurrency: input.reportingCurrency ?? input.currency,
    reportingAmountMinor: Number.isSafeInteger(input.reportingAmountMinor)
      ? input.reportingAmountMinor
      : input.amountMinor,
    exchangeRate: input.exchangeRate ?? 1,
    exchangeRateDate: input.exchangeRateDate ?? input.localDate,
    exchangeRateSource: input.exchangeRateSource ?? 'same-currency',
    lifecycleStatus: 'active',
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }
  await db.transaction(
    'rw',
    db.financeTransactions,
    db.paychecks,
    async () => {
      await db.financeTransactions.put(row)
      if (existing?.paycheckId) {
        const paycheck = await db.paychecks.get(existing.paycheckId)
        if (paycheck) {
          await db.paychecks.update(paycheck.id, {
            payoutAccountId: account.id,
            actualAmountMinor: input.amountMinor,
            updatedAt: timestamp,
          })
        }
      }
    },
  )
  return id
}

export async function saveTransfer(input: {
  id?: string
  sourceAccountId: string
  destinationAccountId: string
  sourceCurrency?: CurrencyCode
  destinationCurrency?: CurrencyCode
  sourceAmountMinor: number
  destinationAmountMinor?: number
  feeMinor?: number
  localDate: string
  kind?: FinanceTransfer['kind']
  exchangeRate?: number
  note?: string
  dueDate?: string
}): Promise<{ transactionId: string; transferId: string; settlementId?: string }> {
  positiveMinor(input.sourceAmountMinor)
  if (input.feeMinor !== undefined && (!Number.isSafeInteger(input.feeMinor) || input.feeMinor < 0)) {
    throw new Error('手续费金额无效')
  }
  let result!: { transactionId: string; transferId: string; settlementId?: string }
  await db.transaction(
    'rw',
    db.accounts,
    db.financeTransactions,
    db.financeTransfers,
    db.creditCardSettlements,
    async () => {
      const [source, destination, existing] = await Promise.all([
        db.accounts.get(input.sourceAccountId),
        db.accounts.get(input.destinationAccountId),
        input.id ? db.financeTransactions.get(input.id) : undefined,
      ])
      if (!source || !destination || source.isArchived || destination.isArchived) {
        throw new Error('转出或转入账户不存在或已停用')
      }
      if (source.kind !== 'asset' || accountOwnership(source) !== 'self') {
        throw new Error('转出账户必须是个人资产账户')
      }
      const kind = input.kind ?? (destination.kind === 'credit' ? 'credit_payment' : 'transfer')
      if (
        kind === 'credit_payment' &&
        (destination.kind !== 'credit' || accountOwnership(destination) !== 'self')
      ) {
        throw new Error('信用卡还款的目标必须是本人信用卡')
      }
      if (
        kind === 'topup' &&
        (
          destination.kind !== 'asset' ||
          accountOwnership(destination) !== 'self' ||
          !['stored_value', 'wallet'].includes(destination.subtype)
        )
      ) {
        throw new Error('充值目标必须是本人的电子钱包或储值账户')
      }
      if (
        kind === 'transfer' &&
        (destination.kind !== 'asset' || accountOwnership(destination) !== 'self')
      ) {
        throw new Error('普通转账的目标必须是本人资产账户')
      }

      const sourceCurrency = input.sourceCurrency ?? existing?.currency ?? source.currency
      const destinationCurrency =
        input.destinationCurrency ??
        existing?.counterpartyCurrency ??
        destination.currency
      if (!accountSupportsCurrency(source, sourceCurrency)) {
        throw new Error('转出币种不在账户支持范围内')
      }
      if (!accountSupportsCurrency(destination, destinationCurrency)) {
        throw new Error('转入币种不在账户支持范围内')
      }
      const destinationAmountMinor = positiveMinor(
        input.destinationAmountMinor ?? input.sourceAmountMinor,
      )
      const exchangeRate = input.exchangeRate ?? (
        sourceCurrency === destinationCurrency
          ? 1
          : fromMinor(destinationAmountMinor, destinationCurrency) /
            fromMinor(input.sourceAmountMinor, sourceCurrency)
      )
      const allAccounts = await db.accounts
        .where('lifecycleStatus')
        .equals('active')
        .toArray()
      const allTransactions = await db.financeTransactions
        .where('lifecycleStatus')
        .equals('active')
        .filter((transaction) => transaction.id !== input.id)
        .toArray()
      const sourceBalance =
        calculateAccountBalancesByCurrency(allAccounts, allTransactions)
          .get(source.id)
          ?.get(sourceCurrency) ?? 0
      const totalDebitMinor = input.sourceAmountMinor + (input.feeMinor ?? 0)
      if (totalDebitMinor > sourceBalance) {
        throw new Error(
          `转出账户余额不足，差额 ${fromMinor(totalDebitMinor - sourceBalance, sourceCurrency)}`,
        )
      }

      const timestamp = now()
      const existingTransfer = existing?.transferId
        ? await db.financeTransfers.get(existing.transferId)
        : input.id
          ? await db.financeTransfers.where('transactionId').equals(input.id).first()
          : undefined
      const existingSettlement = input.id
        ? await db.creditCardSettlements.where('transactionId').equals(input.id).first()
        : undefined
      const transactionId = existing?.id ?? input.id ?? crypto.randomUUID()
      const transferId = existingTransfer?.id ?? existing?.transferId ?? crypto.randomUUID()
      const transaction: FinanceTransaction = {
        ...existing,
        id: transactionId,
        type: kind,
        amountMinor: input.sourceAmountMinor,
        currency: sourceCurrency,
        occurredAt: `${input.localDate}T12:00:00.000Z`,
        localDate: input.localDate,
        accountId: source.id,
        fundingParty: 'self',
        counterpartyAccountId: destination.id,
        counterpartyAmountMinor: destinationAmountMinor,
        counterpartyCurrency: destinationCurrency,
        feeMinor: input.feeMinor || undefined,
        note: clean(input.note),
        includeInSpending: false,
        // Transfers, top-ups and card repayments move value between the
        // user's own accounts. Only an optional fee changes net worth.
        affectsNetWorth: false,
        transferId,
        lifecycleStatus: 'active',
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      }
      const transfer: FinanceTransfer = {
        ...existingTransfer,
        id: transferId,
        transactionId,
        sourceAccountId: source.id,
        destinationAccountId: destination.id,
        sourceAmountMinor: input.sourceAmountMinor,
        sourceCurrency,
        destinationAmountMinor,
        destinationCurrency,
        exchangeRate,
        kind,
        localDate: input.localDate,
        note: clean(input.note),
        lifecycleStatus: 'active',
        createdAt: existingTransfer?.createdAt ?? timestamp,
        updatedAt: timestamp,
      }
      await db.financeTransactions.put(transaction)
      await db.financeTransfers.put(transfer)

      let settlementId: string | undefined
      if (kind === 'credit_payment') {
        const settlement: CreditCardSettlement = {
          ...existingSettlement,
          id: existingSettlement?.id ?? crypto.randomUUID(),
          creditAccountId: destination.id,
          paymentAccountId: source.id,
          transferId,
          transactionId,
          dueDate: input.dueDate,
          amountMinor: destinationAmountMinor,
          currency: destinationCurrency,
          status: 'paid',
          paidAt: existingSettlement?.paidAt ?? timestamp,
          createdAt: existingSettlement?.createdAt ?? timestamp,
          updatedAt: timestamp,
        }
        await db.creditCardSettlements.put(settlement)
        settlementId = settlement.id
      } else if (existingSettlement) {
        await db.creditCardSettlements.update(existingSettlement.id, {
          status: 'voided',
          updatedAt: timestamp,
        })
      }
      result = { transactionId, transferId, ...(settlementId && { settlementId }) }
    },
  )
  return result
}

export async function saveRefund(input: {
  id?: string
  amountMinor: number
  localDate: string
  linkedTransactionId: string
  accountId?: string
  note?: string
}): Promise<string> {
  positiveMinor(input.amountMinor)
  const id = input.id ?? crypto.randomUUID()
  await db.transaction(
    'rw',
    db.accounts,
    db.financeTransactions,
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
    const originalAccount = await db.accounts.get(linked.accountId)
    const account = await db.accounts.get(input.accountId ?? linked.accountId)
    if (!originalAccount || !account || !accountSupportsCurrency(account, linked.currency)) {
      throw new Error('原消费的账户或币种信息异常')
    }
    const transactions = await db.financeTransactions.toArray()
    const linkedRefunds = transactions
      .filter(
        (transaction) =>
          transaction.id !== id &&
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
      new Map([[originalAccount.id, originalAccount]]),
    )
    const reportingAmountMinor = Number.isSafeInteger(linked.reportingAmountMinor)
      ? Math.round((linked.reportingAmountMinor! * input.amountMinor) / linked.amountMinor)
      : undefined
    const timestamp = now()
    const existing = input.id ? await db.financeTransactions.get(input.id) : undefined
    await db.financeTransactions.put({
      ...existing,
      id,
      type: 'refund',
      amountMinor: input.amountMinor,
      currency: linked.currency,
      occurredAt: `${input.localDate}T12:00:00.000Z`,
      localDate: input.localDate,
      accountId: account.id,
      fundingParty,
      linkedTransactionId: linked.id,
      categoryId: linked.categoryId,
      categoryNameSnapshot: linked.categoryNameSnapshot,
      merchantId: linked.merchantId,
      merchantNameSnapshot: linked.merchantNameSnapshot,
      note: clean(input.note),
      includeInSpending: linked.includeInSpending,
      affectsNetWorth: fundingParty === 'self' && accountOwnership(account) === 'self',
      reportingCurrency: linked.reportingCurrency,
      reportingAmountMinor,
      exchangeRate: linked.exchangeRate,
      exchangeRateDate: linked.exchangeRateDate,
      exchangeRateSource: linked.exchangeRateSource,
      lifecycleStatus: 'active',
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    })
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

export async function softDeleteWorkTemplate(id: string): Promise<void> {
  const template = await db.workTemplates.get(id)
  if (!template || template.lifecycleStatus !== 'active') return
  const timestamp = now()
  await db.workTemplates.update(id, {
    lifecycleStatus: 'deleted',
    updatedAt: timestamp,
  })
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

export async function softDeleteWorkEntry(id: string): Promise<void> {
  const entry = await db.workEntries.get(id)
  if (!entry) return
  if (entry.settlementStatus === 'settled') {
    throw new Error('已入账的工作记录不能直接删除')
  }
  const timestamp = now()
  await db.workEntries.update(id, {
    lifecycleStatus: 'deleted',
    deletedAt: timestamp,
    updatedAt: timestamp,
  })
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
    if (
      !account ||
      account.kind !== 'asset' ||
      accountOwnership(account) !== 'self' ||
      !accountSupportsCurrency(account, input.currency)
    ) {
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
