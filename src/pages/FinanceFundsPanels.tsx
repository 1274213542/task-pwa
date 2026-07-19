import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState, type FormEvent } from 'react'
import AppIcon from '../components/AppIcon'
import { db, type ExpenseCategory } from '../lib/db'
import { calculateFundPoolStates } from '../lib/fundMath'
import {
  calculateFinancialProjection,
  saveBudgetPlan,
  saveFundPool,
  saveFundPoolTransfer,
  saveSavingsGoal,
  setFundPoolArchived,
  softDeleteFundPoolTransfer,
} from '../lib/funds'
import { fromMinor, ledgerSummary, toMinor } from '../lib/ledger'
import {
  confirmRecurringInstance,
  processDueRecurringRules,
  saveRecurringRule,
  setRecurringRuleEnabled,
  skipRecurringInstance,
} from '../lib/recurringFinance'
import type {
  Account,
  BudgetPlan,
  CurrencyCode,
  ExchangeRate,
  FinanceTransaction,
  FundPoolPurpose,
} from '../lib/ledgerTypes'

const purposeLabels: Record<FundPoolPurpose, string> = {
  free: '个人自由资金',
  restricted_rent: '父亲房租专项',
  restricted_living: '父亲生活费专项',
  restricted_tuition: '学费专项',
  restricted_tax: '税费专项',
  credit_reserve: '信用卡还款准备金',
  savings: '个人储蓄',
  emergency: '应急金',
  travel: '旅行储蓄',
  unspecified: '未指定资金来源',
  other: '其他用途',
}

function formatMoney(amountMinor: number, currency: CurrencyCode) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'JPY' ? 0 : 2,
  }).format(fromMinor(amountMinor, currency))
}

function currentMonth() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function todayISO() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function FinanceFundsView({ accounts, onFeedback }: {
  accounts: Account[]
  onFeedback: (message: string) => void
}) {
  const pools = useLiveQuery(
    () => db.fundPools.where('lifecycleStatus').equals('active').sortBy('rank'),
    [],
  ) ?? []
  const allocations = useLiveQuery(
    () => db.transactionFundAllocations.where('lifecycleStatus').equals('active').toArray(),
    [],
  ) ?? []
  const transfers = useLiveQuery(
    () => db.fundPoolTransfers.where('lifecycleStatus').equals('active').toArray(),
    [],
  ) ?? []
  const reservations = useLiveQuery(() => db.fundReservations.toArray(), [], []) ?? []
  const goals = useLiveQuery(
    () => db.savingsGoals.where('lifecycleStatus').equals('active').sortBy('rank'),
    [],
  ) ?? []
  const states = useMemo(
    () => calculateFundPoolStates({ pools, allocations, transfers, reservations }),
    [pools, allocations, transfers, reservations],
  )
  const [name, setName] = useState('')
  const [editingPoolId, setEditingPoolId] = useState('')
  const [purpose, setPurpose] = useState<FundPoolPurpose>('free')
  const [currency, setCurrency] = useState<CurrencyCode>('JPY')
  const [opening, setOpening] = useState('')
  const [accountId, setAccountId] = useState('')
  const [sourcePoolId, setSourcePoolId] = useState('')
  const [destinationPoolId, setDestinationPoolId] = useState('')
  const [transferAmount, setTransferAmount] = useState('')
  const [transferNote, setTransferNote] = useState('')
  const [editingTransferId, setEditingTransferId] = useState('')
  const [goalName, setGoalName] = useState('')
  const [goalPoolId, setGoalPoolId] = useState('')
  const [goalAmount, setGoalAmount] = useState('')
  const [saving, setSaving] = useState(false)

  async function createPool(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      await saveFundPool({
        ...(editingPoolId && { id: editingPoolId }),
        name,
        purpose,
        currency,
        ...(accountId && { accountId }),
        openingBalanceMinor: editingPoolId
          ? pools.find((pool) => pool.id === editingPoolId)?.openingBalanceMinor ?? 0
          : opening ? toMinor(Number(opening), currency) : 0,
      })
      setName('')
      setOpening('')
      setAccountId('')
      setEditingPoolId('')
      onFeedback(editingPoolId ? '资金池已更新；现实账户总余额没有改变' : '资金池已创建；现实账户总余额没有改变')
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : '资金池创建失败')
    } finally {
      setSaving(false)
    }
  }

  async function reallocate(event: FormEvent) {
    event.preventDefault()
    const source = pools.find((pool) => pool.id === sourcePoolId)
    const destination = pools.find((pool) => pool.id === destinationPoolId)
    const moveCurrency = source?.currency ?? destination?.currency
    if (!moveCurrency) return onFeedback('请选择原资金池或目标资金池')
    try {
      await saveFundPoolTransfer({
        ...(editingTransferId && { id: editingTransferId }),
        ...(sourcePoolId && { sourcePoolId }),
        ...(destinationPoolId && { destinationPoolId }),
        amountMinor: toMinor(Number(transferAmount), moveCurrency),
        currency: moveCurrency,
        localDate: todayISO(),
        note: transferNote,
      })
      setTransferAmount('')
      setTransferNote('')
      setEditingTransferId('')
      onFeedback(editingTransferId ? '资金用途调整已更新；现实账户余额与收支统计未改变' : '资金用途已调整；现实账户余额与收支统计未改变')
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : '资金用途调整失败')
    }
  }

  async function createGoal(event: FormEvent) {
    event.preventDefault()
    const pool = pools.find((item) => item.id === goalPoolId)
    if (!pool) return onFeedback('请选择储蓄资金池')
    try {
      await saveSavingsGoal({
        name: goalName,
        fundPoolId: pool.id,
        targetAmountMinor: toMinor(Number(goalAmount), pool.currency),
      })
      setGoalName('')
      setGoalAmount('')
      onFeedback('储蓄目标已保存')
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : '储蓄目标保存失败')
    }
  }

  const byCurrency = useMemo(() => {
    const map = new Map<CurrencyCode, { disposable: number; restricted: number; savings: number; reserved: number }>()
    for (const pool of pools) {
      const state = states.get(pool.id)
      const summary = map.get(pool.currency) ?? { disposable: 0, restricted: 0, savings: 0, reserved: 0 }
      if (pool.includeInDisposable) summary.disposable += state?.availableMinor ?? 0
      if (pool.includeInSavings) summary.savings += state?.grossMinor ?? 0
      if (pool.restricted && !pool.includeInSavings) summary.restricted += state?.grossMinor ?? 0
      summary.reserved += state?.reservedMinor ?? 0
      map.set(pool.currency, summary)
    }
    return map
  }, [pools, states])

  return (
    <div className="finance-funds-view">
      <div className="finance-ledger-metrics finance-fund-metrics">
        {[...byCurrency].flatMap(([code, summary]) => [
          <article key={`${code}:free`}><span>可自由支配 · {code}</span><strong>{formatMoney(summary.disposable, code)}</strong><small>已扣除信用卡锁定 {formatMoney(summary.reserved, code)}</small></article>,
          <article key={`${code}:restricted`}><span>不可自由支配 · {code}</span><strong>{formatMoney(summary.restricted, code)}</strong><small>父亲专项、学费及税费等</small></article>,
          <article key={`${code}:savings`}><span>个人储蓄 · {code}</span><strong>{formatMoney(summary.savings, code)}</strong><small>不包含父亲专项</small></article>,
        ])}
      </div>

      <section className="finance-section-card finance-fund-list">
        <header><div><span>用途分配不产生收入或支出</span><h2>资金池</h2></div><strong>{pools.length} 个</strong></header>
        {pools.length ? <ul>{pools.map((pool) => {
          const state = states.get(pool.id)
          return <li key={pool.id}><div><strong>{pool.name}</strong><span>{purposeLabels[pool.purpose]} · {pool.currency}</span></div><div className="finance-fund-row-value"><b>{formatMoney(state?.availableMinor ?? 0, pool.currency)}</b>{(state?.reservedMinor ?? 0) > 0 && <small>锁定 {formatMoney(state?.reservedMinor ?? 0, pool.currency)}</small>}<span className="finance-inline-actions"><button type="button" onClick={() => {
            setEditingPoolId(pool.id)
            setName(pool.name)
            setPurpose(pool.purpose)
            setCurrency(pool.currency)
            setOpening(fromMinor(pool.openingBalanceMinor, pool.currency).toString())
            setAccountId(pool.accountId ?? '')
          }}>编辑</button><button type="button" onClick={() => void setFundPoolArchived(pool.id).then(() => onFeedback('资金池已停用')).catch((error: unknown) => onFeedback(error instanceof Error ? error.message : '停用失败'))}>停用</button></span></div></li>
        })}</ul> : <div className="finance-empty-state">还没有资金池；旧流水会保留为“未指定资金来源”</div>}
      </section>

      <details className="finance-section-card finance-inline-details">
        <summary><span><small>从未分配资金开始</small><strong>新建资金池</strong></span><AppIcon name="chevronDown" size={18} /></summary>
        <form className="finance-form-grid-v2" onSubmit={createPool}>
          <label>名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 父亲房租专项" /></label>
          <label>用途<select value={purpose} onChange={(event) => setPurpose(event.target.value as FundPoolPurpose)}>{Object.entries(purposeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>币种<select value={currency} onChange={(event) => setCurrency(event.target.value as CurrencyCode)}><option>JPY</option><option>CNY</option></select></label>
          <label>初始分配<input inputMode="decimal" value={opening} disabled={Boolean(editingPoolId)} onChange={(event) => setOpening(event.target.value)} placeholder="0" /></label>
          <label className="wide">主要存放账户（可选）<select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">不绑定</option>{accounts.filter((account) => account.kind === 'asset' && account.currency === currency).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
          <button className="primary wide" disabled={saving || !name.trim()}>{saving ? '保存中…' : editingPoolId ? '保存资金池' : '创建资金池'}</button>
          {editingPoolId && <button type="button" className="wide" onClick={() => { setEditingPoolId(''); setName(''); setOpening(''); setAccountId('') }}>取消编辑</button>}
        </form>
      </details>

      <details className="finance-section-card finance-inline-details">
        <summary><span><small>只改变资金用途</small><strong>重新分配</strong></span><AppIcon name="chevronDown" size={18} /></summary>
        <form className="finance-form-grid-v2" onSubmit={reallocate}>
          <label>原资金池<select value={sourcePoolId} onChange={(event) => setSourcePoolId(event.target.value)}><option value="">未分配资金</option>{pools.map((pool) => <option key={pool.id} value={pool.id}>{pool.name} · {pool.currency}</option>)}</select></label>
          <label>目标资金池<select value={destinationPoolId} onChange={(event) => setDestinationPoolId(event.target.value)}><option value="">转回未分配</option>{pools.filter((pool) => pool.id !== sourcePoolId).map((pool) => <option key={pool.id} value={pool.id}>{pool.name} · {pool.currency}</option>)}</select></label>
          <label className="wide">金额<input inputMode="decimal" value={transferAmount} onChange={(event) => setTransferAmount(event.target.value)} /></label>
          <label className="wide">备注（可选）<input value={transferNote} onChange={(event) => setTransferNote(event.target.value)} /></label>
          <button className="primary wide" disabled={!transferAmount}>{editingTransferId ? '保存调整' : '确认调整'}</button>
          {editingTransferId && <button type="button" className="wide" onClick={() => { setEditingTransferId(''); setSourcePoolId(''); setDestinationPoolId(''); setTransferAmount(''); setTransferNote('') }}>取消编辑</button>}
        </form>
        {transfers.length > 0 && <ul className="finance-fund-transfer-list">{[...transfers].sort((a, b) => b.localDate.localeCompare(a.localDate)).map((transfer) => {
          const source = pools.find((pool) => pool.id === transfer.sourcePoolId)
          const destination = pools.find((pool) => pool.id === transfer.destinationPoolId)
          return <li key={transfer.id}><div><strong>{source?.name ?? '未分配资金'} → {destination?.name ?? '未分配资金'}</strong><span>{transfer.localDate}{transfer.note ? ` · ${transfer.note}` : ''}</span></div><div><b>{formatMoney(transfer.amountMinor, transfer.currency)}</b><span className="finance-inline-actions"><button type="button" onClick={() => {
            setEditingTransferId(transfer.id)
            setSourcePoolId(transfer.sourcePoolId ?? '')
            setDestinationPoolId(transfer.destinationPoolId ?? '')
            setTransferAmount(fromMinor(transfer.amountMinor, transfer.currency).toString())
            setTransferNote(transfer.note ?? '')
          }}>修改</button><button type="button" onClick={() => void softDeleteFundPoolTransfer(transfer.id).then(() => onFeedback('资金用途调整已撤销；账户余额未改变')).catch((error: unknown) => onFeedback(error instanceof Error ? error.message : '撤销失败'))}>撤销</button></span></div></li>
        })}</ul>}
      </details>

      <section className="finance-section-card finance-savings-goals">
        <header><div><span>父亲专项不会计入</span><h2>储蓄目标</h2></div></header>
        {goals.length > 0 && <ul>{goals.map((goal) => {
          const state = states.get(goal.fundPoolId)
          const current = Math.max(0, state?.grossMinor ?? 0)
          const percentage = Math.min(100, Math.round((current / goal.targetAmountMinor) * 100))
          return <li key={goal.id}><div><strong>{goal.name}</strong><span>{formatMoney(current, goal.currency)} / {formatMoney(goal.targetAmountMinor, goal.currency)}</span></div><progress value={percentage} max={100}>{percentage}%</progress></li>
        })}</ul>}
        <form className="finance-form-grid-v2" onSubmit={createGoal}>
          <label>目标名称<input value={goalName} onChange={(event) => setGoalName(event.target.value)} placeholder="例如 应急金" /></label>
          <label>储蓄资金池<select value={goalPoolId} onChange={(event) => setGoalPoolId(event.target.value)}><option value="">请选择</option>{pools.filter((pool) => pool.includeInSavings).map((pool) => <option key={pool.id} value={pool.id}>{pool.name}</option>)}</select></label>
          <label className="wide">目标金额<input inputMode="decimal" value={goalAmount} onChange={(event) => setGoalAmount(event.target.value)} /></label>
          <button className="primary wide" disabled={!goalPoolId || !goalAmount}>保存目标</button>
        </form>
      </section>
    </div>
  )
}

export function FinancePlanningPanel({
  accounts,
  categories,
  transactions,
  rates,
  reportingCurrency,
  onFeedback,
}: {
  accounts: Account[]
  categories: ExpenseCategory[]
  transactions: FinanceTransaction[]
  rates: ExchangeRate[]
  reportingCurrency: CurrencyCode
  onFeedback: (message: string) => void
}) {
  const pools = useLiveQuery(
    () => db.fundPools.where('lifecycleStatus').equals('active').sortBy('rank'),
    [],
  ) ?? []
  const rules = useLiveQuery(
    () => db.recurringTransactionRules.where('lifecycleStatus').equals('active').sortBy('rank'),
    [],
  ) ?? []
  const instances = useLiveQuery(() => db.recurringTransactionInstances.toArray(), [], []) ?? []
  const storedPlan = useLiveQuery(
    () => db.budgetPlans.get(`budget:${currentMonth()}:${reportingCurrency}`),
    [reportingCurrency],
  )
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [accountId, setAccountId] = useState('')
  const [poolId, setPoolId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [billingDay, setBillingDay] = useState('1')
  const [postingMode, setPostingMode] = useState<'automatic' | 'confirmation'>('confirmation')
  const [expectedIncome, setExpectedIncome] = useState('')
  const [livingBudget, setLivingBudget] = useState('')
  const [plannedExpense, setPlannedExpense] = useState('')
  const monthSummary = useMemo(() => ledgerSummary({
    accounts,
    transactions,
    rates,
    reportingCurrency,
    startDate: `${currentMonth()}-01`,
    endDate: todayISO(),
  }), [accounts, transactions, rates, reportingCurrency])
  const budget: BudgetPlan | undefined = storedPlan
  const recurringExpenseMinor = rules
    .filter((rule) => rule.enabled && rule.currency === reportingCurrency)
    .reduce((sum, rule) => sum + rule.amountMinor, 0)
  const projection = calculateFinancialProjection({
    month: currentMonth(),
    currency: reportingCurrency,
    expectedIncomeMinor: expectedIncome ? toMinor(Number(expectedIncome), reportingCurrency) : budget?.expectedIncomeMinor ?? 0,
    recurringExpenseMinor,
    occurredExpenseMinor: monthSummary.actualPaidMinor,
    plannedExpenseMinor: plannedExpense ? toMinor(Number(plannedExpense), reportingCurrency) : budget?.plannedExpenseMinor ?? 0,
    remainingLivingBudgetMinor: livingBudget ? toMinor(Number(livingBudget), reportingCurrency) : budget?.remainingLivingBudgetMinor ?? 0,
  })

  async function createRule(event: FormEvent) {
    event.preventDefault()
    const account = accounts.find((item) => item.id === accountId)
    if (!account) return onFeedback('请选择默认支付账户')
    try {
      const amountMinor = toMinor(Number(amount), account.currency)
      await saveRecurringRule({
        name,
        amountMinor,
        currency: account.currency,
        ...(categoryId && { categoryId }),
        accountId: account.id,
        fundAllocations: poolId ? [{ fundPoolId: poolId, amountMinor }] : [],
        billingDay: Number(billingDay),
        startDate: todayISO(),
        postingMode,
      })
      setName('')
      setAmount('')
      onFeedback('固定扣款已创建；将在启动、恢复、同步和进入财务时检查')
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : '固定扣款创建失败')
    }
  }

  async function saveProjection(event: FormEvent) {
    event.preventDefault()
    try {
      await saveBudgetPlan({
        month: currentMonth(),
        currency: reportingCurrency,
        expectedIncomeMinor: projection.expectedIncomeMinor,
        remainingLivingBudgetMinor: projection.remainingLivingBudgetMinor,
        plannedExpenseMinor: projection.plannedExpenseMinor,
      })
      await db.financialProjections.put(projection)
      onFeedback('预测假设已保存')
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : '预测保存失败')
    }
  }

  async function runDueCheck() {
    try {
      const result = await processDueRecurringRules(todayISO())
      onFeedback(`固定扣款检查完成：已入账 ${result.posted}，待确认 ${result.pending}，资金不足 ${result.insufficient}`)
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : '固定扣款检查失败')
    }
  }

  const actionable = instances
    .filter((instance) => ['pending', 'insufficient_funds'].includes(instance.status))
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))

  return (
    <div className="finance-planning-view">
      <section className="finance-section-card finance-recurring-list">
        <header><div><span>每个规则与账期只有一个稳定实例</span><h2>固定扣款</h2></div><button onClick={() => void runDueCheck()}>检查到期</button></header>
        {actionable.length > 0 && <ul className="finance-actionable-instances">{actionable.map((instance) => {
          const rule = rules.find((item) => item.id === instance.ruleId)
          return <li key={instance.id}><div><strong>{rule?.name ?? '固定扣款'}</strong><span>{instance.scheduledDate} · {formatMoney(instance.amountMinor, instance.currency)}{instance.shortageReason ? ` · ${instance.shortageReason}` : ''}</span></div><button onClick={() => void confirmRecurringInstance(instance.id).then(() => onFeedback('固定扣款已确认入账')).catch((error: unknown) => onFeedback(error instanceof Error ? error.message : '入账失败'))}>确认</button><button onClick={() => void skipRecurringInstance(instance.id).then(() => onFeedback('本期已跳过'))}>跳过</button></li>
        })}</ul>}
        {rules.length > 0 && <ul>{rules.map((rule) => <li key={rule.id}><div><strong>{rule.name}</strong><span>每月 {rule.billingDay} 日 · {rule.postingMode === 'automatic' ? '自动入账' : '待确认'} · {rule.enabled ? '已启用' : '已暂停'}</span></div><div><b>{formatMoney(rule.amountMinor, rule.currency)}</b><span className="finance-inline-actions"><button type="button" onClick={() => void setRecurringRuleEnabled(rule.id, !rule.enabled).then(() => onFeedback(rule.enabled ? '固定扣款已暂停' : '固定扣款已启用')).catch((error: unknown) => onFeedback(error instanceof Error ? error.message : '更新失败'))}>{rule.enabled ? '暂停' : '启用'}</button></span></div></li>)}</ul>}
        <form className="finance-form-grid-v2 finance-recurring-composer" onSubmit={createRule}>
          <label>名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 房租" /></label>
          <label>金额<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          <label>支付账户<select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">请选择</option>{accounts.filter((account) => account.lifecycleStatus === 'active').map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label>
          <label>承担资金池<select value={poolId} onChange={(event) => setPoolId(event.target.value)}><option value="">请选择</option>{pools.filter((pool) => !accountId || pool.currency === accounts.find((account) => account.id === accountId)?.currency).map((pool) => <option key={pool.id} value={pool.id}>{pool.name}</option>)}</select></label>
          <label>分类<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">未分类</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label>每月扣款日<input type="number" min="1" max="31" value={billingDay} onChange={(event) => setBillingDay(event.target.value)} /></label>
          <label className="wide">入账方式<select value={postingMode} onChange={(event) => setPostingMode(event.target.value as 'automatic' | 'confirmation')}><option value="confirmation">待确认</option><option value="automatic">自动入账</option></select></label>
          <button className="primary wide" disabled={!name.trim() || !amount || !accountId}>创建固定扣款</button>
        </form>
      </section>

      <section className="finance-section-card finance-projection-card">
        <header><div><span>{currentMonth()} · 公式和假设可编辑</span><h2>预计月底可储蓄</h2></div><strong>{formatMoney(projection.projectedSavingsMinor, reportingCurrency)}</strong></header>
        <p>预计收入 − 固定扣款 − 已发生本人支出 − 已知计划支出 − 剩余生活预算</p>
        <form className="finance-form-grid-v2" onSubmit={saveProjection}>
          <label>预计收入<input inputMode="decimal" value={expectedIncome} onChange={(event) => setExpectedIncome(event.target.value)} placeholder={String(fromMinor(budget?.expectedIncomeMinor ?? 0, reportingCurrency))} /></label>
          <label>剩余生活预算<input inputMode="decimal" value={livingBudget} onChange={(event) => setLivingBudget(event.target.value)} placeholder={String(fromMinor(budget?.remainingLivingBudgetMinor ?? 0, reportingCurrency))} /></label>
          <label className="wide">已知计划支出<input inputMode="decimal" value={plannedExpense} onChange={(event) => setPlannedExpense(event.target.value)} placeholder={String(fromMinor(budget?.plannedExpenseMinor ?? 0, reportingCurrency))} /></label>
          <button className="primary wide">保存预测假设</button>
        </form>
      </section>
    </div>
  )
}
