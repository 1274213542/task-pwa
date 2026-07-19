import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import AppIcon from '../components/AppIcon'
import GestureSheet, { type GestureSheetHandle } from '../components/GestureSheet'
import MobilePageHeader from '../components/MobilePageHeader'
import MarkerIcon from '../components/MarkerIcon'
import PageHeader from '../components/PageHeader'
import SelectionPickerSheet, { type SelectionPickerItem } from '../components/SelectionPickerSheet'
import { financeFundsV3Enabled } from '../config'
import { AmountPrivacyToggle, PrivateAmount } from '../components/AmountPrivacy'
import { db, type ColorToken, type ExpenseCategory, type MarkerSymbol } from '../lib/db'
import { cachedRate, convertWithCachedRate, refreshExchangeRate, saveManualExchangeRate } from '../lib/exchangeRates'
import { MOTION } from '../lib/motion'
import {
  calculateAccountBalances,
  accountOwnership,
  convertMinor,
  findRate,
  fromMinor,
  ledgerSummary,
  moveAccount,
  saveAccount,
  saveIncome,
  saveRefund,
  saveSpending,
  saveTransfer,
  saveWorkEntry,
  saveWorkTemplate,
  setAccountArchived,
  settlePaycheck,
  softDeleteFinanceTransaction,
  toMinor,
} from '../lib/ledger'
import {
  archiveExpenseCategory,
  moveExpenseCategory,
  saveExpenseCategory,
} from '../lib/expenseCategories'
import { calculateFundPoolStates } from '../lib/fundMath'
import { processDueRecurringRules } from '../lib/recurringFinance'
import { FinanceFundsView, FinancePlanningPanel } from './FinanceFundsPanels'
import type {
  Account,
  CurrencyCode,
  FinanceTransaction,
  FinanceTransactionType,
  ExchangeRate,
  FundPool,
  TransactionFundAllocation,
  WorkEntry,
  WorkTemplate,
} from '../lib/ledgerTypes'

type FinanceView = 'overview' | 'accounts' | 'funds' | 'transactions' | 'planning' | 'work' | 'stats'
type EntryKind = 'expense' | 'income' | 'transfer' | 'credit_payment' | 'topup' | 'refund'
type FinancePlanningSection = 'recurring' | 'projection' | 'work' | 'stats'

const ENTRY_KINDS: EntryKind[] = ['expense', 'income', 'transfer', 'credit_payment', 'topup', 'refund']
const ENTRY_KIND_LABEL: Record<EntryKind, string> = {
  expense: '支出',
  income: '收入',
  transfer: '转账',
  credit_payment: '还信用卡',
  topup: '充值',
  refund: '退款',
}

const PLANNING_SECTIONS: Array<{ id: FinancePlanningSection; label: string }> = [
  { id: 'recurring', label: '固定扣款' },
  { id: 'projection', label: '储蓄预测' },
  { id: 'work', label: '工资工时' },
  { id: 'stats', label: '统计' },
]

const VIEW_ITEMS: { id: FinanceView; label: string }[] = financeFundsV3Enabled
  ? [
      { id: 'overview', label: '总览' },
      { id: 'accounts', label: '账户' },
      { id: 'funds', label: '资金池' },
      { id: 'transactions', label: '流水' },
      { id: 'planning', label: '计划' },
    ]
  : [
      { id: 'overview', label: '总览' },
      { id: 'accounts', label: '账户' },
      { id: 'transactions', label: '流水' },
      { id: 'work', label: '工资与工时' },
      { id: 'stats', label: '统计' },
    ]

const ACCOUNT_SUBTYPE_LABEL: Record<Account['subtype'], string> = {
  bank: '银行账户',
  cash: '现金',
  wallet: '电子钱包',
  stored_value: '储值卡',
  credit_card: '信用卡',
  external_payer: '他人代付',
  unspecified: '未指定',
}

const TRANSACTION_LABEL: Record<FinanceTransactionType, string> = {
  expense: '支出',
  income: '收入',
  transfer: '账户转账',
  credit_purchase: '信用卡消费',
  credit_payment: '信用卡还款',
  topup: '储值充值',
  refund: '退款',
  external_payment: '外部代付',
  initial_balance: '初始余额',
  adjustment: '余额调整',
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function monthStartISO() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
}

function formatMoney(amountMinor: number, currency: CurrencyCode) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'JPY' ? 0 : 2,
  }).format(fromMinor(amountMinor, currency))
}

function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}小时 ${rest}分` : `${hours}小时`
}

const FINANCE_ENTRY_DEFAULTS_KEY = 'financeEntryDefaultsV1'

type FinanceEntryDefaults = {
  accountId?: string
  categoryId?: string
  fundPoolId?: string
}

function loadFinanceEntryDefaults(): FinanceEntryDefaults {
  try {
    const parsed = JSON.parse(localStorage.getItem(FINANCE_ENTRY_DEFAULTS_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? parsed as FinanceEntryDefaults : {}
  } catch {
    return {}
  }
}

function saveFinanceEntryDefaults(value: FinanceEntryDefaults) {
  localStorage.setItem(FINANCE_ENTRY_DEFAULTS_KEY, JSON.stringify(value))
}

function accountDefaultSubtype(kind: Account['kind']): Account['subtype'] {
  if (kind === 'credit') return 'credit_card'
  if (kind === 'external') return 'external_payer'
  return 'bank'
}

export default function FinanceLedger() {
  const location = useLocation()
  const navigate = useNavigate()
  const query = useMemo(() => new URLSearchParams(location.search), [location.search])
  const rawRequestedView = query.get('mode') as FinanceView | null
  const normalizedRequestedView = financeFundsV3Enabled && ['work', 'stats'].includes(rawRequestedView ?? '')
    ? 'planning'
    : rawRequestedView
  const requestedView = VIEW_ITEMS.some((item) => item.id === normalizedRequestedView)
    ? normalizedRequestedView as FinanceView
    : 'overview'
  const [view, setView] = useState<FinanceView>(requestedView)
  const [planningSection, setPlanningSection] = useState<FinancePlanningSection>(() => {
    if (rawRequestedView === 'work' || rawRequestedView === 'stats') return rawRequestedView
    const stored = localStorage.getItem('financePlanningSection') as FinancePlanningSection | null
    return PLANNING_SECTIONS.some((item) => item.id === stored) ? stored! : 'recurring'
  })
  const [reportingCurrency, setReportingCurrency] = useState<CurrencyCode>('JPY')
  const [entryOpen, setEntryOpen] = useState(query.get('new') === '1')
  const [entryKind, setEntryKind] = useState<EntryKind>('expense')
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(
    query.get('panel') === 'categories',
  )
  const [editingTransaction, setEditingTransaction] = useState<FinanceTransaction | undefined>()
  const [feedback, setFeedback] = useState('')
  const previousViewRef = useRef(view)
  const reduceMotion = useReducedMotion()
  const previousViewIndex = VIEW_ITEMS.findIndex((item) => item.id === previousViewRef.current)
  const currentViewIndex = VIEW_ITEMS.findIndex((item) => item.id === view)
  const viewDirection = currentViewIndex >= previousViewIndex ? 1 : -1

  const accountsLive = useLiveQuery(
    () => db.accounts.where('lifecycleStatus').equals('active').sortBy('rank'),
    [],
  )
  const accounts = useMemo(() => accountsLive ?? [], [accountsLive])
  const transactionsLive = useLiveQuery(
    () => db.financeTransactions.where('lifecycleStatus').equals('active').toArray(),
    [],
  )
  const transactions = useMemo(() => transactionsLive ?? [], [transactionsLive])
  const ratesLive = useLiveQuery(() => db.exchangeRates.toArray(), [], [])
  const rates = useMemo(() => ratesLive ?? [], [ratesLive])
  const categories = useLiveQuery(
    () => db.expenseCategories.where('lifecycleStatus').equals('active').sortBy('rank'),
    [],
  ) ?? []
  const workEntries = useLiveQuery(
    () => db.workEntries.where('lifecycleStatus').equals('active').toArray(),
    [],
  ) ?? []
  const workTemplates = useLiveQuery(
    () => db.workTemplates.where('lifecycleStatus').equals('active').sortBy('rank'),
    [],
  ) ?? []
  const fundPools = useLiveQuery(
    () => db.fundPools.where('lifecycleStatus').equals('active').sortBy('rank'),
    [],
  ) ?? []
  const transactionFundAllocations = useLiveQuery(
    () => db.transactionFundAllocations.where('lifecycleStatus').equals('active').toArray(),
    [],
  ) ?? []

  const currentSummary = useMemo(
    () => ledgerSummary({
      accounts,
      transactions,
      rates,
      reportingCurrency,
      startDate: monthStartISO(),
      endDate: todayISO(),
    }),
    [accounts, transactions, rates, reportingCurrency],
  )
  const balances = useMemo(
    () => calculateAccountBalances(accounts, transactions),
    [accounts, transactions],
  )
  const sortedTransactions = useMemo(
    () => [...transactions].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
    [transactions],
  )
  const recentTransactions = useMemo(() => sortedTransactions.slice(0, 30), [sortedTransactions])

  useEffect(() => {
    const raw = query.get('mode') as FinanceView | null
    const normalized = financeFundsV3Enabled && ['work', 'stats'].includes(raw ?? '')
      ? 'planning'
      : raw
    if (VIEW_ITEMS.some((item) => item.id === normalized)) {
      setView(normalized as FinanceView)
    }
    if (raw === 'work' || raw === 'stats') setPlanningSection(raw)
    if (query.get('panel') === 'categories') setCategoryManagerOpen(true)
  }, [query])

  useEffect(() => {
    if (!financeFundsV3Enabled) return
    let cancelled = false
    void processDueRecurringRules(todayISO())
      .then((result) => {
        if (cancelled) return
        if (result.posted || result.pending || result.insufficient) {
          setFeedback(`固定扣款：入账 ${result.posted}，待确认 ${result.pending}，资金不足 ${result.insufficient}`)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setFeedback(error instanceof Error ? error.message : '固定扣款检查失败')
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    previousViewRef.current = view
  }, [view])

  function openEntry(kind: EntryKind = 'expense', transaction?: FinanceTransaction) {
    setEntryKind(kind)
    setEditingTransaction(transaction)
    setEntryOpen(true)
  }

  function selectView(nextView: FinanceView) {
    setView(nextView)
    navigate(`/finance?mode=${nextView}`, { replace: true })
  }

  function selectPlanningSection(nextSection: FinancePlanningSection) {
    setPlanningSection(nextSection)
    localStorage.setItem('financePlanningSection', nextSection)
  }

  return (
    <section className="app-page page-finance finance-ledger-page finance-shell">
      <div className="finance-sticky-header">
        <MobilePageHeader
          eyebrow="工时、收入与支出"
          title="财务"
          onPrimary={() => openEntry('expense')}
          primaryLabel="快速记账"
          primaryIcon="plus"
        />
        <PageHeader
          eyebrow="工时、收入与支出"
          title="财务"
          actions={
            <>
              <button
                type="button"
                className="page-icon-button page-icon-button-primary"
                aria-label="快速记账"
                onClick={() => openEntry('expense')}
              >
                <AppIcon name="plus" size={22} />
              </button>
              <Link className="page-icon-button" aria-label="财务设置" to="/settings">
                <AppIcon name="settings" size={21} />
              </Link>
            </>
          }
        />
      </div>

      <nav className="finance-ledger-tabs" aria-label="财务页面">
        <span
          aria-hidden="true"
          className="finance-ledger-tab-surface"
          data-ready="true"
          style={{ transform: `translate3d(${currentViewIndex * 100}%, 0, 0)` }}
        />
        {VIEW_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-selected={view === item.id}
            aria-controls="finance-content-panel"
            onClick={() => selectView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="finance-ledger-toolbar">
        <span>{feedback || '原币种保留；汇总金额使用已缓存参考汇率'}</span>
        <div className="finance-ledger-toolbar-actions">
          <AmountPrivacyToggle compact />
          <label>
            汇总币种
            <select
              value={reportingCurrency}
              onChange={(event) => setReportingCurrency(event.target.value as CurrencyCode)}
            >
              <option value="JPY">JPY</option>
              <option value="CNY">CNY</option>
            </select>
          </label>
        </div>
      </div>

      <div
        id="finance-content-panel"
        className="finance-ledger-view-viewport"
        role="tabpanel"
        aria-label={VIEW_ITEMS.find((item) => item.id === view)?.label}
      >
        <motion.div
          key={view}
          className="finance-ledger-view-surface"
          initial={reduceMotion
            ? { x: 0, opacity: 0.84 }
            : { x: viewDirection * 12, opacity: 0.96 }}
          animate={{ x: 0, opacity: 1 }}
          transition={reduceMotion ? MOTION.reduced : MOTION.route}
        >
          {view === 'overview' && (
            <FinanceOverview
              accounts={accounts}
              balances={balances}
              transactions={recentTransactions}
              rates={rates}
              currency={reportingCurrency}
              summary={currentSummary}
              workEntries={workEntries}
              onOpenAccounts={() => selectView('accounts')}
              onOpenFunds={() => selectView('funds')}
              onOpenTransactions={() => selectView('transactions')}
              onNew={openEntry}
            />
          )}
          {view === 'accounts' && (
            <AccountsView
              accounts={accounts}
              balances={balances}
              transactions={transactions}
              onFeedback={setFeedback}
              onTransfer={() => openEntry('transfer')}
            />
          )}
          {view === 'transactions' && (
            <TransactionsView
              transactions={sortedTransactions}
              accounts={accounts}
              onNew={openEntry}
              onEdit={(transaction) => openEntry('expense', transaction)}
              onFeedback={setFeedback}
            />
          )}
          {view === 'funds' && financeFundsV3Enabled && (
            <FinanceFundsView accounts={accounts} onFeedback={setFeedback} />
          )}
          {view === 'planning' && financeFundsV3Enabled && (
            <div className="finance-planning-shell">
              <nav className="finance-planning-sections" aria-label="财务计划内容">
                <span
                  className="finance-planning-section-indicator"
                  aria-hidden="true"
                  style={{ transform: `translate3d(${PLANNING_SECTIONS.findIndex((item) => item.id === planningSection) * 100}%, 0, 0)` }}
                />
                {PLANNING_SECTIONS.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    aria-selected={planningSection === item.id}
                    onClick={() => selectPlanningSection(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
              <motion.section
                key={planningSection}
                className="finance-planning-section-content"
                initial={reduceMotion ? false : { x: 10, opacity: 0.97 }}
                animate={{ x: 0, opacity: 1 }}
                transition={reduceMotion ? MOTION.reduced : MOTION.control}
              >
                {planningSection === 'recurring' && (
                  <FinancePlanningPanel
                    section="recurring"
                    accounts={accounts}
                    categories={categories}
                    transactions={transactions}
                    rates={rates}
                    reportingCurrency={reportingCurrency}
                    onFeedback={setFeedback}
                  />
                )}
                {planningSection === 'projection' && (
                  <FinancePlanningPanel
                    section="projection"
                    accounts={accounts}
                    categories={categories}
                    transactions={transactions}
                    rates={rates}
                    reportingCurrency={reportingCurrency}
                    onFeedback={setFeedback}
                  />
                )}
                {planningSection === 'work' && (
                  <WorkView
                    entries={workEntries}
                    templates={workTemplates}
                    accounts={accounts}
                    initialDate={query.get('date') ?? todayISO()}
                    onFeedback={setFeedback}
                  />
                )}
                {planningSection === 'stats' && (
                  <StatsView
                    accounts={accounts}
                    transactions={transactions}
                    rates={rates}
                    reportingCurrency={reportingCurrency}
                    onFeedback={setFeedback}
                  />
                )}
              </motion.section>
            </div>
          )}
          {view === 'work' && (
            <WorkView
              entries={workEntries}
              templates={workTemplates}
              accounts={accounts}
              initialDate={query.get('date') ?? todayISO()}
              onFeedback={setFeedback}
            />
          )}
          {view === 'stats' && (
            <StatsView
              accounts={accounts}
              transactions={transactions}
              rates={rates}
              reportingCurrency={reportingCurrency}
              onFeedback={setFeedback}
            />
          )}
        </motion.div>
      </div>

      {entryOpen && (
        <FinanceEntrySheet
          initialKind={entryKind}
          editing={editingTransaction}
          accounts={accounts}
          transactions={transactions}
          categories={categories}
          fundPools={fundPools}
          transactionFundAllocations={transactionFundAllocations}
          reportingCurrency={reportingCurrency}
          onSaved={(message) => {
            setFeedback(message)
            setEntryOpen(false)
            setEditingTransaction(undefined)
          }}
          onClose={() => {
            setEntryOpen(false)
            setEditingTransaction(undefined)
          }}
        />
      )}
      {categoryManagerOpen && (
        <ExpenseCategoryManagerSheet
          categories={categories}
          accounts={accounts}
          fundPools={fundPools}
          onClose={() => setCategoryManagerOpen(false)}
          onFeedback={setFeedback}
        />
      )}
    </section>
  )
}

function FinanceOverview({
  accounts,
  balances,
  transactions,
  rates,
  currency,
  summary,
  workEntries,
  onOpenAccounts,
  onOpenFunds,
  onOpenTransactions,
  onNew,
}: {
  accounts: Account[]
  balances: Map<string, number>
  transactions: FinanceTransaction[]
  rates: ExchangeRate[]
  currency: CurrencyCode
  summary: ReturnType<typeof ledgerSummary>
  workEntries: WorkEntry[]
  onOpenAccounts: () => void
  onOpenFunds: () => void
  onOpenTransactions: () => void
  onNew: (kind: EntryKind) => void
}) {
  const poolsLive = useLiveQuery(
    () => db.fundPools.where('lifecycleStatus').equals('active').sortBy('rank'),
    [],
  )
  const allocationsLive = useLiveQuery(
    () => db.transactionFundAllocations.where('lifecycleStatus').equals('active').toArray(),
    [],
  )
  const poolTransfersLive = useLiveQuery(
    () => db.fundPoolTransfers.where('lifecycleStatus').equals('active').toArray(),
    [],
  )
  const reservationsLive = useLiveQuery(() => db.fundReservations.toArray(), [], [])
  const recurringInstances = useLiveQuery(() => db.recurringTransactionInstances.toArray(), [], []) ?? []
  const pools = useMemo(() => poolsLive ?? [], [poolsLive])
  const allocations = useMemo(() => allocationsLive ?? [], [allocationsLive])
  const poolTransfers = useMemo(() => poolTransfersLive ?? [], [poolTransfersLive])
  const reservations = useMemo(() => reservationsLive ?? [], [reservationsLive])
  const poolStates = useMemo(
    () => calculateFundPoolStates({ pools, allocations, transfers: poolTransfers, reservations }),
    [pools, allocations, poolTransfers, reservations],
  )
  const convertPool = (amountMinor: number, from: CurrencyCode) => {
    if (from === currency) return amountMinor
    const rate = findRate(rates, from, currency)
    return rate ? convertMinor(amountMinor, from, currency, rate) : 0
  }
  const fundsSummary = pools.reduce((result, pool) => {
    const state = poolStates.get(pool.id)
    const gross = convertPool(state?.grossMinor ?? 0, pool.currency)
    const available = convertPool(state?.availableMinor ?? 0, pool.currency)
    if (pool.includeInDisposable) result.disposable += available
    if (pool.includeInSavings) result.savings += gross
    if (['restricted_rent', 'restricted_living'].includes(pool.purpose)) result.fatherRestricted += gross
    result.allocated += gross
    return result
  }, { disposable: 0, savings: 0, fatherRestricted: 0, allocated: 0 })
  const unallocatedMinor = summary.assetsMinor - fundsSummary.allocated
  const upcomingCount = recurringInstances.filter((instance) =>
    ['pending', 'insufficient_funds'].includes(instance.status),
  ).length
  const monthWork = workEntries.filter((entry) =>
    entry.lifecycleStatus === 'active' && entry.worked &&
    entry.date >= monthStartISO() && entry.date <= todayISO(),
  )
  const workMinutes = monthWork.reduce((sum, entry) => sum + entry.durationMinutes, 0)
  const estimatedPay = monthWork
    .filter((entry) => entry.currency === currency && entry.settlementStatus === 'unsettled')
    .reduce((sum, entry) => sum + entry.estimatedGrossMinor, 0)
  return (
    <div className="finance-ledger-dashboard">
      <section className="finance-net-worth-card">
        <span>个人净资产</span>
        <strong><PrivateAmount>{formatMoney(summary.netWorthMinor, currency)}</PrivateAmount></strong>
        <div>
          <span>实际资产 <PrivateAmount>{formatMoney(summary.assetsMinor, currency)}</PrivateAmount></span>
          <span>本人负债 <PrivateAmount>{formatMoney(summary.liabilitiesMinor, currency)}</PrivateAmount></span>
          {financeFundsV3Enabled && <span>可自由支配 <PrivateAmount>{formatMoney(fundsSummary.disposable, currency)}</PrivateAmount></span>}
        </div>
      </section>

      {financeFundsV3Enabled && (
        <section className="finance-overview-support" aria-label="资金用途摘要">
          <button type="button" onClick={onOpenFunds}><span>父亲专项资金</span><strong><PrivateAmount>{formatMoney(fundsSummary.fatherRestricted, currency)}</PrivateAmount></strong></button>
          <button type="button" onClick={onOpenFunds}><span>个人储蓄</span><strong><PrivateAmount>{formatMoney(fundsSummary.savings, currency)}</PrivateAmount></strong></button>
          <button type="button" onClick={onOpenFunds}><span>未分配资金</span><strong><PrivateAmount>{formatMoney(unallocatedMinor, currency)}</PrivateAmount></strong></button>
          <button type="button" onClick={onOpenFunds}><span>即将扣款</span><strong>{upcomingCount} 项</strong></button>
        </section>
      )}

      <div className="finance-work-summary">
        <article><span>本月至今工时</span><strong>{formatMinutes(workMinutes)}</strong><small>{monthWork.length} 个工作日</small></article>
        <article><span>预计税前工资</span><strong><PrivateAmount>{formatMoney(estimatedPay, currency)}</PrivateAmount></strong><small>未结算工作记录</small></article>
        <article className="finance-consumption-summary">
          <span>本月至今消费</span>
          <strong><PrivateAmount>{formatMoney(summary.consumptionMinor, currency)}</PrivateAmount></strong>
          <small>
            <span>本人自付 <PrivateAmount>{formatMoney(summary.actualPaidMinor, currency)}</PrivateAmount></span>
            <span>外部代付 <PrivateAmount>{formatMoney(summary.externalPaidMinor, currency)}</PrivateAmount></span>
          </small>
        </article>
      </div>

      <section className="finance-section-card finance-quick-actions">
        <header><div><span>快捷操作</span><h2>记录资金变化</h2></div></header>
        <div>
          <button onClick={() => onNew('expense')}><AppIcon name="receipt" size={20} />记支出</button>
          <button onClick={() => onNew('income')}><AppIcon name="plus" size={20} />记收入</button>
          <button onClick={() => onNew('transfer')}><AppIcon name="sync" size={20} />转账</button>
          <button onClick={() => onNew('credit_payment')}><AppIcon name="finance" size={20} />还信用卡</button>
        </div>
      </section>

      <TransactionList
        title="最近流水"
        transactions={transactions.slice(0, 6)}
        accounts={accounts}
        onSeeAll={onOpenTransactions}
      />

      <section className="finance-section-card finance-account-snapshot">
        <header><div><span>账户</span><h2>原币种余额</h2></div><button onClick={onOpenAccounts}>管理账户</button></header>
        {accounts.length ? (
          <ul>
            {accounts.slice(0, 6).map((account) => (
              <li key={account.id}>
                <span className={`finance-account-mark is-${account.kind}`} aria-hidden />
                <div><strong>{account.name}</strong><span>{ACCOUNT_SUBTYPE_LABEL[account.subtype]}</span></div>
                <b><PrivateAmount>{formatMoney(balances.get(account.id) ?? 0, account.currency)}</PrivateAmount></b>
              </li>
            ))}
          </ul>
        ) : (
          <button className="finance-empty-action" onClick={onOpenAccounts}>创建第一个账户</button>
        )}
      </section>

    </div>
  )
}

function AccountsView({
  accounts,
  balances,
  transactions,
  onFeedback,
  onTransfer,
}: {
  accounts: Account[]
  balances: Map<string, number>
  transactions: FinanceTransaction[]
  onFeedback: (value: string) => void
  onTransfer: () => void
}) {
  const [editingId, setEditingId] = useState<string>()
  const editing = accounts.find((account) => account.id === editingId)
  const [open, setOpen] = useState(accounts.length === 0)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Account['kind']>('asset')
  const [ownership, setOwnership] = useState<NonNullable<Account['ownership']>>('self')
  const [subtype, setSubtype] = useState<Account['subtype']>('bank')
  const [currency, setCurrency] = useState<CurrencyCode>('JPY')
  const [opening, setOpening] = useState('0')
  const [includeNetWorth, setIncludeNetWorth] = useState(true)
  const [includeSpending, setIncludeSpending] = useState(true)
  const [billingCycleDay, setBillingCycleDay] = useState('')
  const [paymentDueDay, setPaymentDueDay] = useState('')
  const [defaultPaymentAccountId, setDefaultPaymentAccountId] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editing) return
    setName(editing.name)
    setKind(editing.kind === 'external' ? 'asset' : editing.kind)
    setOwnership(accountOwnership(editing))
    setSubtype(editing.subtype)
    setCurrency(editing.currency)
    setOpening(String(fromMinor(editing.openingBalanceMinor, editing.currency)))
    setIncludeNetWorth(editing.includeInNetWorth)
    setIncludeSpending(editing.includeInSpending)
    setBillingCycleDay(editing.billingCycleDay ? String(editing.billingCycleDay) : '')
    setPaymentDueDay(editing.paymentDueDay ? String(editing.paymentDueDay) : '')
    setDefaultPaymentAccountId(editing.defaultPaymentAccountId ?? '')
    setOpen(true)
  }, [editing])

  function reset() {
    setEditingId(undefined)
    setName('')
    setKind('asset')
    setOwnership('self')
    setSubtype('bank')
    setCurrency('JPY')
    setOpening('0')
    setIncludeNetWorth(true)
    setIncludeSpending(true)
    setBillingCycleDay('')
    setPaymentDueDay('')
    setDefaultPaymentAccountId('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      await saveAccount({
        id: editingId,
        name,
        kind,
        ownership,
        subtype,
        currency,
        openingBalanceMinor: toMinor(Number(opening) || 0, currency),
        includeInNetWorth: ownership === 'external' ? false : includeNetWorth,
        includeInSpending: includeSpending,
        billingCycleDay: Number(billingCycleDay) || undefined,
        paymentDueDay: Number(paymentDueDay) || undefined,
        defaultPaymentAccountId: defaultPaymentAccountId || undefined,
      })
      onFeedback(editingId ? '账户已更新' : '账户已创建')
      reset()
      setOpen(false)
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : '账户保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="finance-accounts-view">
      <div className="finance-view-heading">
        <div><span>{accounts.filter((account) => !account.isArchived).length} 个启用账户</span><h2>账户与支付来源</h2></div>
        <div><button onClick={onTransfer}>转账</button><button className="primary" onClick={() => { reset(); setOpen((value) => !value) }}>新增账户</button></div>
      </div>
      {open && (
        <form className="finance-section-card finance-account-editor" onSubmit={submit}>
          <label>账户名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 日本银行、Suica、父亲信用卡" /></label>
          <label>账户归属<select value={ownership} onChange={(event) => { const next = event.target.value as NonNullable<Account['ownership']>; setOwnership(next); if (next === 'external') setIncludeNetWorth(false) }}><option value="self">本人账户</option><option value="external">外部账户</option></select></label>
          <label>账户大类<select value={kind === 'external' ? 'asset' : kind} onChange={(event) => { const next = event.target.value as Account['kind']; setKind(next); setSubtype(accountDefaultSubtype(next)) }}><option value="asset">资产 / 储值账户</option><option value="credit">信用卡账户</option></select></label>
          <label>账户类型<select value={subtype === 'external_payer' || subtype === 'unspecified' ? (kind === 'credit' ? 'credit_card' : 'wallet') : subtype} onChange={(event) => setSubtype(event.target.value as Account['subtype'])}>{kind === 'asset' && <><option value="bank">银行账户</option><option value="cash">现金</option><option value="wallet">电子钱包 / 代付账户</option><option value="stored_value">储值卡 / 交通卡</option></>}{kind === 'credit' && <option value="credit_card">信用卡</option>}</select></label>
          <label>原始币种<select value={currency} onChange={(event) => setCurrency(event.target.value as CurrencyCode)}><option value="JPY">JPY 日元</option><option value="CNY">CNY 人民币</option></select></label>
          <label>初始{kind === 'credit' ? '待还金额' : '余额'}<input inputMode="decimal" value={opening} onChange={(event) => setOpening(event.target.value)} /></label>
          {kind === 'credit' && <><label>账单日<input inputMode="numeric" value={billingCycleDay} onChange={(event) => setBillingCycleDay(event.target.value)} placeholder="例如 15" /></label><label>预计扣款日<input inputMode="numeric" value={paymentDueDay} onChange={(event) => setPaymentDueDay(event.target.value)} placeholder="例如 27" /></label>{ownership === 'self' && <label>默认还款账户<select value={defaultPaymentAccountId} onChange={(event) => setDefaultPaymentAccountId(event.target.value)}><option value="">稍后选择</option>{accounts.filter((account) => account.kind === 'asset' && accountOwnership(account) === 'self' && !account.isArchived && account.currency === currency).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>}</>}
          <div className="finance-account-checks">
            <label><input type="checkbox" checked={includeNetWorth} disabled={ownership === 'external'} onChange={(event) => setIncludeNetWorth(event.target.checked)} />计入个人净资产</label>
            <label><input type="checkbox" checked={includeSpending} onChange={(event) => setIncludeSpending(event.target.checked)} />计入消费统计</label>
          </div>
          <div className="finance-form-actions"><button type="button" onClick={() => { reset(); setOpen(false) }}>取消</button><button className="primary" disabled={saving}>{saving ? '保存中…' : '保存账户'}</button></div>
        </form>
      )}
      <div className="finance-account-grid">
        {accounts.map((account) => {
          const month = todayISO().slice(0, 7)
          const monthPurchases = transactions.filter((transaction) => transaction.lifecycleStatus === 'active' && transaction.localDate.startsWith(month) && transaction.accountId === account.id && transaction.type === 'credit_purchase').reduce((sum, transaction) => sum + transaction.amountMinor, 0)
          const monthPayments = transactions.filter((transaction) => transaction.lifecycleStatus === 'active' && transaction.localDate.startsWith(month) && transaction.counterpartyAccountId === account.id && transaction.type === 'credit_payment').reduce((sum, transaction) => sum + (transaction.counterpartyAmountMinor ?? transaction.amountMinor), 0)
          return <article key={account.id} className="finance-account-card" data-archived={account.isArchived || undefined}>
            <header>
              <div className="finance-account-identity">
                <span className={`finance-account-mark is-${account.kind}`} />
                <div>
                  <span>{accountOwnership(account) === 'external' ? '外部账户' : '本人账户'} · {ACCOUNT_SUBTYPE_LABEL[account.subtype]}</span>
                  <h3>{account.name}</h3>
                </div>
              </div>
              <strong><PrivateAmount>{formatMoney(balances.get(account.id) ?? 0, account.currency)}</PrivateAmount></strong>
            </header>
            <small>{account.isArchived ? '已停用 · 历史仍保留' : accountOwnership(account) === 'external' ? '外部资金 · 不影响个人资产或负债' : account.kind === 'credit' ? <>本期 <PrivateAmount>{formatMoney(monthPurchases, account.currency)}</PrivateAmount> · 已还 <PrivateAmount>{formatMoney(monthPayments, account.currency)}</PrivateAmount>{account.paymentDueDay ? ` · ${account.paymentDueDay} 日扣款` : ''}</> : '当前余额'}</small>
            <footer className="finance-account-card-actions">
              <button aria-label="上移账户" onClick={() => void moveAccount(account.id, -1)}>上移</button>
              <button aria-label="下移账户" onClick={() => void moveAccount(account.id, 1)}>下移</button>
              <button onClick={() => setEditingId(account.id)}>编辑</button>
              <button onClick={() => void setAccountArchived(account.id, !account.isArchived)}>{account.isArchived ? '启用' : '停用'}</button>
            </footer>
          </article>
        })}
      </div>
    </div>
  )
}

function TransactionsView({
  transactions,
  accounts,
  onNew,
  onEdit,
  onFeedback,
}: {
  transactions: FinanceTransaction[]
  accounts: Account[]
  onNew: (kind: EntryKind) => void
  onEdit: (transaction: FinanceTransaction) => void
  onFeedback: (value: string) => void
}) {
  const [filter, setFilter] = useState<'all' | 'spending' | 'income' | 'transfer'>('all')
  const visible = transactions.filter((transaction) => {
    if (filter === 'all') return true
    if (filter === 'income') return transaction.type === 'income' || transaction.type === 'refund'
    if (filter === 'transfer') return ['transfer', 'topup', 'credit_payment'].includes(transaction.type)
    return ['expense', 'credit_purchase', 'external_payment'].includes(transaction.type)
  })

  return (
    <div className="finance-transactions-view">
      <div className="finance-view-heading">
        <div><span>{visible.length} 条记录</span><h2>资金流水</h2></div>
        <button className="primary" onClick={() => onNew('expense')}>快速记账</button>
      </div>
      <div className="finance-compact-filter">
        {(['all', 'spending', 'income', 'transfer'] as const).map((value) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? '全部' : value === 'spending' ? '消费' : value === 'income' ? '收入 / 退款' : '转账 / 还款'}</button>)}
      </div>
      <TransactionList
        title="全部流水"
        transactions={visible}
        accounts={accounts}
        onEdit={onEdit}
        onDelete={async (transaction) => {
          if (!window.confirm(`删除“${TRANSACTION_LABEL[transaction.type]}”记录？`)) return
          try {
            await softDeleteFinanceTransaction(transaction.id)
            onFeedback('流水已删除，相关账户余额已立即重算')
          } catch (error) {
            onFeedback(error instanceof Error ? error.message : '删除失败')
          }
        }}
      />
    </div>
  )
}

function TransactionList({
  title,
  transactions,
  accounts,
  onSeeAll,
  onEdit,
  onDelete,
}: {
  title: string
  transactions: FinanceTransaction[]
  accounts: Account[]
  onSeeAll?: () => void
  onEdit?: (transaction: FinanceTransaction) => void
  onDelete?: (transaction: FinanceTransaction) => void
}) {
  const accountMap = new Map(accounts.map((account) => [account.id, account]))
  return (
    <section className="finance-section-card finance-transaction-list">
      <header><div><span>按发生时间排序</span><h2>{title}</h2></div>{onSeeAll && <button onClick={onSeeAll}>查看全部</button>}</header>
      {transactions.length ? <ul>{transactions.map((transaction) => {
        const account = accountMap.get(transaction.accountId)
        const positive = transaction.type === 'income' || transaction.type === 'refund'
        const external = transaction.type === 'external_payment' || transaction.fundingParty === 'external' || accountOwnership(account) === 'external'
        return <li key={transaction.id}>
          <span className={`finance-transaction-icon is-${transaction.type}`}><AppIcon name={positive ? 'plus' : transaction.type.includes('transfer') || transaction.type === 'topup' || transaction.type === 'credit_payment' ? 'sync' : 'receipt'} size={18} /></span>
          <div><strong>{transaction.merchantNameSnapshot || transaction.note || TRANSACTION_LABEL[transaction.type]}</strong><span>{transaction.localDate} · {account?.name ?? '未知账户'} · {TRANSACTION_LABEL[transaction.type]} {external && <em>外部代付</em>}</span></div>
          <b className={positive ? 'is-positive' : ''}><PrivateAmount>{`${positive ? '+' : transaction.type === 'external_payment' ? '' : '−'}${formatMoney(transaction.amountMinor, transaction.currency)}`}</PrivateAmount></b>
          {(onEdit || onDelete) && <span className="finance-row-actions">{onEdit && ['expense', 'credit_purchase', 'external_payment'].includes(transaction.type) && <button aria-label="编辑流水" onClick={() => onEdit(transaction)}><AppIcon name="edit" size={17} /></button>}{onDelete && <button aria-label="删除流水" onClick={() => onDelete(transaction)}><AppIcon name="trash" size={17} /></button>}</span>}
        </li>
      })}</ul> : <div className="finance-empty-state"><AppIcon name="receipt" size={24} /><span>还没有流水</span></div>}
    </section>
  )
}

function WorkView({
  entries,
  templates,
  accounts,
  initialDate,
  onFeedback,
}: {
  entries: WorkEntry[]
  templates: WorkTemplate[]
  accounts: Account[]
  initialDate: string
  onFeedback: (value: string) => void
}) {
  const payoutAccounts = accounts.filter(
    (account) =>
      account.kind === 'asset' &&
      accountOwnership(account) === 'self' &&
      !account.isArchived,
  )
  const wageSettings = useLiveQuery(() => db.wageSettings.get('#wage'), [])
  const lastDefaultsApplied = useRef(false)
  const [date, setDate] = useState(initialDate)
  const [hours, setHours] = useState('8')
  const [breakMinutes, setBreakMinutes] = useState('60')
  const [hourlyRate, setHourlyRate] = useState('1250')
  const [currency, setCurrency] = useState<CurrencyCode>('JPY')
  const [content, setContent] = useState('')
  const [location, setLocation] = useState('')
  const [employer, setEmployer] = useState('')
  const [payoutAccountId, setPayoutAccountId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [templateName, setTemplateName] = useState('')
  const [saving, setSaving] = useState(false)
  const [settlementEntryId, setSettlementEntryId] = useState('')
  const [actualPaidAmount, setActualPaidAmount] = useState('')
  const [settling, setSettling] = useState(false)

  const activeEntries = [...entries].sort((a, b) => b.date.localeCompare(a.date))
  const pending = activeEntries.filter((entry) => entry.settlementStatus === 'unsettled' && entry.worked)
  const pendingByCurrency = pending.reduce((totals, entry) => {
    totals.set(entry.currency, (totals.get(entry.currency) ?? 0) + entry.estimatedGrossMinor)
    return totals
  }, new Map<CurrencyCode, number>())
  const pendingEstimateLabel = pendingByCurrency.size > 0
    ? [...pendingByCurrency].map(([entryCurrency, amount]) =>
        formatMoney(amount, entryCurrency),
      ).join(' + ')
    : formatMoney(0, currency)

  useEffect(() => {
    if (lastDefaultsApplied.current) return
    const last = activeEntries[0]
    if (last) {
      setContent(last.workContent ?? '')
      setLocation(last.workLocation ?? '')
      setEmployer(last.employer ?? '')
      setBreakMinutes(String(last.breakMinutes))
      setHourlyRate(String(fromMinor(last.hourlyRateMinor, last.currency)))
      setCurrency(last.currency)
      setPayoutAccountId(last.payoutAccountId ?? '')
      lastDefaultsApplied.current = true
    } else if (wageSettings) {
      setHourlyRate(String(wageSettings.defaultHourlyRate))
      setCurrency(wageSettings.currency)
      lastDefaultsApplied.current = true
    }
  }, [activeEntries, wageSettings])

  function applyTemplate(id: string) {
    setTemplateId(id)
    const template = templates.find((item) => item.id === id)
    if (!template) return
    setContent(template.workContent ?? '')
    setLocation(template.workLocation ?? '')
    setEmployer(template.employer ?? '')
    setBreakMinutes(String(template.breakMinutes))
    setHourlyRate(String(fromMinor(template.hourlyRateMinor, template.currency)))
    setCurrency(template.currency)
    setPayoutAccountId(template.payoutAccountId ?? '')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      const grossMinutes = Math.round(Number(hours) * 60)
      const unpaidBreak = Math.max(0, Number(breakMinutes) || 0)
      await saveWorkEntry({
        date,
        worked: true,
        workContent: content,
        employer,
        workLocation: location,
        durationMinutes: Math.max(0, grossMinutes - unpaidBreak),
        breakMinutes: unpaidBreak,
        paidBreak: false,
        hourlyRateMinor: toMinor(Number(hourlyRate) || 0, currency),
        currency,
        payoutAccountId: payoutAccountId || undefined,
        templateId: templateId || undefined,
      })
      onFeedback('工作记录已保存；预计工资不会提前增加账户余额')
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : '工作记录保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function createTemplate() {
    try {
      await saveWorkTemplate({
        name: templateName || content || '常用工作',
        workContent: content,
        employer,
        workLocation: location,
        breakMinutes: Number(breakMinutes) || 0,
        paidBreak: false,
        hourlyRateMinor: toMinor(Number(hourlyRate) || 0, currency),
        currency,
        payoutAccountId: payoutAccountId || undefined,
      })
      setTemplateName('')
      onFeedback('工作模板已保存，下次可一键带入')
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : '模板保存失败')
    }
  }

  function beginSettlement(entry: WorkEntry) {
    setSettlementEntryId(entry.id)
    setActualPaidAmount(String(fromMinor(entry.estimatedGrossMinor, entry.currency)))
  }

  async function settleOne(entry: WorkEntry) {
    if (settling) return
    const savedTarget = payoutAccounts.find((account) => account.id === entry.payoutAccountId)
    const target = savedTarget?.id || payoutAccountId
    if (!target) {
      onFeedback('请先选择工资入账账户')
      return
    }
    setSettling(true)
    try {
      await settlePaycheck({
        workEntryIds: [entry.id],
        payoutAccountId: target,
        actualAmountMinor: toMinor(Number(actualPaidAmount), entry.currency),
        currency: entry.currency,
        paidDate: todayISO(),
      })
      setSettlementEntryId('')
      setActualPaidAmount('')
      onFeedback('工资已实际入账，并锁定该工作记录防止重复结算')
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : '工资入账失败')
    } finally {
      setSettling(false)
    }
  }

  return (
    <div className="finance-work-v2">
      <div className="finance-view-heading"><div><span>待结算 {pending.length} 条</span><h2>工资与工时</h2></div><strong><PrivateAmount>{pendingEstimateLabel}</PrivateAmount> 预计税前</strong></div>
      <form className="finance-section-card finance-work-composer" onSubmit={submit}>
        <header><div><span>预计工资不计入余额</span><h2>记录工作</h2></div>{templates.length > 0 && <select value={templateId} onChange={(event) => applyTemplate(event.target.value)}><option value="">选择模板</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select>}</header>
        <div className="finance-form-grid-v2">
          <label>日期<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label>工作时长<input inputMode="decimal" value={hours} onChange={(event) => setHours(event.target.value)} /></label>
          <label>休息分钟<input inputMode="numeric" value={breakMinutes} onChange={(event) => setBreakMinutes(event.target.value)} /></label>
          <label>时薪<input inputMode="decimal" value={hourlyRate} onChange={(event) => setHourlyRate(event.target.value)} /></label>
          <label>币种<select value={currency} onChange={(event) => setCurrency(event.target.value as CurrencyCode)}><option value="JPY">JPY</option><option value="CNY">CNY</option></select></label>
          <label>工资入账账户<select value={payoutAccountId} onChange={(event) => setPayoutAccountId(event.target.value)}><option value="">稍后选择</option>{payoutAccounts.filter((account) => account.currency === currency).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
          <label>工作内容<input value={content} onChange={(event) => setContent(event.target.value)} placeholder="会记住到模板" /></label>
          <label>工作地点<input value={location} onChange={(event) => setLocation(event.target.value)} /></label>
          <label className="wide">雇主 / 项目<input value={employer} onChange={(event) => setEmployer(event.target.value)} /></label>
        </div>
        <div className="finance-work-actions"><div><input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="模板名称" /><button type="button" onClick={() => void createTemplate()}>保存为模板</button></div><button className="primary" disabled={saving}>{saving ? '保存中…' : '保存工作记录'}</button></div>
      </form>
      <section className="finance-section-card finance-work-records-v2">
        <header><div><span>按日期查看</span><h2>工作记录</h2></div><strong>{activeEntries.length} 条</strong></header>
        {activeEntries.length ? <ul>{activeEntries.map((entry) => <li key={entry.id}><div><strong>{entry.workContent || entry.employer || '工作'}</strong><span>{entry.date} · {formatMinutes(entry.durationMinutes)}{entry.workLocation ? ` · ${entry.workLocation}` : ''}</span></div><b><PrivateAmount>{formatMoney(entry.estimatedGrossMinor, entry.currency)}</PrivateAmount></b>{entry.settlementStatus === 'settled' ? <em>已入账</em> : settlementEntryId === entry.id ? <div className="finance-settlement-inline"><label>实际到账<input autoFocus inputMode="decimal" value={actualPaidAmount} onChange={(event) => setActualPaidAmount(event.target.value)} /></label><button type="button" disabled={settling || !actualPaidAmount} onClick={() => void settleOne(entry)}>{settling ? '入账中…' : '确认入账'}</button><button type="button" disabled={settling} onClick={() => setSettlementEntryId('')}>取消</button></div> : <button type="button" onClick={() => beginSettlement(entry)}>实际入账</button>}</li>)}</ul> : <div className="finance-empty-state">还没有工作记录</div>}
      </section>
    </div>
  )
}

function StatsView({
  accounts,
  transactions,
  rates,
  reportingCurrency,
  onFeedback,
}: {
  accounts: Account[]
  transactions: FinanceTransaction[]
  rates: ExchangeRate[]
  reportingCurrency: CurrencyCode
  onFeedback: (value: string) => void
}) {
  const [startDate, setStartDate] = useState(monthStartISO())
  const [endDate, setEndDate] = useState(todayISO())
  const [refreshing, setRefreshing] = useState(false)
  const [manualRate, setManualRate] = useState('')
  const [manualRateDate, setManualRateDate] = useState(todayISO())
  const summary = useMemo(
    () => ledgerSummary({
      accounts,
      transactions,
      rates,
      reportingCurrency,
      startDate,
      endDate,
    }),
    [accounts, transactions, rates, reportingCurrency, startDate, endDate],
  )
  const categories = new Map<string, number>()
  const merchants = new Map<string, number>()
  const transactionById = new Map(
    transactions.map((transaction) => [transaction.id, transaction]),
  )
  for (const transaction of transactions) {
    if (transaction.localDate < startDate || transaction.localDate > endDate) continue
    if (
      !transaction.includeInSpending ||
      !['expense', 'credit_purchase', 'external_payment', 'refund'].includes(transaction.type)
    ) continue
    const value = transaction.reportingCurrency === reportingCurrency
      ? transaction.reportingAmountMinor ?? 0
      : transaction.currency === reportingCurrency
        ? transaction.amountMinor
        : 0
    const linked = transaction.linkedTransactionId
      ? transactionById.get(transaction.linkedTransactionId)
      : undefined
    const category = transaction.categoryNameSnapshot ?? linked?.categoryNameSnapshot ?? '未分类'
    const merchant = transaction.merchantNameSnapshot ?? linked?.merchantNameSnapshot ?? '未填写商家'
    const signedValue = transaction.type === 'refund' ? -value : value
    categories.set(category, (categories.get(category) ?? 0) + signedValue)
    merchants.set(merchant, (merchants.get(merchant) ?? 0) + signedValue)
  }
  const latest = [...rates].sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt))[0]

  async function refresh() {
    setRefreshing(true)
    try {
      const base = reportingCurrency === 'JPY' ? 'CNY' : 'JPY'
      const rate = await refreshExchangeRate({ baseCurrency: base, quoteCurrency: reportingCurrency })
      onFeedback(`汇率已更新：${rate.providerLabel} · ${rate.rateDate}`)
    } catch (error) {
      const cached = await cachedRate(reportingCurrency === 'JPY' ? 'CNY' : 'JPY', reportingCurrency)
      onFeedback(cached ? `联网失败，继续使用 ${cached.rateDate} 的缓存汇率` : error instanceof Error ? error.message : '汇率更新失败')
    } finally {
      setRefreshing(false)
    }
  }

  async function saveManualRate(event: FormEvent) {
    event.preventDefault()
    const base = reportingCurrency === 'JPY' ? 'CNY' : 'JPY'
    try {
      const rate = await saveManualExchangeRate({
        baseCurrency: base,
        quoteCurrency: reportingCurrency,
        rate: Number(manualRate),
        rateDate: manualRateDate,
      })
      setManualRate('')
      onFeedback(`手动汇率已保存：${rate.baseCurrency}/${rate.quoteCurrency} · ${rate.rateDate}`)
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : '手动汇率保存失败')
    }
  }

  return (
    <div className="finance-stats-view">
      <details className="finance-range-panel">
        <summary>
          <span>统计范围</span>
          <strong>{startDate} — {endDate}</strong>
          <AppIcon name="chevronDown" size={18} />
        </summary>
        <div className="finance-range-fields">
          <input aria-label="开始日期" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          <span>至</span>
          <input aria-label="结束日期" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </div>
      </details>
      <div className="finance-ledger-metrics">
        <article><span>净资产</span><strong><PrivateAmount>{formatMoney(summary.netWorthMinor, reportingCurrency)}</PrivateAmount></strong><small>资产减个人负债</small></article>
        <article><span>全部消费</span><strong><PrivateAmount>{formatMoney(summary.consumptionMinor, reportingCurrency)}</PrivateAmount></strong><small>含外部代付</small></article>
        <article><span>个人支付</span><strong><PrivateAmount>{formatMoney(summary.actualPaidMinor, reportingCurrency)}</PrivateAmount></strong><small>不含还款重复项</small></article>
        <article><span>外部代付</span><strong><PrivateAmount>{formatMoney(summary.externalPaidMinor, reportingCurrency)}</PrivateAmount></strong><small>消费行为，不影响资产</small></article>
      </div>
      {categories.size || merchants.size ? (
        <div className="finance-breakdown-grid-v2">
          <Breakdown title="按分类" data={[...categories.entries()].sort((a, b) => b[1] - a[1])} currency={reportingCurrency} />
          <Breakdown title="按商家 / 地点" data={[...merchants.entries()].sort((a, b) => b[1] - a[1])} currency={reportingCurrency} />
        </div>
      ) : (
        <section className="finance-section-card finance-stats-empty">
          <AppIcon name="finance" size={24} />
          <div><h2>还没有支出统计</h2><span>添加支出后会在这里按分类和商家汇总</span></div>
        </section>
      )}
      <section className="finance-section-card finance-rate-card">
        <header><div><span>余额使用最新缓存率；历史流水使用发生日快照</span><h2>汇率</h2></div><button disabled={refreshing} onClick={() => void refresh()}>{refreshing ? '更新中…' : '手动刷新'}</button></header>
        <p>{latest ? `${latest.baseCurrency}/${latest.quoteCurrency} ${latest.rate} · ${latest.providerLabel} · ${latest.rateDate}` : '还没有缓存汇率；记账仍可离线完成'}</p>
        {summary.missingRates.length > 0 && <small>缺少 {summary.missingRates.join('、')}，相关账户暂未计入汇总币种；原币种余额不受影响。</small>}
        <details className="finance-manual-rate">
          <summary>设置手动汇率</summary>
          <form className="finance-form-grid-v2" onSubmit={saveManualRate}>
            <label>{reportingCurrency === 'JPY' ? 'CNY/JPY' : 'JPY/CNY'}<input inputMode="decimal" value={manualRate} onChange={(event) => setManualRate(event.target.value)} placeholder="输入参考汇率" /></label>
            <label>汇率日期<input type="date" value={manualRateDate} onChange={(event) => setManualRateDate(event.target.value)} /></label>
            <button className="primary wide" disabled={!manualRate}>保存手动汇率</button>
          </form>
        </details>
      </section>
    </div>
  )
}

function Breakdown({ title, data, currency }: { title: string; data: [string, number][]; currency: CurrencyCode }) {
  return <section className="finance-section-card finance-breakdown-v2"><header><div><span>本月消费</span><h2>{title}</h2></div></header>{data.length ? <ul>{data.slice(0, 10).map(([label, value]) => <li key={label}><span>{label}</span><strong><PrivateAmount>{formatMoney(value, currency)}</PrivateAmount></strong></li>)}</ul> : <div className="finance-empty-state">暂无可统计数据</div>}</section>
}

function ExpenseCategoryManager({
  categories,
  accounts,
  fundPools,
  onFeedback,
}: {
  categories: ExpenseCategory[]
  accounts: Account[]
  fundPools: FundPool[]
  onFeedback: (value: string) => void
}) {
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string>()
  const [editingName, setEditingName] = useState('')
  const [archivingId, setArchivingId] = useState<string>()

  async function create() {
    try {
      await saveExpenseCategory({ name: newName })
      setNewName('')
      onFeedback('分类已添加')
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : '分类添加失败')
    }
  }

  async function move(id: string, direction: -1 | 1) {
    try {
      await moveExpenseCategory(id, direction)
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : '分类排序失败')
    }
  }

  async function archive(id: string, replacementId?: string) {
    try {
      await archiveExpenseCategory(id, replacementId)
      setArchivingId(undefined)
      onFeedback(replacementId
        ? `已合并到「${categories.find((item) => item.id === replacementId)?.name ?? '目标分类'}」`
        : '分类已归档，历史记录转为未分类')
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : '分类归档失败')
    }
  }

  async function updateDefaults(
    category: ExpenseCategory,
    changes: {
      defaultAccountId?: string | null
      defaultFundPoolId?: string | null
      icon?: MarkerSymbol
      colorToken?: ColorToken
    },
  ) {
    try {
      await saveExpenseCategory({
        id: category.id,
        name: category.name,
        icon: category.icon,
        colorToken: category.colorToken,
        ...changes,
      })
      onFeedback('分类设置已保存')
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : '默认规则保存失败')
    }
  }

  return (
    <div className="expense-category-manager">
      <div className="expense-category-create">
        <input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void create()}
          placeholder="新建分类，例如 美容"
        />
        <button type="button" disabled={!newName.trim()} onClick={() => void create()}>添加</button>
      </div>
      <ul>
        {categories.map((category, index) => (
          <li key={category.id}>
            <span className="expense-category-dot" data-color-token={category.colorToken} aria-hidden><MarkerIcon symbol={category.icon ?? 'dot'} color={category.colorToken} size={18} /></span>
            {editingId === category.id ? (
              <input
                autoFocus
                value={editingName}
                onChange={(event) => setEditingName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setEditingId(undefined)
                  if (event.key === 'Enter') {
                    void saveExpenseCategory({ id: category.id, name: editingName, icon: category.icon })
                      .then(() => { setEditingId(undefined); onFeedback('分类已重命名') })
                      .catch((error: unknown) => onFeedback(error instanceof Error ? error.message : '重命名失败'))
                  }
                }}
              />
            ) : <strong>{category.name}</strong>}
            <div className="expense-category-row-actions">
              <button type="button" aria-label={`上移 ${category.name}`} disabled={index === 0} onClick={() => void move(category.id, -1)}>↑</button>
              <button type="button" aria-label={`下移 ${category.name}`} disabled={index === categories.length - 1} onClick={() => void move(category.id, 1)}>↓</button>
              <button type="button" onClick={() => { setEditingId(category.id); setEditingName(category.name) }}>重命名</button>
              <button type="button" onClick={() => setArchivingId((value) => value === category.id ? undefined : category.id)}>归档</button>
            </div>
            <details className="expense-category-defaults">
              <summary>默认规则</summary>
              <label>图标<select value={category.icon ?? 'dot'} onChange={(event) => void updateDefaults(category, { icon: event.target.value as MarkerSymbol })}><option value="dot">圆点</option><option value="flower">花形</option><option value="star">星形</option><option value="diamond">菱形</option><option value="spark">闪光</option><option value="squircle">圆角方形</option></select></label>
              <label>颜色<select value={category.colorToken} onChange={(event) => void updateDefaults(category, { colorToken: event.target.value as ColorToken })}><option value="gray">灰色</option><option value="blue">蓝色</option><option value="green">绿色</option><option value="orange">橙色</option><option value="pink">粉色</option><option value="purple">紫色</option></select></label>
              <label>支付账户<select value={category.defaultAccountId ?? ''} onChange={(event) => void updateDefaults(category, { defaultAccountId: event.target.value || null })}><option value="">不预填</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label>
              <label>承担资金池<select value={category.defaultFundPoolId ?? ''} onChange={(event) => void updateDefaults(category, { defaultFundPoolId: event.target.value || null })}><option value="">不预填</option>{fundPools.map((pool) => <option key={pool.id} value={pool.id}>{pool.name} · {pool.currency}</option>)}</select></label>
            </details>
            {archivingId === category.id && (
              <div className="expense-category-merge-options">
                <span>历史流水处理：</span>
                <button type="button" onClick={() => void archive(category.id)}>转为未分类</button>
                {categories.filter((item) => item.id !== category.id).map((item) => (
                  <button key={item.id} type="button" onClick={() => void archive(category.id, item.id)}>合并到 {item.name}</button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      <p>“未分类”是系统保底项，不会被删除。</p>
    </div>
  )
}

function ExpenseCategoryManagerSheet({
  categories,
  accounts,
  fundPools,
  onClose,
  onFeedback,
}: {
  categories: ExpenseCategory[]
  accounts: Account[]
  fundPools: FundPool[]
  onClose: () => void
  onFeedback: (value: string) => void
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const sheetRef = useRef<GestureSheetHandle>(null)
  return (
    <GestureSheet ref={sheetRef} dialogRef={dialogRef} labelledBy="expense-category-manager-title" className="editor-sheet expense-category-sheet" onClose={onClose}>
      <div className="category-sheet-layout">
        <header><div><span>支出分类</span><h2 id="expense-category-manager-title">分类管理</h2></div><button type="button" aria-label="关闭" onClick={() => sheetRef.current?.close()}><AppIcon name="close" size={20} /></button></header>
        <div className="category-sheet-scroll"><ExpenseCategoryManager categories={categories} accounts={accounts} fundPools={fundPools} onFeedback={onFeedback} /></div>
      </div>
    </GestureSheet>
  )
}

type FinancePickerTarget =
  | { kind: 'category' }
  | { kind: 'source' }
  | { kind: 'destination' }
  | { kind: 'refund-origin' }
  | { kind: 'refund-account' }
  | { kind: 'fund-pool'; index: number }

function FinancePickerRow({
  label,
  value,
  placeholder,
  onClick,
}: {
  label: string
  value?: string
  placeholder: string
  onClick: () => void
}) {
  return (
    <div className="finance-picker-field">
      <span>{label}</span>
      <button type="button" className="finance-picker-row" onClick={onClick}>
        <strong data-placeholder={!value || undefined}>{value || placeholder}</strong>
        <AppIcon name="chevronRight" size={17} />
      </button>
    </div>
  )
}

function FinanceEntrySheet({
  initialKind,
  editing,
  accounts,
  transactions,
  categories,
  fundPools,
  transactionFundAllocations,
  reportingCurrency,
  onSaved,
  onClose,
}: {
  initialKind: EntryKind
  editing?: FinanceTransaction
  accounts: Account[]
  transactions: FinanceTransaction[]
  categories: ExpenseCategory[]
  fundPools: FundPool[]
  transactionFundAllocations: TransactionFundAllocation[]
  reportingCurrency: CurrencyCode
  onSaved: (message: string) => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const sheetRef = useRef<GestureSheetHandle>(null)
  const kindBarRef = useRef<HTMLDivElement>(null)
  const previousKindRef = useRef(initialKind)
  const savedMessageRef = useRef('')
  const submittedRef = useRef(false)
  const draftsRef = useRef<Partial<Record<EntryKind, {
    destinationId: string
    destinationAmount: string
    categoryId: string
    merchant: string
    linkedTransactionId: string
    fee: string
  }>>>({})
  const entryDefaults = useMemo(loadFinanceEntryDefaults, [])
  const activeAccounts = accounts.filter((account) => !account.isArchived)
  const initialEntryRef = useRef({
    accountId: editing?.accountId ??
      (entryDefaults.accountId && activeAccounts.some((account) => account.id === entryDefaults.accountId)
        ? entryDefaults.accountId
        : activeAccounts[0]?.id) ?? '',
    categoryId: editing?.categoryId ??
      (entryDefaults.categoryId && categories.some((category) => category.id === entryDefaults.categoryId)
        ? entryDefaults.categoryId
        : ''),
    fundAllocations: (() => {
      const editingAllocations = transactionFundAllocations.filter((row) =>
        row.transactionId === editing?.id && ['debit', 'reserve'].includes(row.effect),
      )
      if (editingAllocations.length > 0) {
        return editingAllocations.map((row) => ({
          fundPoolId: row.fundPoolId,
          amount: String(fromMinor(row.amountMinor, row.currency)),
        }))
      }
      return entryDefaults.fundPoolId && fundPools.some((pool) => pool.id === entryDefaults.fundPoolId)
        ? [{ fundPoolId: entryDefaults.fundPoolId, amount: '' }]
        : []
    })(),
  })
  const initialEntry = initialEntryRef.current
  const reduceMotion = useReducedMotion()
  const [kind, setKind] = useState<EntryKind>(initialKind)
  const [amount, setAmount] = useState(editing ? String(fromMinor(editing.amountMinor, editing.currency)) : '')
  const [date, setDate] = useState(editing?.localDate ?? todayISO())
  const [accountId, setAccountId] = useState(initialEntry.accountId)
  const [destinationId, setDestinationId] = useState('')
  const [destinationAmount, setDestinationAmount] = useState('')
  const [fee, setFee] = useState('')
  const [categoryId, setCategoryId] = useState(initialEntry.categoryId)
  const existingAllocations = transactionFundAllocations.filter((row) =>
    row.transactionId === editing?.id && ['debit', 'reserve'].includes(row.effect),
  )
  const [fundAllocationDrafts, setFundAllocationDrafts] = useState<Array<{ fundPoolId: string; amount: string }>>(
    initialEntry.fundAllocations,
  )
  const [allocationsTouched, setAllocationsTouched] = useState(existingAllocations.length > 1)
  const [merchant, setMerchant] = useState(editing?.merchantNameSnapshot ?? '')
  const [note, setNote] = useState(editing?.note ?? '')
  const [includeInSpending, setIncludeInSpending] = useState(editing?.includeInSpending ?? true)
  const [linkedTransactionId, setLinkedTransactionId] = useState('')
  const [pickerTarget, setPickerTarget] = useState<FinancePickerTarget | null>(null)
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fundPoolTransfersLive = useLiveQuery(
    () => db.fundPoolTransfers.where('lifecycleStatus').equals('active').toArray(),
    [],
  )
  const fundReservationsLive = useLiveQuery(() => db.fundReservations.toArray(), [], [])
  const fundPoolTransfers = useMemo(() => fundPoolTransfersLive ?? [], [fundPoolTransfersLive])
  const fundReservations = useMemo(() => fundReservationsLive ?? [], [fundReservationsLive])
  const transferKinds = ['transfer', 'credit_payment', 'topup'].includes(kind)
  const sourceOptions = useMemo(
    () => accounts.filter((account) => {
      if (account.isArchived) return false
      if (transferKinds || kind === 'income') {
        return account.kind === 'asset' && accountOwnership(account) === 'self'
      }
      return true
    }),
    [accounts, kind, transferKinds],
  )
  const refundedByOriginal = new Map<string, number>()
  for (const transaction of transactions) {
    if (
      transaction.lifecycleStatus === 'active' &&
      transaction.type === 'refund' &&
      transaction.linkedTransactionId
    ) {
      refundedByOriginal.set(
        transaction.linkedTransactionId,
        (refundedByOriginal.get(transaction.linkedTransactionId) ?? 0) + transaction.amountMinor,
      )
    }
  }
  const refundableTransactions = transactions
    .filter(
      (transaction) =>
        transaction.lifecycleStatus === 'active' &&
        ['expense', 'credit_purchase', 'external_payment'].includes(transaction.type) &&
        (refundedByOriginal.get(transaction.id) ?? 0) < transaction.amountMinor,
    )
    .sort((a, b) => b.localDate.localeCompare(a.localDate))
  const selectedRefundOrigin = refundableTransactions.find(
    (transaction) => transaction.id === linkedTransactionId,
  )
  const effectiveAccountId = kind === 'refund'
    ? selectedRefundOrigin?.accountId ?? ''
    : accountId
  const source = accounts.find((account) => account.id === effectiveAccountId)
  const currency = source?.currency ?? selectedRefundOrigin?.currency ?? 'JPY'
  const destinationOptions = accounts.filter((account) => {
    if (account.isArchived) return false
    if (account.id === accountId) return false
    if (kind === 'credit_payment') return account.kind === 'credit' && accountOwnership(account) === 'self'
    if (kind === 'topup') return account.kind === 'asset' && accountOwnership(account) === 'self' && ['stored_value', 'wallet'].includes(account.subtype)
    return account.kind === 'asset' && accountOwnership(account) === 'self'
  })
  const refundFundingParty = selectedRefundOrigin
    ? selectedRefundOrigin.fundingParty ?? accountOwnership(
        accounts.find((account) => account.id === selectedRefundOrigin.accountId),
      )
    : undefined
  const refundAccountOptions = accounts.filter((account) =>
    !account.isArchived &&
    account.currency === currency &&
    (refundFundingParty === 'external'
      ? accountOwnership(account) === 'external'
      : accountOwnership(account) === 'self'),
  )
  const dirty = Boolean(
    amount || destinationAmount || fee || merchant.trim() || note.trim() || linkedTransactionId ||
    date !== (editing?.localDate ?? todayISO()) ||
    accountId !== initialEntry.accountId ||
    categoryId !== initialEntry.categoryId ||
    JSON.stringify(fundAllocationDrafts) !== JSON.stringify(initialEntry.fundAllocations)
  )
  const selectedCategory = categories.find((category) => category.id === categoryId)
  const eligibleFundPools = fundPools.filter((pool) =>
    pool.lifecycleStatus === 'active' && pool.currency === currency,
  )
  const fundPoolStates = useMemo(
    () => calculateFundPoolStates({
      pools: fundPools,
      allocations: transactionFundAllocations.filter((row) => row.transactionId !== editing?.id),
      transfers: fundPoolTransfers,
      reservations: fundReservations.filter((row) => row.transactionId !== editing?.id),
    }),
    [editing?.id, fundPoolTransfers, fundPools, fundReservations, transactionFundAllocations],
  )
  const amountNumber = Number(amount)
  const amountValid = Number.isFinite(amountNumber) && amountNumber > 0
  const destinationAmountNumber = Number(destinationAmount)
  const destinationAmountValid = !destinationAmount || (
    Number.isFinite(destinationAmountNumber) && destinationAmountNumber > 0
  )
  const feeNumber = Number(fee)
  const feeValid = !fee || (Number.isFinite(feeNumber) && feeNumber >= 0)
  const allocationsTotal = fundAllocationDrafts.reduce(
    (sum, row) => sum + (Number.isFinite(Number(row.amount)) ? Number(row.amount) : 0),
    0,
  )
  const needsFundAllocation = kind === 'expense' && accountOwnership(source) === 'self' && financeFundsV3Enabled
  const allocationShortages = fundAllocationDrafts.flatMap((row) => {
    const pool = fundPools.find((item) => item.id === row.fundPoolId)
    const requested = Number(row.amount)
    if (!pool || !Number.isFinite(requested) || requested <= 0) return []
    const availableMinor = fundPoolStates.get(pool.id)?.availableMinor ?? 0
    const requestedMinor = toMinor(requested, pool.currency)
    return requestedMinor > availableMinor
      ? [{
          fundPoolId: pool.id,
          name: pool.name,
          currency: pool.currency,
          differenceMinor: requestedMinor - availableMinor,
        }]
      : []
  })
  const canSubmit = Boolean(
    amountValid && date &&
    (kind === 'refund' ? linkedTransactionId && destinationId : source) &&
    (!transferKinds || destinationId) &&
    destinationAmountValid && feeValid &&
    (!needsFundAllocation || (
      fundAllocationDrafts.length > 0 &&
      fundAllocationDrafts.every((row) => row.fundPoolId && Number(row.amount) > 0) &&
      Math.abs(allocationsTotal - amountNumber) < 0.000001 &&
      allocationShortages.length === 0
    )),
  )

  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    const bar = kindBarRef.current
    const active = bar?.querySelector<HTMLButtonElement>(`button[data-kind="${kind}"]`)
    if (!bar || !active) return
    const left = active.offsetLeft - (bar.clientWidth - active.offsetWidth) / 2
    bar.scrollTo({ left: Math.max(0, left), behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [kind, reduceMotion])

  useEffect(() => {
    if (kind === 'refund' || sourceOptions.some((account) => account.id === accountId)) return
    setAccountId(sourceOptions[0]?.id ?? '')
  }, [accountId, kind, sourceOptions])

  useEffect(() => {
    if (kind !== 'expense' || accountOwnership(source) === 'external') return
    if (!allocationsTouched && fundAllocationDrafts.length === 1 && amount) {
      setFundAllocationDrafts((current) => [{ ...current[0], amount }])
    }
  }, [allocationsTouched, amount, fundAllocationDrafts.length, kind, source])

  useEffect(() => {
    if (kind !== 'expense') return
    setFundAllocationDrafts((current) => current.filter((row) =>
      fundPools.some((pool) => pool.id === row.fundPoolId && pool.currency === currency),
    ))
  }, [currency, fundPools, kind])

  function selectCategory(nextId: string) {
    setCategoryId(nextId)
    const category = categories.find((item) => item.id === nextId)
    if (category?.defaultAccountId && accounts.some((account) => account.id === category.defaultAccountId)) {
      setAccountId(category.defaultAccountId)
    }
    if (category?.defaultFundPoolId && fundPools.some((pool) => pool.id === category.defaultFundPoolId)) {
      setFundAllocationDrafts([{ fundPoolId: category.defaultFundPoolId, amount }])
      setAllocationsTouched(false)
    }
  }

  function switchKind(next: EntryKind) {
    if (next === kind) return
    draftsRef.current[kind] = {
      destinationId,
      destinationAmount,
      categoryId,
      merchant,
      linkedTransactionId,
      fee,
    }
    const nextDraft = draftsRef.current[next]
    previousKindRef.current = kind
    setKind(next)
    setDestinationId(nextDraft?.destinationId ?? '')
    setDestinationAmount(nextDraft?.destinationAmount ?? '')
    setCategoryId(nextDraft?.categoryId ?? '')
    setMerchant(nextDraft?.merchant ?? '')
    setLinkedTransactionId(nextDraft?.linkedTransactionId ?? '')
    setFee(nextDraft?.fee ?? '')
    setError('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving || submittedRef.current) return
    if (!canSubmit) {
      setError(!amountValid
        ? '请输入大于 0 的金额'
        : kind === 'refund' && !linkedTransactionId
          ? '请选择原消费记录'
          : transferKinds && !destinationId
            ? `请选择${kind === 'credit_payment' ? '信用卡账户' : kind === 'topup' ? '充值账户' : '转入账户'}`
            : !destinationAmountValid
              ? '请输入大于 0 的到账金额'
              : !feeValid
                ? '手续费不能小于 0'
            : allocationShortages.length > 0
              ? `${allocationShortages[0].name}可用金额不足，差额 ${formatMoney(allocationShortages[0].differenceMinor, allocationShortages[0].currency)}`
            : needsFundAllocation
              ? '承担资金池的分摊总额必须与支出金额一致'
              : '请完成必填信息')
      return
    }
    submittedRef.current = true
    setSaving(true)
    setError('')
    let saved = false
    try {
      if (!source) throw new Error(kind === 'refund' ? '请选择原消费记录' : '请选择有效账户')
      const amountMinor = toMinor(Number(amount), currency)
      if (kind === 'expense') {
        const converted = await convertWithCachedRate({
          amountMinor,
          baseCurrency: currency,
          quoteCurrency: reportingCurrency,
          date,
        })
        await saveSpending({
          id: editing?.id,
          amountMinor,
          currency,
          localDate: date,
          accountId,
          categoryId: categoryId || undefined,
          merchantName: merchant,
          note,
          includeInSpending,
          fundAllocations: fundAllocationDrafts
            .filter((row) => row.fundPoolId && Number(row.amount) > 0)
            .map((row) => ({
              fundPoolId: row.fundPoolId,
              amountMinor: toMinor(Number(row.amount), currency),
            })),
          ...(converted && {
            reportingCurrency,
            reportingAmountMinor: converted.amountMinor,
            exchangeRate: converted.rate.rate,
            exchangeRateDate: converted.rate.rateDate,
            exchangeRateSource: converted.rate.providerLabel,
          }),
        })
        saveFinanceEntryDefaults({
          accountId,
          ...(categoryId && { categoryId }),
          ...(fundAllocationDrafts[0]?.fundPoolId && { fundPoolId: fundAllocationDrafts[0].fundPoolId }),
        })
      } else if (kind === 'income') {
        const converted = await convertWithCachedRate({
          amountMinor,
          baseCurrency: currency,
          quoteCurrency: reportingCurrency,
          date,
        })
        await saveIncome({
          amountMinor,
          currency,
          localDate: date,
          accountId,
          categoryId: categoryId || undefined,
          sourceName: merchant,
          note,
          ...(converted && {
            reportingCurrency,
            reportingAmountMinor: converted.amountMinor,
            exchangeRate: converted.rate.rate,
            exchangeRateDate: converted.rate.rateDate,
            exchangeRateSource: converted.rate.providerLabel,
          }),
        })
      } else if (kind === 'refund') {
        if (!linkedTransactionId) throw new Error('请选择原消费记录')
        await saveRefund({
          amountMinor,
          localDate: date,
          linkedTransactionId,
          accountId: destinationId || selectedRefundOrigin?.accountId,
          note,
        })
      } else {
        if (!destinationId) throw new Error('请选择转入账户')
        const destination = accounts.find((account) => account.id === destinationId)
        if (!destination) throw new Error('转入账户不存在')
        await saveTransfer({
          sourceAccountId: accountId,
          destinationAccountId: destinationId,
          sourceAmountMinor: amountMinor,
          destinationAmountMinor: toMinor(Number(destinationAmount || amount), destination.currency),
          feeMinor: fee ? toMinor(Number(fee), currency) : undefined,
          localDate: date,
          kind,
          note,
        })
      }
      savedMessageRef.current = editing ? '流水已更新，所有汇总已重算' : `${kind === 'expense' ? '支出' : kind === 'income' ? '收入' : kind === 'refund' ? '退款' : '转账'}已保存`
      saved = true
      sheetRef.current?.close()
    } catch (caught) {
      submittedRef.current = false
      setError(caught instanceof Error ? caught.message : '保存失败')
    } finally {
      // Keep the primary action disabled while GestureSheet finishes closing.
      // Otherwise a second tap during the exit spring can create a duplicate.
      if (!saved) setSaving(false)
    }
  }

  const selectedAccount = accounts.find((account) => account.id === accountId)
  const selectedDestination = accounts.find((account) => account.id === destinationId)
  const pickerItems: SelectionPickerItem[] = !pickerTarget
    ? []
    : pickerTarget.kind === 'category'
      ? [
          { id: '', title: '未分类', subtitle: '系统保底分类' },
          ...categories.map((category) => ({ id: category.id, title: category.name })),
        ]
      : pickerTarget.kind === 'refund-origin'
        ? refundableTransactions.map((transaction) => {
            const remaining = transaction.amountMinor - (refundedByOriginal.get(transaction.id) ?? 0)
            return {
              id: transaction.id,
              title: transaction.merchantNameSnapshot || transaction.note || '未命名消费',
              subtitle: `${transaction.localDate} · 可退 ${formatMoney(remaining, transaction.currency)}`,
            }
          })
        : pickerTarget.kind === 'fund-pool'
          ? eligibleFundPools.map((pool) => ({ id: pool.id, title: pool.name, subtitle: pool.currency }))
          : (pickerTarget.kind === 'source'
              ? sourceOptions
              : pickerTarget.kind === 'refund-account'
                ? refundAccountOptions
                : destinationOptions
            ).map((account) => ({
              id: account.id,
              title: account.name,
              subtitle: `${ACCOUNT_SUBTYPE_LABEL[account.subtype]} · ${account.currency}${accountOwnership(account) === 'external' ? ' · 外部代付' : ''}`,
            }))
  const pickerTitle = !pickerTarget
    ? ''
    : pickerTarget.kind === 'category'
      ? '选择分类'
      : pickerTarget.kind === 'refund-origin'
        ? '选择原消费记录'
        : pickerTarget.kind === 'fund-pool'
          ? '选择承担资金池'
          : pickerTarget.kind === 'destination'
            ? kind === 'credit_payment' ? '选择信用卡账户' : kind === 'topup' ? '选择充值账户' : '选择转入账户'
            : pickerTarget.kind === 'refund-account'
              ? '选择退款到账账户'
              : kind === 'expense' ? '选择支付账户' : kind === 'income' ? '选择入账账户' : '选择转出账户'
  const selectedPickerId = !pickerTarget
    ? ''
    : pickerTarget.kind === 'category'
      ? categoryId
      : pickerTarget.kind === 'refund-origin'
        ? linkedTransactionId
        : pickerTarget.kind === 'fund-pool'
          ? fundAllocationDrafts[pickerTarget.index]?.fundPoolId ?? ''
          : pickerTarget.kind === 'destination' || pickerTarget.kind === 'refund-account'
            ? destinationId
            : accountId

  function selectPickerValue(id: string) {
    if (!pickerTarget) return
    if (pickerTarget.kind === 'category') selectCategory(id)
    else if (pickerTarget.kind === 'source') setAccountId(id)
    else if (pickerTarget.kind === 'destination' || pickerTarget.kind === 'refund-account') setDestinationId(id)
    else if (pickerTarget.kind === 'fund-pool') {
      setAllocationsTouched(true)
      setFundAllocationDrafts((current) => current.map((row, index) =>
        index === pickerTarget.index ? { ...row, fundPoolId: id } : row,
      ))
    } else {
      const origin = refundableTransactions.find((transaction) => transaction.id === id)
      setLinkedTransactionId(id)
      setDestinationId(origin?.accountId ?? '')
      if (origin) {
        const remaining = origin.amountMinor - (refundedByOriginal.get(origin.id) ?? 0)
        setAmount(String(fromMinor(remaining, origin.currency)))
      }
    }
    setError('')
    setPickerTarget(null)
  }

  return (
    <>
      <GestureSheet
        ref={sheetRef}
        dialogRef={dialogRef}
        labelledBy="finance-entry-title"
        className="editor-sheet finance-ledger-sheet"
        canClose={() => Boolean(savedMessageRef.current) || !dirty || window.confirm('还有未保存的内容，确定关闭吗？')}
        onClose={() => savedMessageRef.current ? onSaved(savedMessageRef.current) : onClose()}
      >
        <form className="finance-sheet-layout" onSubmit={submit}>
          <header className="finance-sheet-header" data-sheet-drag-handle>
            <h2 id="finance-entry-title">{editing ? '编辑流水' : '快速记账'}</h2>
            <button type="button" aria-label="关闭" onClick={() => sheetRef.current?.close()}><AppIcon name="close" size={20} /></button>
          </header>
          {!editing && (
            <div ref={kindBarRef} className="finance-entry-kind-scroll">
              <div className="finance-entry-kind">
                <span
                  className="finance-entry-kind-indicator"
                  aria-hidden="true"
                  style={{ transform: `translate3d(${ENTRY_KINDS.indexOf(kind) * 100}%, 0, 0)` }}
                />
                {ENTRY_KINDS.map((value) => (
                  <button type="button" data-kind={value} key={value} aria-pressed={kind === value} onClick={() => switchKind(value)}>{ENTRY_KIND_LABEL[value]}</button>
                ))}
              </div>
            </div>
          )}
          <div className="finance-sheet-body">
            <motion.div
              key={kind}
              className="finance-sheet-form"
              initial={reduceMotion ? false : { x: ENTRY_KINDS.indexOf(kind) >= ENTRY_KINDS.indexOf(previousKindRef.current) ? 10 : -10, opacity: 0.97 }}
              animate={{ x: 0, opacity: 1 }}
              transition={reduceMotion ? MOTION.reduced : MOTION.route}
            >
              <label className="finance-amount-field">
                <span>{kind === 'refund' ? '退款金额' : kind === 'credit_payment' ? '还款金额' : kind === 'topup' ? '充值金额' : '金额'} · {currency}</span>
                <input inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setError('') }} onBlur={() => !amountValid && amount && setError('请输入大于 0 的金额')} placeholder="0" />
                <small>原币种金额会保留；汇总只使用交易时保存的参考汇率。</small>
              </label>
              <div className="finance-sheet-grid">
                <label className="finance-date-field">日期<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>

                {kind === 'refund' ? (
                  <>
                    <FinancePickerRow label="原消费记录" value={selectedRefundOrigin?.merchantNameSnapshot || selectedRefundOrigin?.note} placeholder="选择可退款消费" onClick={() => setPickerTarget({ kind: 'refund-origin' })} />
                    <FinancePickerRow label="退款到账账户" value={selectedDestination?.name} placeholder="选择到账账户" onClick={() => setPickerTarget({ kind: 'refund-account' })} />
                  </>
                ) : (
                  <FinancePickerRow
                    label={kind === 'expense' ? '现实从哪里付款' : kind === 'income' ? '入账账户' : kind === 'credit_payment' ? '还款账户' : kind === 'topup' ? '付款账户' : '转出账户'}
                    value={selectedAccount?.name}
                    placeholder="选择账户"
                    onClick={() => setPickerTarget({ kind: 'source' })}
                  />
                )}

                {kind === 'expense' && (
                  <>
                    <div className="finance-sheet-static-row"><span>资金承担者</span><strong>{accountOwnership(source) === 'external' ? '外部代付' : '本人资金'}</strong></div>
                    <FinancePickerRow label="分类" value={selectedCategory?.name ?? '未分类'} placeholder="未分类" onClick={() => setPickerTarget({ kind: 'category' })} />
                    {accountOwnership(source) !== 'external' && (
                      <fieldset className="finance-fund-allocation-fieldset">
                        <legend>这笔钱属于哪项用途资金</legend>
                        {fundAllocationDrafts.map((row, index) => (
                          <div key={`${row.fundPoolId}:${index}`}>
                            <button type="button" className="finance-fund-picker" onClick={() => setPickerTarget({ kind: 'fund-pool', index })}>
                              <span>
                                <strong>{eligibleFundPools.find((pool) => pool.id === row.fundPoolId)?.name ?? '选择用途资金池'}</strong>
                                {row.fundPoolId && <small>可用 <PrivateAmount>{formatMoney(fundPoolStates.get(row.fundPoolId)?.availableMinor ?? 0, currency)}</PrivateAmount></small>}
                              </span>
                              <AppIcon name="chevronRight" size={16} />
                            </button>
                            <input aria-label="分摊金额" inputMode="decimal" value={row.amount} onChange={(event) => {
                              setAllocationsTouched(true)
                              setFundAllocationDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item))
                            }} />
                            {fundAllocationDrafts.length > 1 && <button type="button" aria-label="移除分摊" onClick={() => setFundAllocationDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))}><AppIcon name="close" size={16} /></button>}
                            {allocationShortages.some((item) => item.fundPoolId === row.fundPoolId) && <p className="finance-fund-shortage">差额 <PrivateAmount>{formatMoney(allocationShortages.find((item) => item.fundPoolId === row.fundPoolId)!.differenceMinor, currency)}</PrivateAmount>，请更换或拆分资金池</p>}
                          </div>
                        ))}
                        {fundAllocationDrafts.length === 0 && <p>{!source
                          ? '先选择现实支付账户，再确认这笔钱属于哪项用途资金'
                          : eligibleFundPools.length
                            ? '选择这笔支出属于哪项用途资金'
                            : '请先在“财务 → 资金池”分配现实余额的用途'}</p>}
                        {source && eligibleFundPools.length > 0 && <button type="button" className="finance-add-allocation" onClick={() => {
                          setAllocationsTouched(fundAllocationDrafts.length > 0)
                          setFundAllocationDrafts((current) => [...current, { fundPoolId: eligibleFundPools.find((pool) => !current.some((item) => item.fundPoolId === pool.id))?.id ?? eligibleFundPools[0].id, amount: current.length === 0 ? amount : '' }])
                        }}>＋ {fundAllocationDrafts.length ? '拆分到另一个资金池' : '选择用途资金池'}</button>}
                      </fieldset>
                    )}
                    {source && <section className="finance-money-path" aria-label="资金路径确认">
                      <span>保存后会记录</span>
                      <strong>{source.name} → {accountOwnership(source) === 'external'
                        ? '外部代付'
                        : fundAllocationDrafts.length
                          ? fundAllocationDrafts.map((row) => fundPools.find((pool) => pool.id === row.fundPoolId)?.name ?? '待选择用途').join(' + ')
                          : '待选择用途资金池'}</strong>
                      <small>{accountOwnership(source) === 'external'
                        ? '计入消费行为，但不减少本人资产或资金池。'
                        : '现实账户只扣款一次；资金池只记录用途归属，不会重复扣款。'}</small>
                    </section>}
                    <label>商家 / 地点<input value={merchant} onChange={(event) => setMerchant(event.target.value)} placeholder="例如 Rakuten Ichiba" /></label>
                  </>
                )}

                {kind === 'income' && (
                  <>
                    <FinancePickerRow label="收入分类" value={selectedCategory?.name} placeholder="选择分类（可选）" onClick={() => setPickerTarget({ kind: 'category' })} />
                    <label>来源<input value={merchant} onChange={(event) => setMerchant(event.target.value)} placeholder="例如 工资、退款" /></label>
                  </>
                )}

                {transferKinds && (
                  <>
                    <FinancePickerRow
                      label={kind === 'credit_payment' ? '信用卡账户' : kind === 'topup' ? '充值账户' : '转入账户'}
                      value={selectedDestination?.name}
                      placeholder="请选择"
                      onClick={() => setPickerTarget({ kind: 'destination' })}
                    />
                    <label>到账金额<input inputMode="decimal" value={destinationAmount} onChange={(event) => setDestinationAmount(event.target.value)} placeholder={amount || '0'} /></label>
                    <label>手续费（可选）<input inputMode="decimal" value={fee} onChange={(event) => setFee(event.target.value)} placeholder="0" /></label>
                  </>
                )}

                <label>备注<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="可选备注" /></label>
                {kind === 'expense' && <button type="button" role="switch" aria-checked={includeInSpending} className="finance-sheet-setting finance-stat-switch" onClick={() => setIncludeInSpending((value) => !value)}><span>计入消费统计<small>转账、还款和充值不会计入消费</small></span><i aria-hidden /></button>}
              </div>
              {kind === 'refund' && selectedRefundOrigin && <p className="finance-entry-notice">退款沿用原消费的分类与资金归属，并冲减相同统计口径；支持部分退款。</p>}
              {kind === 'expense' && accountOwnership(source) === 'external' && <p className="finance-entry-notice">外部代付会计入总消费，但不会减少个人资产或增加个人负债。</p>}
              {kind === 'expense' && source?.kind === 'credit' && accountOwnership(source) === 'self' && <p className="finance-entry-notice">本人信用卡消费在发生时计入；还款不会再次计为支出。</p>}
              {kind === 'credit_payment' && <p className="finance-entry-notice">信用卡消费已在发生时统计，还款不会再次计入支出。</p>}
              {kind === 'topup' && <p className="finance-entry-notice">充值属于账户之间的资金移动，只有实际使用储值余额时才计入消费。</p>}
              {error && <p className="finance-sheet-error" role="alert">{error}</p>}
            </motion.div>
          </div>
          <div className="finance-sheet-actions">
            <button type="button" onClick={() => sheetRef.current?.close()}>取消</button>
            <button className="primary" disabled={saving || !canSubmit}>{saving ? '保存中…' : editing ? '保存修改' : '保存'}</button>
          </div>
        </form>
      </GestureSheet>
      {pickerTarget && (
        <SelectionPickerSheet
          id={`finance-${pickerTarget.kind}`}
          eyebrow="快速记账"
          title={pickerTitle}
          items={pickerItems}
          selectedId={selectedPickerId}
          searchPlaceholder={`搜索${pickerTitle.replace('选择', '')}`}
          createPlaceholder={pickerTarget.kind === 'category' ? '＋ 新建分类' : undefined}
          onCreate={pickerTarget.kind === 'category' ? async (name) => saveExpenseCategory({ name }) : undefined}
          footerActionLabel={pickerTarget.kind === 'category' ? '管理分类' : undefined}
          onFooterAction={pickerTarget.kind === 'category' ? () => {
            setPickerTarget(null)
            setCategoryManagerOpen(true)
          } : undefined}
          onSelect={selectPickerValue}
          onClose={() => setPickerTarget(null)}
        />
      )}
      {categoryManagerOpen && (
        <ExpenseCategoryManagerSheet
          categories={categories}
          accounts={accounts}
          fundPools={fundPools}
          onClose={() => setCategoryManagerOpen(false)}
          onFeedback={setError}
        />
      )}
    </>
  )
}
