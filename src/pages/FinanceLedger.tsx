import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Link, useLocation } from 'react-router-dom'
import AppIcon from '../components/AppIcon'
import GestureSheet, { type GestureSheetHandle } from '../components/GestureSheet'
import MobilePageHeader from '../components/MobilePageHeader'
import PageHeader from '../components/PageHeader'
import { db, type ExpenseCategory } from '../lib/db'
import { cachedRate, convertWithCachedRate, refreshExchangeRate } from '../lib/exchangeRates'
import { MOTION } from '../lib/motion'
import {
  calculateAccountBalances,
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
import type {
  Account,
  CurrencyCode,
  FinanceTransaction,
  FinanceTransactionType,
  ExchangeRate,
  WorkEntry,
  WorkTemplate,
} from '../lib/ledgerTypes'

type FinanceView = 'overview' | 'accounts' | 'transactions' | 'work' | 'stats'
type EntryKind = 'expense' | 'income' | 'transfer' | 'credit_payment' | 'topup' | 'refund'

const VIEW_ITEMS: { id: FinanceView; label: string }[] = [
  { id: 'overview', label: '总览' },
  { id: 'accounts', label: '账户' },
  { id: 'transactions', label: '流水' },
  { id: 'work', label: '工资与工时' },
  { id: 'stats', label: '统计' },
]

const ACCOUNT_KIND_LABEL: Record<Account['kind'], string> = {
  asset: '个人资产',
  credit: '本人信用卡',
  external: '外部代付',
}

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

function accountDefaultSubtype(kind: Account['kind']): Account['subtype'] {
  if (kind === 'credit') return 'credit_card'
  if (kind === 'external') return 'external_payer'
  return 'bank'
}

export default function FinanceLedger() {
  const location = useLocation()
  const query = useMemo(() => new URLSearchParams(location.search), [location.search])
  const [view, setView] = useState<FinanceView>(query.get('mode') === 'work' ? 'work' : 'overview')
  const [tabSurface, setTabSurface] = useState({ x: 0, width: 0 })
  const [reportingCurrency, setReportingCurrency] = useState<CurrencyCode>('JPY')
  const [entryOpen, setEntryOpen] = useState(query.get('new') === '1')
  const [entryKind, setEntryKind] = useState<EntryKind>('expense')
  const [editingTransaction, setEditingTransaction] = useState<FinanceTransaction | undefined>()
  const [feedback, setFeedback] = useState('')
  const financeTabsRef = useRef<HTMLElement>(null)
  const financeTabRefs = useRef(new Map<FinanceView, HTMLButtonElement>())
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
  const recentTransactions = useMemo(
    () => [...transactions].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 30),
    [transactions],
  )

  useEffect(() => {
    if (query.get('mode') === 'work') setView('work')
  }, [query])

  useEffect(() => {
    previousViewRef.current = view
  }, [view])

  useLayoutEffect(() => {
    const tabs = financeTabsRef.current
    const activeButton = financeTabRefs.current.get(view)
    if (!tabs || !activeButton) return

    const updateSurface = () => {
      setTabSurface({
        x: activeButton.offsetLeft,
        width: activeButton.offsetWidth,
      })
      activeButton.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' })
    }

    updateSurface()
    const observer = new ResizeObserver(updateSurface)
    observer.observe(tabs)
    return () => observer.disconnect()
  }, [view])

  function openEntry(kind: EntryKind = 'expense', transaction?: FinanceTransaction) {
    setEntryKind(kind)
    setEditingTransaction(transaction)
    setEntryOpen(true)
  }

  return (
    <section className="app-page page-finance finance-ledger-page">
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

      <nav ref={financeTabsRef} className="finance-ledger-tabs" aria-label="财务页面">
        <motion.span
          aria-hidden="true"
          className="finance-ledger-tab-surface"
          data-ready={tabSurface.width > 0 || undefined}
          animate={{ x: tabSurface.x, width: tabSurface.width }}
          transition={reduceMotion ? MOTION.reduced : MOTION.control}
        />
        {VIEW_ITEMS.map((item) => (
          <button
            key={item.id}
            ref={(node) => {
              if (node) financeTabRefs.current.set(item.id, node)
              else financeTabRefs.current.delete(item.id)
            }}
            type="button"
            aria-selected={view === item.id}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="finance-ledger-toolbar">
        <span>{feedback || '原币种保留；汇总金额使用已缓存参考汇率'}</span>
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

      <div className="finance-ledger-view-viewport">
        <motion.div
          key={view}
          className="finance-ledger-view-surface"
          initial={reduceMotion
            ? { x: 0, opacity: 0.84 }
            : { x: viewDirection * 16, opacity: 0.94 }}
          animate={{ x: 0, opacity: 1 }}
          transition={reduceMotion ? MOTION.reduced : MOTION.route}
        >
          {view === 'overview' && (
            <FinanceOverview
              accounts={accounts}
              balances={balances}
              transactions={recentTransactions}
              currency={reportingCurrency}
              summary={currentSummary}
              workEntries={workEntries}
              onOpenAccounts={() => setView('accounts')}
              onOpenTransactions={() => setView('transactions')}
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
              transactions={recentTransactions}
              accounts={accounts}
              onNew={openEntry}
              onEdit={(transaction) => openEntry('expense', transaction)}
              onFeedback={setFeedback}
            />
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
          categories={categories}
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
    </section>
  )
}

function FinanceOverview({
  accounts,
  balances,
  transactions,
  currency,
  summary,
  workEntries,
  onOpenAccounts,
  onOpenTransactions,
  onNew,
}: {
  accounts: Account[]
  balances: Map<string, number>
  transactions: FinanceTransaction[]
  currency: CurrencyCode
  summary: ReturnType<typeof ledgerSummary>
  workEntries: WorkEntry[]
  onOpenAccounts: () => void
  onOpenTransactions: () => void
  onNew: (kind: EntryKind) => void
}) {
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
        <strong>{formatMoney(summary.netWorthMinor, currency)}</strong>
        <div>
          <span>资产 {formatMoney(summary.assetsMinor, currency)}</span>
          <span>负债 {formatMoney(summary.liabilitiesMinor, currency)}</span>
        </div>
      </section>

      <div className="finance-work-summary">
        <article><span>本月至今工时</span><strong>{formatMinutes(workMinutes)}</strong><small>{monthWork.length} 个工作日</small></article>
        <article><span>预计税前工资</span><strong>{formatMoney(estimatedPay, currency)}</strong><small>未结算工作记录</small></article>
        <article><span>本月至今支出</span><strong>{formatMoney(summary.consumptionMinor, currency)}</strong><small>含外部代付</small></article>
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
                <b>{formatMoney(balances.get(account.id) ?? 0, account.currency)}</b>
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
    setKind(editing.kind)
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
        subtype,
        currency,
        openingBalanceMinor: toMinor(Number(opening) || 0, currency),
        includeInNetWorth: kind === 'external' ? false : includeNetWorth,
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
          <label>账户归属<select value={kind} onChange={(event) => { const next = event.target.value as Account['kind']; setKind(next); setSubtype(accountDefaultSubtype(next)); setIncludeNetWorth(next !== 'external') }}><option value="asset">个人资产</option><option value="credit">本人信用卡</option><option value="external">外部代付</option></select></label>
          <label>账户类型<select value={subtype} onChange={(event) => setSubtype(event.target.value as Account['subtype'])}>{kind === 'asset' && <><option value="bank">银行账户</option><option value="cash">现金</option><option value="wallet">电子钱包</option><option value="stored_value">储值卡 / 交通卡</option></>}{kind === 'credit' && <option value="credit_card">本人信用卡</option>}{kind === 'external' && <option value="external_payer">他人代付</option>}</select></label>
          <label>原始币种<select value={currency} onChange={(event) => setCurrency(event.target.value as CurrencyCode)}><option value="JPY">JPY 日元</option><option value="CNY">CNY 人民币</option></select></label>
          <label>初始{kind === 'credit' ? '待还金额' : '余额'}<input inputMode="decimal" value={opening} onChange={(event) => setOpening(event.target.value)} /></label>
          {kind === 'credit' && <><label>账单日<input inputMode="numeric" value={billingCycleDay} onChange={(event) => setBillingCycleDay(event.target.value)} placeholder="例如 15" /></label><label>预计扣款日<input inputMode="numeric" value={paymentDueDay} onChange={(event) => setPaymentDueDay(event.target.value)} placeholder="例如 27" /></label><label>默认还款账户<select value={defaultPaymentAccountId} onChange={(event) => setDefaultPaymentAccountId(event.target.value)}><option value="">稍后选择</option>{accounts.filter((account) => account.kind === 'asset' && !account.isArchived && account.currency === currency).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label></>}
          <div className="finance-account-checks">
            <label><input type="checkbox" checked={includeNetWorth} disabled={kind === 'external'} onChange={(event) => setIncludeNetWorth(event.target.checked)} />计入个人净资产</label>
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
            <header><span className={`finance-account-mark is-${account.kind}`} /><span className="finance-account-card-actions"><button aria-label="上移账户" onClick={() => void moveAccount(account.id, -1)}>↑</button><button aria-label="下移账户" onClick={() => void moveAccount(account.id, 1)}>↓</button><button onClick={() => setEditingId(account.id)}>编辑</button><button onClick={() => void setAccountArchived(account.id, !account.isArchived)}>{account.isArchived ? '启用' : '停用'}</button></span></header>
            <span>{ACCOUNT_KIND_LABEL[account.kind]} · {ACCOUNT_SUBTYPE_LABEL[account.subtype]}</span>
            <h3>{account.name}</h3>
            <strong>{formatMoney(balances.get(account.id) ?? 0, account.currency)}</strong>
            <small>{account.isArchived ? '已停用 · 历史仍保留' : account.kind === 'credit' ? `本期 ${formatMoney(monthPurchases, account.currency)} · 已还 ${formatMoney(monthPayments, account.currency)}${account.paymentDueDay ? ` · ${account.paymentDueDay} 日扣款` : ''}` : account.kind === 'external' ? '不影响个人资产' : '当前余额'}</small>
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
        return <li key={transaction.id}>
          <span className={`finance-transaction-icon is-${transaction.type}`}><AppIcon name={positive ? 'plus' : transaction.type.includes('transfer') || transaction.type === 'topup' || transaction.type === 'credit_payment' ? 'sync' : 'receipt'} size={18} /></span>
          <div><strong>{transaction.merchantNameSnapshot || transaction.note || TRANSACTION_LABEL[transaction.type]}</strong><span>{transaction.localDate} · {account?.name ?? '未知账户'} · {TRANSACTION_LABEL[transaction.type]}</span></div>
          <b className={positive ? 'is-positive' : ''}>{positive ? '+' : transaction.type === 'external_payment' ? '' : '−'}{formatMoney(transaction.amountMinor, transaction.currency)}</b>
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
  const payoutAccounts = accounts.filter((account) => account.kind === 'asset' && !account.isArchived)
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

  const activeEntries = [...entries].sort((a, b) => b.date.localeCompare(a.date))
  const pending = activeEntries.filter((entry) => entry.settlementStatus === 'unsettled' && entry.worked)
  const pendingEstimated = pending.reduce((sum, entry) => sum + entry.estimatedGrossMinor, 0)
  const pendingCurrency = pending[0]?.currency ?? currency

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

  async function settleOne(entryId: string) {
    const entry = entries.find((item) => item.id === entryId)
    if (!entry) return
    const target = entry.payoutAccountId || payoutAccountId
    if (!target) {
      onFeedback('请先选择工资入账账户')
      return
    }
    try {
      await settlePaycheck({
        workEntryIds: [entry.id],
        payoutAccountId: target,
        actualAmountMinor: entry.estimatedGrossMinor,
        currency: entry.currency,
        paidDate: todayISO(),
      })
      onFeedback('工资已实际入账，并锁定该工作记录防止重复结算')
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : '工资入账失败')
    }
  }

  return (
    <div className="finance-work-v2">
      <div className="finance-view-heading"><div><span>待结算 {pending.length} 条</span><h2>工资与工时</h2></div><strong>{formatMoney(pendingEstimated, pendingCurrency)} 预计税前</strong></div>
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
        {activeEntries.length ? <ul>{activeEntries.map((entry) => <li key={entry.id}><div><strong>{entry.workContent || entry.employer || '工作'}</strong><span>{entry.date} · {formatMinutes(entry.durationMinutes)}{entry.workLocation ? ` · ${entry.workLocation}` : ''}</span></div><b>{formatMoney(entry.estimatedGrossMinor, entry.currency)}</b>{entry.settlementStatus === 'settled' ? <em>已入账</em> : <button onClick={() => void settleOne(entry.id)}>实际入账</button>}</li>)}</ul> : <div className="finance-empty-state">还没有工作记录</div>}
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
  for (const transaction of transactions) {
    if (transaction.localDate < startDate || transaction.localDate > endDate) continue
    if (!transaction.includeInSpending || !['expense', 'credit_purchase', 'external_payment'].includes(transaction.type)) continue
    const value = transaction.reportingCurrency === reportingCurrency
      ? transaction.reportingAmountMinor ?? 0
      : transaction.currency === reportingCurrency
        ? transaction.amountMinor
        : 0
    const category = transaction.categoryNameSnapshot ?? '未分类'
    const merchant = transaction.merchantNameSnapshot ?? '未填写商家'
    categories.set(category, (categories.get(category) ?? 0) + value)
    merchants.set(merchant, (merchants.get(merchant) ?? 0) + value)
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
        <article><span>净资产</span><strong>{formatMoney(summary.netWorthMinor, reportingCurrency)}</strong><small>资产减个人负债</small></article>
        <article><span>全部消费</span><strong>{formatMoney(summary.consumptionMinor, reportingCurrency)}</strong><small>含外部代付</small></article>
        <article><span>个人支付</span><strong>{formatMoney(summary.actualPaidMinor, reportingCurrency)}</strong><small>不含还款重复项</small></article>
        <article><span>外部代付</span><strong>{formatMoney(summary.externalPaidMinor, reportingCurrency)}</strong><small>消费行为，不影响资产</small></article>
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
      </section>
    </div>
  )
}

function Breakdown({ title, data, currency }: { title: string; data: [string, number][]; currency: CurrencyCode }) {
  return <section className="finance-section-card finance-breakdown-v2"><header><div><span>本月消费</span><h2>{title}</h2></div></header>{data.length ? <ul>{data.slice(0, 10).map(([label, value]) => <li key={label}><span>{label}</span><strong>{formatMoney(value, currency)}</strong></li>)}</ul> : <div className="finance-empty-state">暂无可统计数据</div>}</section>
}

function FinanceEntrySheet({
  initialKind,
  editing,
  accounts,
  categories,
  reportingCurrency,
  onSaved,
  onClose,
}: {
  initialKind: EntryKind
  editing?: FinanceTransaction
  accounts: Account[]
  categories: ExpenseCategory[]
  reportingCurrency: CurrencyCode
  onSaved: (message: string) => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const sheetRef = useRef<GestureSheetHandle>(null)
  const [kind, setKind] = useState<EntryKind>(initialKind)
  const [amount, setAmount] = useState(editing ? String(fromMinor(editing.amountMinor, editing.currency)) : '')
  const [date, setDate] = useState(editing?.localDate ?? todayISO())
  const [accountId, setAccountId] = useState(editing?.accountId ?? accounts[0]?.id ?? '')
  const [destinationId, setDestinationId] = useState('')
  const [destinationAmount, setDestinationAmount] = useState('')
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? '')
  const [merchant, setMerchant] = useState(editing?.merchantNameSnapshot ?? '')
  const [note, setNote] = useState(editing?.note ?? '')
  const [includeInSpending, setIncludeInSpending] = useState(editing?.includeInSpending ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const source = accounts.find((account) => account.id === accountId)
  const currency = source?.currency ?? 'JPY'
  const transferKinds = ['transfer', 'credit_payment', 'topup'].includes(kind)
  const destinationOptions = accounts.filter((account) => {
    if (account.isArchived) return false
    if (account.id === accountId) return false
    if (kind === 'credit_payment') return account.kind === 'credit'
    return account.kind === 'asset'
  })

  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true })
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving || !source) return
    setSaving(true)
    setError('')
    try {
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
          ...(converted && {
            reportingCurrency,
            reportingAmountMinor: converted.amountMinor,
            exchangeRate: converted.rate.rate,
            exchangeRateDate: converted.rate.rateDate,
            exchangeRateSource: converted.rate.providerLabel,
          }),
        })
      } else if (kind === 'income') {
        await saveIncome({ amountMinor, currency, localDate: date, accountId, note })
      } else if (kind === 'refund') {
        await saveRefund({ amountMinor, currency, localDate: date, accountId, note, includeInSpending })
      } else {
        if (!destinationId) throw new Error('请选择转入账户')
        const destination = accounts.find((account) => account.id === destinationId)
        if (!destination) throw new Error('转入账户不存在')
        await saveTransfer({
          sourceAccountId: accountId,
          destinationAccountId: destinationId,
          sourceAmountMinor: amountMinor,
          destinationAmountMinor: toMinor(Number(destinationAmount || amount), destination.currency),
          localDate: date,
          kind,
          note,
        })
      }
      onSaved(editing ? '流水已更新，所有汇总已重算' : `${kind === 'expense' ? '支出' : kind === 'income' ? '收入' : kind === 'refund' ? '退款' : '转账'}已保存`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <GestureSheet ref={sheetRef} dialogRef={dialogRef} labelledBy="finance-entry-title" className="editor-sheet finance-ledger-sheet" onClose={onClose}>
      <form onSubmit={submit}>
        <header><div><span>原币种金额会永久保留</span><h2 id="finance-entry-title">{editing ? '编辑流水' : '快速记账'}</h2></div><button type="button" aria-label="关闭" onClick={() => sheetRef.current?.close()}><AppIcon name="close" size={20} /></button></header>
        {!editing && <div className="finance-entry-kind">{(['expense', 'income', 'transfer', 'credit_payment', 'topup', 'refund'] as EntryKind[]).map((value) => <button type="button" key={value} aria-pressed={kind === value} onClick={() => { setKind(value); setDestinationId('') }}>{value === 'expense' ? '支出' : value === 'income' ? '收入' : value === 'transfer' ? '转账' : value === 'credit_payment' ? '还信用卡' : value === 'topup' ? '充值' : '退款'}</button>)}</div>}
        <label className="finance-amount-field"><span>金额 · {currency}</span><input autoFocus inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" /></label>
        <div className="finance-sheet-grid">
          <label>日期<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label>{transferKinds ? '转出账户' : kind === 'income' ? '入账账户' : '支付账户'}<select value={accountId} onChange={(event) => setAccountId(event.target.value)}>{accounts.filter((account) => !account.isArchived && ((transferKinds || kind === 'income') ? account.kind === 'asset' : true)).map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label>
          {transferKinds && <><label>转入账户<select value={destinationId} onChange={(event) => setDestinationId(event.target.value)}><option value="">请选择</option>{destinationOptions.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label><label>到账金额<input inputMode="decimal" value={destinationAmount} onChange={(event) => setDestinationAmount(event.target.value)} placeholder={amount || '0'} /></label></>}
          {kind === 'expense' && <><label>分类<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">未分类</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>商家 / 地点<input value={merchant} onChange={(event) => setMerchant(event.target.value)} placeholder="例如 Amazon、药局" /></label></>}
          <label className="wide">备注<input value={note} onChange={(event) => setNote(event.target.value)} /></label>
          {(kind === 'expense' || kind === 'refund') && <label className="wide finance-sheet-check"><input type="checkbox" checked={includeInSpending} onChange={(event) => setIncludeInSpending(event.target.checked)} />计入本月消费行为统计</label>}
        </div>
        {source?.kind === 'external' && <p className="finance-entry-notice">外部代付只记录消费行为，不会减少个人资产或增加个人负债。</p>}
        {source?.kind === 'credit' && <p className="finance-entry-notice">本人信用卡消费会增加待还金额；之后还款不会再次计为支出。</p>}
        {error && <p className="finance-sheet-error" role="alert">{error}</p>}
        <div className="finance-sheet-actions"><button type="button" onClick={() => sheetRef.current?.close()}>取消</button><button className="primary" disabled={saving || !amount}>{saving ? '保存中…' : editing ? '保存修改' : '保存'}</button></div>
      </form>
    </GestureSheet>
  )
}
