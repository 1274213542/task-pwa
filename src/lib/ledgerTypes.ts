export type CurrencyCode = 'JPY' | 'CNY' | (string & {})

export type AccountKind = 'asset' | 'credit' | 'external'
export type AccountOwnership = 'self' | 'external'
export type FundingParty = 'self' | 'external'
export type AccountSubtype =
  | 'bank'
  | 'cash'
  | 'wallet'
  | 'stored_value'
  | 'credit_card'
  | 'external_payer'
  | 'unspecified'

export interface Account {
  id: string
  name: string
  kind: AccountKind
  /** 账户类型与归属分离：本人信用卡和外部信用卡都可以是 credit。 */
  ownership?: AccountOwnership
  /** 用户明确确认过归属后，自动迁移不得再按账户名称覆盖。 */
  ownershipConfirmedAt?: string
  subtype: AccountSubtype
  /**
   * Primary/default currency. Kept for backwards compatibility and for
   * accounts whose balance is denominated in a single currency.
   */
  currency: CurrencyCode
  /**
   * Payment sources that do not carry a personal balance (for example an
   * external payer's card) may accept transactions in more than one
   * currency. Every transaction still stores its own original currency.
   */
  supportedCurrencies?: CurrencyCode[]
  /**
   * Currency of the legacy single opening balance. It is intentionally
   * independent from the default transaction currency so changing the
   * default never reinterprets an existing opening balance.
   */
  openingBalanceCurrency?: CurrencyCode
  /** 资产账户为正余额；信用账户为正的待还金额。 */
  openingBalanceMinor: number
  includeInNetWorth: boolean
  includeInSpending: boolean
  institution?: string
  note?: string
  rank: string
  billingCycleDay?: number
  paymentDueDay?: number
  defaultPaymentAccountId?: string
  isArchived?: boolean
  archivedAt?: string
  lifecycleStatus: 'active' | 'deleted'
  deletedAt?: string
  createdAt: string
  updatedAt: string
}

export type FinanceTransactionType =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'credit_purchase'
  | 'credit_payment'
  | 'topup'
  | 'refund'
  | 'external_payment'
  | 'initial_balance'
  | 'adjustment'

export interface FinanceTransaction {
  id: string
  type: FinanceTransactionType
  amountMinor: number
  currency: CurrencyCode
  occurredAt: string
  localDate: string
  accountId: string
  /** 消费由本人还是外部资金承担；旧记录由账户归属幂等补齐。 */
  fundingParty?: FundingParty
  counterpartyAccountId?: string
  counterpartyAmountMinor?: number
  counterpartyCurrency?: CurrencyCode
  /** 转账、还款或充值产生的真实手续费，不包含主体转移金额。 */
  feeMinor?: number
  categoryId?: string
  categoryNameSnapshot?: string
  merchantId?: string
  merchantNameSnapshot?: string
  note?: string
  direction?: 'inflow' | 'outflow'
  includeInSpending: boolean
  affectsNetWorth: boolean
  linkedTransactionId?: string
  transferId?: string
  paycheckId?: string
  reportingCurrency?: CurrencyCode
  reportingAmountMinor?: number
  exchangeRate?: number
  exchangeRateDate?: string
  exchangeRateSource?: string
  recurringInstanceId?: string
  lifecycleStatus: 'active' | 'deleted'
  deletedAt?: string
  createdAt: string
  updatedAt: string
}

export type RecurringPostingMode = 'automatic' | 'confirmation'

export interface RecurringTransactionRule {
  id: string
  name: string
  amountMinor: number
  currency: CurrencyCode
  categoryId?: string
  accountId: string
  merchantName?: string
  billingDay: number
  startDate: string
  endDate?: string
  postingMode: RecurringPostingMode
  note?: string
  enabled: boolean
  rank: string
  lifecycleStatus: 'active' | 'deleted'
  deletedAt?: string
  createdAt: string
  updatedAt: string
}

export interface RecurringTransactionInstance {
  id: string
  ruleId: string
  billingPeriod: string
  scheduledDate: string
  amountMinor: number
  currency: CurrencyCode
  status: 'pending' | 'posted' | 'insufficient_funds' | 'skipped' | 'voided'
  transactionId?: string
  shortageReason?: string
  confirmedAmountMinor?: number
  createdAt: string
  updatedAt: string
}

export interface FinanceTransfer {
  id: string
  transactionId: string
  sourceAccountId: string
  destinationAccountId: string
  sourceAmountMinor: number
  sourceCurrency: CurrencyCode
  destinationAmountMinor: number
  destinationCurrency: CurrencyCode
  exchangeRate?: number
  kind: 'transfer' | 'credit_payment' | 'topup'
  localDate: string
  note?: string
  lifecycleStatus: 'active' | 'deleted'
  createdAt: string
  updatedAt: string
}

export interface CreditCardSettlement {
  id: string
  creditAccountId: string
  paymentAccountId: string
  transferId: string
  transactionId: string
  statementStartDate?: string
  statementEndDate?: string
  dueDate?: string
  amountMinor: number
  currency: CurrencyCode
  status: 'scheduled' | 'paid' | 'voided'
  paidAt?: string
  createdAt: string
  updatedAt: string
}

export interface ExchangeRate {
  id: string
  baseCurrency: CurrencyCode
  quoteCurrency: CurrencyCode
  rate: number
  rateDate: string
  fetchedAt: string
  source: 'frankfurter' | 'manual' | 'transaction_snapshot'
  providerLabel: string
  isManual: boolean
}

export interface WorkTemplate {
  id: string
  name: string
  workContent?: string
  employer?: string
  workLocation?: string
  breakMinutes: number
  paidBreak: boolean
  hourlyRateMinor: number
  currency: CurrencyCode
  payoutAccountId?: string
  expectedPayDay?: number
  rank: string
  lifecycleStatus: 'active' | 'deleted'
  createdAt: string
  updatedAt: string
}

export interface WorkEntry {
  id: string
  date: string
  worked: boolean
  workContent?: string
  employer?: string
  workLocation?: string
  startTime?: string
  endTime?: string
  durationMinutes: number
  breakMinutes: number
  paidBreak: boolean
  hourlyRateMinor: number
  currency: CurrencyCode
  estimatedGrossMinor: number
  expectedPayDate?: string
  payoutAccountId?: string
  templateId?: string
  note?: string
  settlementStatus: 'unsettled' | 'settled'
  paycheckId?: string
  lifecycleStatus: 'active' | 'deleted'
  deletedAt?: string
  createdAt: string
  updatedAt: string
}

export interface Paycheck {
  id: string
  workEntryIds: string[]
  payoutAccountId: string
  currency: CurrencyCode
  estimatedAmountMinor: number
  actualAmountMinor?: number
  expectedPayDate?: string
  paidAt?: string
  incomeTransactionId?: string
  status: 'draft' | 'paid' | 'voided'
  note?: string
  createdAt: string
  updatedAt: string
}

export interface Merchant {
  id: string
  name: string
  defaultCategoryId?: string
  defaultAccountId?: string
  defaultCurrency?: CurrencyCode
  useCount: number
  lastUsedAt?: string
  lifecycleStatus: 'active' | 'deleted'
  createdAt: string
  updatedAt: string
}

export interface FinanceMigrationState {
  id: 'finance-ledger-v2'
  version: 2
  status: 'pending' | 'complete' | 'rolled_back' | 'failed'
  snapshotId?: string
  migratedExpenseCount: number
  migratedWorkCount: number
  startedAt: string
  completedAt?: string
  error?: string
}

export interface FinanceMigrationSnapshot {
  id: string
  createdAt: string
  sourceDatabase: string
  expenseRecords: Record<string, unknown>[]
  workRecords: Record<string, unknown>[]
}
