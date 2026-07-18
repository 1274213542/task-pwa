import {
  db,
  type ColorToken,
  type ExpenseCategory,
  type ExpenseRecord,
  type WorkRecord,
} from './db'

const now = () => new Date().toISOString()

function cleanText(value?: string): string | undefined {
  const clean = value?.trim()
  return clean || undefined
}

function minutesFromClock(value: string): number {
  const [hour, minute] = value.split(':').map(Number)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0
  return hour * 60 + minute
}

export function calculateDurationMinutes(opts: {
  hours?: number
  startTime?: string
  endTime?: string
  breakMinutes?: number
}): number {
  const breakMinutes = Math.max(0, Math.round(opts.breakMinutes ?? 0))
  if (Number.isFinite(opts.hours) && (opts.hours ?? 0) >= 0) {
    return Math.max(0, Math.round((opts.hours ?? 0) * 60) - breakMinutes)
  }
  if (!opts.startTime || !opts.endTime) return 0
  const start = minutesFromClock(opts.startTime)
  let end = minutesFromClock(opts.endTime)
  if (end < start) end += 24 * 60
  return Math.max(0, end - start - breakMinutes)
}

export async function saveWorkRecord(opts: {
  id?: string
  date: string
  worked: boolean
  hours?: number
  startTime?: string
  endTime?: string
  breakMinutes?: number
  note?: string
  workLocation?: string
  workType?: string
  hourlyRate?: number
}): Promise<string> {
  const existing = opts.id ? await db.workRecords.get(opts.id) : undefined
  const settings = await db.wageSettings.get('#wage')
  const durationMinutes = opts.worked
    ? calculateDurationMinutes(opts)
    : 0
  if (opts.worked && durationMinutes <= 0) throw new Error('请输入有效的工作时长')
  const rate = opts.hourlyRate ?? existing?.hourlyRate ?? settings?.defaultHourlyRate ?? 0
  if (!Number.isFinite(rate) || rate < 0) throw new Error('时薪不能小于 0')
  const timestamp = now()
  const id = opts.id ?? crypto.randomUUID()
  const row: WorkRecord = {
    id,
    date: opts.date,
    worked: opts.worked,
    durationMinutes,
    ...(opts.worked && opts.startTime && { startTime: opts.startTime }),
    ...(opts.worked && opts.endTime && { endTime: opts.endTime }),
    ...(opts.worked && (opts.breakMinutes ?? 0) > 0 && { breakMinutes: Math.round(opts.breakMinutes!) }),
    ...(cleanText(opts.note) && { note: cleanText(opts.note) }),
    ...(cleanText(opts.workLocation) && { workLocation: cleanText(opts.workLocation) }),
    ...(cleanText(opts.workType) && { workType: cleanText(opts.workType) }),
    hourlyRate: rate,
    currency: 'JPY',
    lifecycleStatus: 'active',
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }
  await db.workRecords.put(row)
  return id
}

export async function softDeleteWorkRecord(id: string): Promise<void> {
  await db.workRecords.update(id, {
    lifecycleStatus: 'deleted',
    deletedAt: now(),
    updatedAt: now(),
  })
}

export async function updateDefaultHourlyRate(value: number): Promise<void> {
  if (!Number.isFinite(value) || value < 0) throw new Error('时薪不能小于 0')
  await db.wageSettings.put({
    id: '#wage',
    defaultHourlyRate: value,
    currency: 'JPY',
    updatedAt: now(),
  })
}

export function estimatedGross(record: WorkRecord): number {
  return (record.durationMinutes / 60) * record.hourlyRate
}

export function workSummary(records: WorkRecord[], start: string, end: string) {
  const included = records.filter(
    (record) =>
      record.lifecycleStatus === 'active' &&
      record.worked &&
      record.date >= start &&
      record.date <= end,
  )
  return {
    minutes: included.reduce((sum, record) => sum + record.durationMinutes, 0),
    gross: included.reduce((sum, record) => sum + estimatedGross(record), 0),
    days: new Set(included.map((record) => record.date)).size,
  }
}

export async function saveExpense(opts: {
  id?: string
  amount: number
  date: string
  merchant?: string
  categoryId?: string
  note?: string
  paymentMethod?: string
}): Promise<string> {
  if (!Number.isFinite(opts.amount) || opts.amount <= 0) throw new Error('请输入大于 0 的金额')
  const existing = opts.id ? await db.expenseRecords.get(opts.id) : undefined
  const category = opts.categoryId
    ? await db.expenseCategories.get(opts.categoryId)
    : undefined
  const timestamp = now()
  const id = opts.id ?? crypto.randomUUID()
  const row: ExpenseRecord = {
    id,
    amount: opts.amount,
    date: opts.date,
    ...(cleanText(opts.merchant) && { merchant: cleanText(opts.merchant) }),
    ...(opts.categoryId && { categoryId: opts.categoryId }),
    ...(category && { categoryNameSnapshot: category.name }),
    ...(cleanText(opts.note) && { note: cleanText(opts.note) }),
    ...(cleanText(opts.paymentMethod) && { paymentMethod: cleanText(opts.paymentMethod) }),
    lifecycleStatus: 'active',
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }
  await db.expenseRecords.put(row)
  return id
}

export async function softDeleteExpense(id: string): Promise<void> {
  await db.expenseRecords.update(id, {
    lifecycleStatus: 'deleted',
    deletedAt: now(),
    updatedAt: now(),
  })
}

export async function addExpenseCategory(
  name: string,
  colorToken: ColorToken = 'gray',
): Promise<void> {
  const clean = name.trim()
  if (!clean) return
  const timestamp = now()
  const row: ExpenseCategory = {
    id: crypto.randomUUID(),
    name: clean,
    colorToken,
    rank: Date.now().toString(36).padStart(10, '0'),
    lifecycleStatus: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  await db.expenseCategories.add(row)
}

export function expenseSummary(records: ExpenseRecord[], start: string, end: string) {
  const included = records.filter(
    (record) =>
      record.lifecycleStatus === 'active' &&
      record.date >= start &&
      record.date <= end,
  )
  const byCategory = new Map<string, number>()
  const byMerchant = new Map<string, number>()
  for (const record of included) {
    const category = record.categoryNameSnapshot ?? '未分类'
    const merchant = record.merchant ?? '未填写地点'
    byCategory.set(category, (byCategory.get(category) ?? 0) + record.amount)
    byMerchant.set(merchant, (byMerchant.get(merchant) ?? 0) + record.amount)
  }
  return {
    total: included.reduce((sum, record) => sum + record.amount, 0),
    count: included.length,
    byCategory: [...byCategory.entries()].sort((a, b) => b[1] - a[1]),
    byMerchant: [...byMerchant.entries()].sort((a, b) => b[1] - a[1]),
  }
}
