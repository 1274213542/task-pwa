import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Temporal } from 'temporal-polyfill'
import { useSearchParams } from 'react-router-dom'
import AppIcon from '../components/AppIcon'
import MarkerIcon from '../components/MarkerIcon'
import MobilePageHeader from '../components/MobilePageHeader'
import PageHeader from '../components/PageHeader'
import {
  db,
  type ColorToken,
  type ExpenseRecord,
  type WorkRecord,
} from '../lib/db'
import { todayLocalISO } from '../lib/dates'
import {
  addExpenseCategory,
  expenseSummary,
  saveExpense,
  saveWorkRecord,
  softDeleteExpense,
  softDeleteWorkRecord,
  updateDefaultHourlyRate,
  workSummary,
} from '../lib/finance'

type FinanceMode = 'work' | 'expense'

function monthRange(dateISO: string) {
  const date = Temporal.PlainDate.from(dateISO)
  const start = date.with({ day: 1 })
  return {
    start: start.toString(),
    end: start.add({ months: 1 }).subtract({ days: 1 }).toString(),
  }
}

function money(value: number) {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(value)
}

function hours(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}小时 ${m}分` : `${h}小时`
}

export default function Finance() {
  const today = todayLocalISO()
  const currentMonth = monthRange(today)
  const [searchParams, setSearchParams] = useSearchParams()
  const [mode, setMode] = useState<FinanceMode>(
    searchParams.get('mode') === 'expense' ? 'expense' : 'work',
  )
  const [rangeStart, setRangeStart] = useState(currentMonth.start)
  const [rangeEnd, setRangeEnd] = useState(today)
  const [workEditorOpen, setWorkEditorOpen] = useState(searchParams.get('new') === '1')
  const [expenseEditorOpen, setExpenseEditorOpen] = useState(false)
  const [editingWorkId, setEditingWorkId] = useState<string | null>(null)
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const savingRef = useRef(false)

  const workRecordsLive = useLiveQuery(
    () => db.workRecords.where('lifecycleStatus').equals('active').toArray(),
    [],
  )
  const workRecords = useMemo(() => workRecordsLive ?? [], [workRecordsLive])
  const wageSettings = useLiveQuery(() => db.wageSettings.get('#wage'), [])
  const expenseRecordsLive = useLiveQuery(
    () => db.expenseRecords.where('lifecycleStatus').equals('active').toArray(),
    [],
  )
  const expenseRecords = useMemo(() => expenseRecordsLive ?? [], [expenseRecordsLive])
  const categories = useLiveQuery(
    () => db.expenseCategories.where('lifecycleStatus').equals('active').sortBy('rank'),
    [],
  ) ?? []

  const [workDate, setWorkDate] = useState(searchParams.get('date') || today)
  const [worked, setWorked] = useState(true)
  const [durationMode, setDurationMode] = useState<'hours' | 'clock'>('hours')
  const [workHours, setWorkHours] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('17:00')
  const [breakMinutes, setBreakMinutes] = useState('0')
  const [workLocation, setWorkLocation] = useState('')
  const [workType, setWorkType] = useState('')
  const [workNote, setWorkNote] = useState('')
  const [hourlyRate, setHourlyRate] = useState('')
  const [defaultRate, setDefaultRate] = useState('')

  const [expenseDate, setExpenseDate] = useState(today)
  const [amount, setAmount] = useState('')
  const [merchant, setMerchant] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [expenseNote, setExpenseNote] = useState('')
  const [newCategory, setNewCategory] = useState('')

  useEffect(() => {
    if (wageSettings) setDefaultRate(String(wageSettings.defaultHourlyRate || ''))
  }, [wageSettings])

  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    setMode('work')
    setWorkDate(searchParams.get('date') || today)
    setWorkEditorOpen(true)
    setSearchParams({ mode: 'work' }, { replace: true })
  }, [searchParams, setSearchParams, today])

  const rangeWork = useMemo(
    () => workSummary(workRecords, rangeStart, rangeEnd),
    [workRecords, rangeStart, rangeEnd],
  )
  const monthWork = useMemo(
    () => workSummary(workRecords, currentMonth.start, today),
    [workRecords, currentMonth.start, today],
  )
  const rangeExpense = useMemo(
    () => expenseSummary(expenseRecords, rangeStart, rangeEnd),
    [expenseRecords, rangeStart, rangeEnd],
  )
  const monthExpense = useMemo(
    () => expenseSummary(expenseRecords, currentMonth.start, today),
    [expenseRecords, currentMonth.start, today],
  )

  const visibleWork = workRecords
    .filter((record) => record.date >= rangeStart && record.date <= rangeEnd)
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt))
  const visibleExpenses = expenseRecords
    .filter((record) => record.date >= rangeStart && record.date <= rangeEnd)
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt))

  function resetWork(date = today) {
    setEditingWorkId(null)
    setWorkDate(date)
    setWorked(true)
    setDurationMode('hours')
    setWorkHours('')
    setStartTime('09:00')
    setEndTime('17:00')
    setBreakMinutes('0')
    setWorkLocation('')
    setWorkType('')
    setWorkNote('')
    setHourlyRate('')
  }

  function editWork(record: WorkRecord) {
    setEditingWorkId(record.id)
    setWorkDate(record.date)
    setWorked(record.worked)
    setDurationMode(record.startTime && record.endTime ? 'clock' : 'hours')
    setWorkHours(String(record.durationMinutes / 60))
    setStartTime(record.startTime ?? '09:00')
    setEndTime(record.endTime ?? '17:00')
    setBreakMinutes(String(record.breakMinutes ?? 0))
    setWorkLocation(record.workLocation ?? '')
    setWorkType(record.workType ?? '')
    setWorkNote(record.note ?? '')
    setHourlyRate(String(record.hourlyRate))
    setWorkEditorOpen(true)
  }

  async function submitWork() {
    if (savingRef.current) return
    savingRef.current = true
    try {
      await saveWorkRecord({
        id: editingWorkId ?? undefined,
        date: workDate,
        worked,
        ...(durationMode === 'hours'
          ? { hours: Number(workHours) }
          : { startTime, endTime }),
        breakMinutes: Number(breakMinutes || 0),
        workLocation,
        workType,
        note: workNote,
        hourlyRate: hourlyRate === '' ? undefined : Number(hourlyRate),
      })
      setFeedback(editingWorkId ? '工作记录已更新' : '工作记录已保存')
      setWorkEditorOpen(false)
      resetWork(workDate)
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      savingRef.current = false
    }
  }

  function resetExpense() {
    setEditingExpenseId(null)
    setExpenseDate(today)
    setAmount('')
    setMerchant('')
    setCategoryId('')
    setPaymentMethod('')
    setExpenseNote('')
  }

  function editExpense(record: ExpenseRecord) {
    setEditingExpenseId(record.id)
    setExpenseDate(record.date)
    setAmount(String(record.amount))
    setMerchant(record.merchant ?? '')
    setCategoryId(record.categoryId ?? '')
    setPaymentMethod(record.paymentMethod ?? '')
    setExpenseNote(record.note ?? '')
    setExpenseEditorOpen(true)
  }

  async function submitExpense() {
    if (savingRef.current) return
    savingRef.current = true
    try {
      await saveExpense({
        id: editingExpenseId ?? undefined,
        amount: Number(amount),
        date: expenseDate,
        merchant,
        categoryId: categoryId || undefined,
        paymentMethod,
        note: expenseNote,
      })
      setFeedback(editingExpenseId ? '支出记录已更新' : '支出记录已保存')
      setExpenseEditorOpen(false)
      resetExpense()
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      savingRef.current = false
    }
  }

  function switchMode(next: FinanceMode) {
    setMode(next)
    setSearchParams({ mode: next }, { replace: true })
  }

  return (
    <section className="app-page page-finance" data-mode={mode}>
      <MobilePageHeader
        title="财务"
        eyebrow="工时、收入与支出"
        onPrimary={() => mode === 'work'
          ? setWorkEditorOpen((open) => !open)
          : setExpenseEditorOpen((open) => !open)}
        primaryLabel={mode === 'work' ? '新增工作记录' : '新增支出'}
        primaryIcon="plus"
      />
      <PageHeader
        title="财务"
        eyebrow="把时间与日常花费放在同一条日期轴上"
        actions={(
          <button
            className="finance-header-add"
            onClick={() => mode === 'work' ? setWorkEditorOpen(true) : setExpenseEditorOpen(true)}
          >
            <AppIcon name="plus" size={18} /> 新增{mode === 'work' ? '工时' : '支出'}
          </button>
        )}
      />

      <div className="finance-mode-switch" role="tablist" aria-label="财务视图">
        <button role="tab" aria-selected={mode === 'work'} onClick={() => switchMode('work')}>
          <AppIcon name="work" size={18} /> 工作收入
        </button>
        <button role="tab" aria-selected={mode === 'expense'} onClick={() => switchMode('expense')}>
          <AppIcon name="receipt" size={18} /> 日常支出
        </button>
      </div>

      <div className="finance-current-summary">
        <article>
          <span>本月至今工时</span>
          <strong>{hours(monthWork.minutes)}</strong>
          <small>{monthWork.days} 个工作日</small>
        </article>
        <article>
          <span>预估税前工资</span>
          <strong>{money(monthWork.gross)}</strong>
          <small>按每条记录的时薪快照</small>
        </article>
        <article>
          <span>本月至今支出</span>
          <strong>{money(monthExpense.total)}</strong>
          <small>{monthExpense.count} 笔记录</small>
        </article>
      </div>

      <section className="finance-range-panel">
        <header>
          <div><span>统计范围</span><strong>{rangeStart} — {rangeEnd}</strong></div>
          <div className="finance-range-fields">
            <input type="date" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} />
            <span>至</span>
            <input type="date" min={rangeStart} value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} />
          </div>
        </header>
        <div className="finance-range-results">
          <span>工时 <strong>{hours(rangeWork.minutes)}</strong></span>
          <span>预估税前 <strong>{money(rangeWork.gross)}</strong></span>
          <span>支出 <strong>{money(rangeExpense.total)}</strong></span>
        </div>
      </section>

      <p className="finance-feedback" role="status">{feedback}</p>

      {mode === 'work' ? (
        <div className="finance-work-layout">
          <section className="finance-settings-card">
            <div>
              <span>默认时薪</span>
              <small>只影响之后新建的记录，历史工资不会被重算</small>
            </div>
            <div className="finance-rate-control">
              <span>¥</span>
              <input type="number" min="0" value={defaultRate} onChange={(event) => setDefaultRate(event.target.value)} />
              <button onClick={() => void updateDefaultHourlyRate(Number(defaultRate || 0))
                .then(() => setFeedback('默认时薪已更新'))
                .catch((reason: unknown) => setFeedback(reason instanceof Error ? reason.message : '时薪保存失败'))}>保存</button>
            </div>
          </section>

          {workEditorOpen && (
            <section className="finance-editor finance-work-editor">
              <header><div><span>{editingWorkId ? '编辑记录' : '新工作记录'}</span><h2>{workDate}</h2></div><button onClick={() => setWorkEditorOpen(false)}><AppIcon name="close" size={19} /></button></header>
              <div className="finance-form-grid">
                <label>日期<input type="date" value={workDate} onChange={(event) => setWorkDate(event.target.value)} /></label>
                <label className="finance-check-field"><input type="checkbox" checked={worked} onChange={(event) => setWorked(event.target.checked)} /> 这一天上班</label>
                {worked && <>
                  <div className="finance-inline-switch">
                    <button aria-pressed={durationMode === 'hours'} onClick={() => setDurationMode('hours')}>填写小时</button>
                    <button aria-pressed={durationMode === 'clock'} onClick={() => setDurationMode('clock')}>开始 / 结束</button>
                  </div>
                  {durationMode === 'hours' ? (
                    <label>工作小时<input type="number" min="0" step="0.25" value={workHours} onChange={(event) => setWorkHours(event.target.value)} placeholder="例如 7.5" /></label>
                  ) : (
                    <div className="finance-clock-grid"><label>开始<input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label><label>结束<input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label></div>
                  )}
                  <label>休息分钟<input type="number" min="0" value={breakMinutes} onChange={(event) => setBreakMinutes(event.target.value)} /></label>
                  <label>本条时薪（可选）<input type="number" min="0" value={hourlyRate} onChange={(event) => setHourlyRate(event.target.value)} placeholder={`默认 ¥${wageSettings?.defaultHourlyRate ?? 0}`} /></label>
                  <label>工作地点<input value={workLocation} onChange={(event) => setWorkLocation(event.target.value)} placeholder="例如 吉祥寺" /></label>
                  <label>工作类型<input value={workType} onChange={(event) => setWorkType(event.target.value)} placeholder="例如 设计 / 兼职" /></label>
                </>}
                <label className="finance-form-wide">备注<textarea rows={2} value={workNote} onChange={(event) => setWorkNote(event.target.value)} /></label>
              </div>
              <button className="finance-submit" onClick={() => void submitWork()}>保存工作记录</button>
            </section>
          )}

          <section className="finance-records">
            <header><div><span>按天查看</span><h2>工作记录</h2></div><strong>{visibleWork.length} 条</strong></header>
            {visibleWork.length ? <ul>{visibleWork.map((record) => (
              <li key={record.id}>
                <MarkerIcon symbol="squircle" color={record.worked ? 'green' : 'gray'} size={30} />
                <div><strong>{record.date}</strong><span>{record.worked ? `${hours(record.durationMinutes)} · ${record.workLocation || record.workType || '工作'}` : '休息日'}</span></div>
                <span className="finance-record-value">{record.worked ? money(record.durationMinutes / 60 * record.hourlyRate) : '—'}</span>
                <button aria-label="编辑工作记录" onClick={() => editWork(record)}><AppIcon name="edit" size={17} /></button>
                <button aria-label="删除工作记录" onClick={() => void softDeleteWorkRecord(record.id)}><AppIcon name="trash" size={17} /></button>
              </li>
            ))}</ul> : <div className="finance-empty">所选范围还没有工作记录</div>}
          </section>
        </div>
      ) : (
        <div className="finance-expense-layout">
          {expenseEditorOpen && (
            <section className="finance-editor finance-expense-editor">
              <header><div><span>{editingExpenseId ? '编辑支出' : '新支出'}</span><h2>哪一天、在哪里、花了多少</h2></div><button onClick={() => setExpenseEditorOpen(false)}><AppIcon name="close" size={19} /></button></header>
              <div className="finance-form-grid">
                <label>金额（JPY）<input type="number" min="0" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
                <label>日期<input type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} /></label>
                <label>地点 / 商家<input value={merchant} onChange={(event) => setMerchant(event.target.value)} placeholder="例如 Amazon / 超市" /></label>
                <label>分类<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">未分类</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
                <label>支付方式（可选）<input value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} placeholder="现金 / 信用卡 / 电子支付" /></label>
                <label>备注<textarea rows={2} value={expenseNote} onChange={(event) => setExpenseNote(event.target.value)} /></label>
              </div>
              <button className="finance-submit" onClick={() => void submitExpense()}>保存支出</button>
            </section>
          )}

          <section className="finance-category-manager">
            <div><span>支出分类</span><small>预设分类之外也可以添加自己的分类</small></div>
            <div><input value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="新分类" /><button onClick={() => void addExpenseCategory(newCategory, 'blue' as ColorToken).then(() => setNewCategory(''))}>添加</button></div>
          </section>

          <div className="finance-breakdowns">
            <section><span>按分类</span>{rangeExpense.byCategory.slice(0, 6).map(([name, value]) => <div key={name}><strong>{name}</strong><span>{money(value)}</span></div>)}</section>
            <section><span>按地点 / 商家</span>{rangeExpense.byMerchant.slice(0, 6).map(([name, value]) => <div key={name}><strong>{name}</strong><span>{money(value)}</span></div>)}</section>
          </div>

          <section className="finance-records">
            <header><div><span>最近支出</span><h2>支出记录</h2></div><strong>{visibleExpenses.length} 笔</strong></header>
            {visibleExpenses.length ? <ul>{visibleExpenses.map((record) => (
              <li key={record.id}>
                <MarkerIcon symbol="dot" color={categories.find((category) => category.id === record.categoryId)?.colorToken ?? 'orange'} size={30} />
                <div><strong>{record.merchant || '未填写地点'}</strong><span>{record.date} · {record.categoryNameSnapshot || '未分类'}</span></div>
                <span className="finance-record-value">{money(record.amount)}</span>
                <button aria-label="编辑支出" onClick={() => editExpense(record)}><AppIcon name="edit" size={17} /></button>
                <button aria-label="删除支出" onClick={() => void softDeleteExpense(record.id)}><AppIcon name="trash" size={17} /></button>
              </li>
            ))}</ul> : <div className="finance-empty">所选范围还没有支出记录</div>}
          </section>
        </div>
      )}
    </section>
  )
}
