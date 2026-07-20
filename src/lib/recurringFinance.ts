import { Temporal } from 'temporal-polyfill'
import { db } from './db'
import { accountOwnership, saveSpending } from './ledger'
import type {
  CurrencyCode,
  RecurringPostingMode,
  RecurringTransactionInstance,
  RecurringTransactionRule,
} from './ledgerTypes'
import { appendRank } from './rank'

const now = () => new Date().toISOString()

export function recurringInstanceId(ruleId: string, billingPeriod: string) {
  return `recurring-instance:${ruleId}:${billingPeriod}`
}

export function recurringTransactionId(ruleId: string, billingPeriod: string) {
  return `recurring-transaction:${ruleId}:${billingPeriod}`
}

export function scheduledDateForPeriod(billingPeriod: string, billingDay: number) {
  const month = Temporal.PlainYearMonth.from(billingPeriod)
  return month.toPlainDate({ day: Math.min(billingDay, month.daysInMonth) }).toString()
}

function monthsBetween(startDate: string, referenceDate: string) {
  const start = Temporal.PlainDate.from(startDate).toPlainYearMonth()
  const end = Temporal.PlainDate.from(referenceDate).toPlainYearMonth()
  const result: string[] = []
  let cursor = start
  while (Temporal.PlainYearMonth.compare(cursor, end) <= 0) {
    result.push(cursor.toString())
    cursor = cursor.add({ months: 1 })
  }
  return result
}

export async function saveRecurringRule(input: {
  id?: string
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
  enabled?: boolean
}) {
  const name = input.name.trim()
  if (!name) throw new Error('请输入固定扣款名称')
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error('请输入有效金额')
  if (!Number.isInteger(input.billingDay) || input.billingDay < 1 || input.billingDay > 31) {
    throw new Error('扣款日必须是 1–31')
  }
  if (input.endDate && input.endDate < input.startDate) throw new Error('结束日期不能早于开始日期')
  const account = await db.accounts.get(input.accountId)
  if (!account || account.lifecycleStatus !== 'active' || account.isArchived || account.currency !== input.currency) {
    throw new Error('默认支付账户无效或币种不一致')
  }
  if (accountOwnership(account) === 'external') throw new Error('固定扣款需要本人资产或信用账户')
  const existing = input.id ? await db.recurringTransactionRules.get(input.id) : undefined
  const active = await db.recurringTransactionRules.where('lifecycleStatus').equals('active').sortBy('rank')
  const timestamp = now()
  const id = input.id ?? crypto.randomUUID()
  const row: RecurringTransactionRule = {
    id,
    name,
    amountMinor: input.amountMinor,
    currency: input.currency,
    ...(input.categoryId && { categoryId: input.categoryId }),
    accountId: input.accountId,
    ...(input.merchantName?.trim() && { merchantName: input.merchantName.trim() }),
    billingDay: input.billingDay,
    startDate: input.startDate,
    ...(input.endDate && { endDate: input.endDate }),
    postingMode: input.postingMode,
    ...(input.note?.trim() && { note: input.note.trim() }),
    enabled: input.enabled ?? existing?.enabled ?? true,
    rank: existing?.rank ?? appendRank(active.at(-1)?.rank),
    lifecycleStatus: 'active',
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }
  await db.recurringTransactionRules.put(row)
  return id
}

export async function setRecurringRuleEnabled(id: string, enabled: boolean) {
  const rule = await db.recurringTransactionRules.get(id)
  if (!rule || rule.lifecycleStatus !== 'active') throw new Error('固定扣款规则不存在')
  await db.recurringTransactionRules.update(id, { enabled, updatedAt: now() })
}

async function postInstance(
  rule: RecurringTransactionRule,
  instance: RecurringTransactionInstance,
  amountMinor = instance.amountMinor,
) {
  const transactionId = recurringTransactionId(rule.id, instance.billingPeriod)
  await saveSpending({
    id: transactionId,
    amountMinor,
    currency: rule.currency,
    localDate: instance.scheduledDate,
    accountId: rule.accountId,
    categoryId: rule.categoryId,
    merchantName: rule.merchantName,
    note: rule.note ?? `固定扣款：${rule.name}`,
  })
  await db.transaction('rw', db.financeTransactions, db.recurringTransactionInstances, async () => {
    await db.financeTransactions.update(transactionId, {
      recurringInstanceId: instance.id,
      updatedAt: now(),
    })
    await db.recurringTransactionInstances.update(instance.id, {
      status: 'posted',
      transactionId,
      confirmedAmountMinor: amountMinor,
      shortageReason: undefined,
      updatedAt: now(),
    })
  })
  return transactionId
}

export async function processDueRecurringRules(referenceDate: string) {
  const rules = await db.recurringTransactionRules
    .where('lifecycleStatus')
    .equals('active')
    .filter((rule) => rule.enabled)
    .toArray()
  const result = { posted: 0, pending: 0, insufficient: 0, skippedExisting: 0 }
  for (const rule of rules) {
    for (const billingPeriod of monthsBetween(rule.startDate, referenceDate)) {
      const scheduledDate = scheduledDateForPeriod(billingPeriod, rule.billingDay)
      if (scheduledDate < rule.startDate || scheduledDate > referenceDate || (rule.endDate && scheduledDate > rule.endDate)) continue
      const id = recurringInstanceId(rule.id, billingPeriod)
      let instance = await db.recurringTransactionInstances.get(id)
      if (instance?.status === 'posted' || instance?.status === 'skipped' || instance?.status === 'voided') {
        result.skippedExisting += 1
        continue
      }
      if (!instance) {
        instance = {
          id,
          ruleId: rule.id,
          billingPeriod,
          scheduledDate,
          amountMinor: rule.amountMinor,
          currency: rule.currency,
          status: 'pending',
          createdAt: now(),
          updatedAt: now(),
        }
        await db.recurringTransactionInstances.put(instance)
      }
      if (rule.postingMode === 'confirmation') {
        result.pending += 1
        continue
      }
      try {
        await postInstance(rule, instance)
        result.posted += 1
      } catch (error) {
        const shortageReason = error instanceof Error ? error.message : String(error)
        await db.recurringTransactionInstances.update(id, {
          status: 'insufficient_funds',
          shortageReason,
          updatedAt: now(),
        })
        result.insufficient += 1
      }
    }
  }
  return result
}

export async function confirmRecurringInstance(id: string, amountMinor?: number) {
  const instance = await db.recurringTransactionInstances.get(id)
  if (!instance || ['posted', 'voided', 'skipped'].includes(instance.status)) throw new Error('待处理扣款不存在或已处理')
  const rule = await db.recurringTransactionRules.get(instance.ruleId)
  if (!rule || rule.lifecycleStatus !== 'active') throw new Error('固定扣款规则不存在')
  return postInstance(rule, instance, amountMinor ?? instance.amountMinor)
}

export async function skipRecurringInstance(id: string) {
  const instance = await db.recurringTransactionInstances.get(id)
  if (!instance || instance.status === 'posted') throw new Error('已入账扣款不能跳过')
  await db.recurringTransactionInstances.update(id, { status: 'skipped', updatedAt: now() })
}
