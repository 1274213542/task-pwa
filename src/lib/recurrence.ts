import { Temporal } from 'temporal-polyfill'

/**
 * 周期任务引擎（技术方案 v4.2 §7）。
 * 纯函数、无 I/O：所有日期都是 PlainDate ISO 字符串（无时区问题）。
 * fixed_schedule 未来实例虚拟生成；after_completion 只推导"下一期"。
 */

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7 // ISO：1=周一 … 7=周日
export type OverflowPolicy = 'clamp' | 'skip'

export interface FixedScheduleRule {
  mode: 'fixed_schedule'
  frequency: 'daily' | 'weekly' | 'monthly'
  interval: number // 每 n 天/周/月，≥1
  weekdays?: Weekday[] // weekly：周几，缺省 = 锚定日的星期
  dayOfMonth?: number // monthly：1..31，-1 = 每月最后一天；缺省 = 锚定日
  overflowPolicy: OverflowPolicy
}

export interface AfterCompletionRule {
  mode: 'after_completion'
  intervalValue: number
  intervalUnit: 'day' | 'week' | 'month'
  overflowPolicy: OverflowPolicy
}

export type Recurrence = FixedScheduleRule | AfterCompletionRule

const pd = (iso: string) => Temporal.PlainDate.from(iso)

/** 周起始（ISO 周一）对齐，用于 weekly interval 计算 */
function mondayOf(d: Temporal.PlainDate): Temporal.PlainDate {
  return d.subtract({ days: d.dayOfWeek - 1 })
}

/** 某日是否命中 fixed 规则（startDate 为锚定日，endDate 含当日） */
export function matchesFixed(
  rule: FixedScheduleRule,
  startDate: string,
  endDate: string | undefined,
  dateISO: string,
): boolean {
  const date = pd(dateISO)
  const start = pd(startDate)
  if (Temporal.PlainDate.compare(date, start) < 0) return false
  if (endDate && Temporal.PlainDate.compare(date, pd(endDate)) > 0) return false

  switch (rule.frequency) {
    case 'daily': {
      const days = start.until(date, { largestUnit: 'day' }).days
      return days % rule.interval === 0
    }
    case 'weekly': {
      const weekdays = rule.weekdays?.length
        ? rule.weekdays
        : [start.dayOfWeek as Weekday]
      if (!weekdays.includes(date.dayOfWeek as Weekday)) return false
      const weeks =
        mondayOf(start).until(mondayOf(date), { largestUnit: 'day' }).days / 7
      return weeks % rule.interval === 0
    }
    case 'monthly': {
      const dom = rule.dayOfMonth ?? start.day
      const months =
        (date.year - start.year) * 12 + (date.month - start.month)
      if (months < 0 || months % rule.interval !== 0) return false
      if (dom === -1) return date.day === date.daysInMonth
      if (dom <= date.daysInMonth) return date.day === dom
      // 短月溢出：clamp = 当月最后一天；skip = 本月无实例
      return rule.overflowPolicy === 'clamp'
        ? date.day === date.daysInMonth
        : false
    }
  }
}

/** 窗口内的全部 fixed 实例日期（含两端），供月历/今天视图虚拟展开 */
export function fixedOccurrencesInRange(
  rule: FixedScheduleRule,
  startDate: string,
  endDate: string | undefined,
  rangeStart: string,
  rangeEnd: string,
): string[] {
  const out: string[] = []
  let d = pd(rangeStart)
  const end = pd(rangeEnd)
  while (Temporal.PlainDate.compare(d, end) <= 0) {
    const iso = d.toString()
    if (matchesFixed(rule, startDate, endDate, iso)) out.push(iso)
    d = d.add({ days: 1 })
  }
  return out
}

/** 最近一期 ≤ 今天的 fixed 实例（逾期显示用；v4.2：只显示最近一期逾期） */
export function latestFixedOnOrBefore(
  rule: FixedScheduleRule,
  startDate: string,
  endDate: string | undefined,
  todayISO: string,
  lookbackDays = 62,
): string | undefined {
  let d = pd(todayISO)
  const floor = pd(startDate)
  for (let i = 0; i < lookbackDays; i++) {
    if (Temporal.PlainDate.compare(d, floor) < 0) return undefined
    const iso = d.toString()
    if (matchesFixed(rule, startDate, endDate, iso)) return iso
    d = d.subtract({ days: 1 })
  }
  return undefined
}

/** after_completion：基准日 + 间隔（含短月 overflow 策略） */
export function nextAfterCompletion(
  rule: AfterCompletionRule,
  baseISO: string,
): string {
  const base = pd(baseISO)
  const n = rule.intervalValue
  switch (rule.intervalUnit) {
    case 'day':
      return base.add({ days: n }).toString()
    case 'week':
      return base.add({ weeks: n }).toString()
    case 'month': {
      if (rule.overflowPolicy === 'clamp') {
        // Temporal constrain 溢出即"当月最后一天"
        return base.add({ months: n }, { overflow: 'constrain' }).toString()
      }
      // skip：目标月放不下该日期时，跳到下一个间隔月，直到放得下（有界循环）
      for (let k = 1; k <= 48; k++) {
        const target = base.add({ months: n * k }, { overflow: 'constrain' })
        if (target.day === base.day) return target.toString()
      }
      // 4 年内都放不下（理论上只有 interval 异常时发生）：退化为 clamp
      return base.add({ months: n }, { overflow: 'constrain' }).toString()
    }
  }
}

/** 供 UI 的规则摘要文案 */
export function describeRecurrence(r: Recurrence): string {
  if (r.mode === 'after_completion') {
    const unit = { day: '天', week: '周', month: '个月' }[r.intervalUnit]
    return `完成后 ${r.intervalValue} ${unit}`
  }
  const every = r.interval > 1 ? `每 ${r.interval} ` : '每'
  switch (r.frequency) {
    case 'daily':
      return r.interval > 1 ? `${every}天` : '每天'
    case 'weekly': {
      const names = ['一', '二', '三', '四', '五', '六', '日']
      const days = (r.weekdays ?? []).map((w) => `周${names[w - 1]}`).join('、')
      return `${every}周${days ? ` ${days}` : ''}`
    }
    case 'monthly':
      return r.dayOfMonth === -1
        ? `${every}月最后一天`
        : `${every}月 ${r.dayOfMonth ?? ''} 日`
  }
}
