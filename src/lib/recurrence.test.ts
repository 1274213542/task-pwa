import { describe, expect, it } from 'vitest'
import {
  type AfterCompletionRule,
  type FixedScheduleRule,
  fixedOccurrencesInRange,
  latestFixedOnOrBefore,
  matchesFixed,
  nextAfterCompletion,
} from './recurrence'

const daily = (interval = 1): FixedScheduleRule => ({
  mode: 'fixed_schedule',
  frequency: 'daily',
  interval,
  overflowPolicy: 'clamp',
})
const weekly = (
  weekdays: FixedScheduleRule['weekdays'],
  interval = 1,
): FixedScheduleRule => ({
  mode: 'fixed_schedule',
  frequency: 'weekly',
  interval,
  weekdays,
  overflowPolicy: 'clamp',
})
const monthly = (
  dayOfMonth: number,
  overflowPolicy: 'clamp' | 'skip' = 'clamp',
  interval = 1,
): FixedScheduleRule => ({
  mode: 'fixed_schedule',
  frequency: 'monthly',
  interval,
  dayOfMonth,
  overflowPolicy,
})
const ac = (
  intervalValue: number,
  intervalUnit: AfterCompletionRule['intervalUnit'],
  overflowPolicy: 'clamp' | 'skip' = 'clamp',
): AfterCompletionRule => ({
  mode: 'after_completion',
  intervalValue,
  intervalUnit,
  overflowPolicy,
})

describe('daily', () => {
  it('每天：锚定日起每日命中', () => {
    expect(matchesFixed(daily(), '2026-07-01', undefined, '2026-07-01')).toBe(true)
    expect(matchesFixed(daily(), '2026-07-01', undefined, '2026-07-15')).toBe(true)
  })
  it('锚定日之前不命中', () => {
    expect(matchesFixed(daily(), '2026-07-10', undefined, '2026-07-09')).toBe(false)
  })
  it('endDate 之后不命中（endDate 当日含）', () => {
    expect(matchesFixed(daily(), '2026-07-01', '2026-07-10', '2026-07-10')).toBe(true)
    expect(matchesFixed(daily(), '2026-07-01', '2026-07-10', '2026-07-11')).toBe(false)
  })
  it('每 3 天', () => {
    expect(matchesFixed(daily(3), '2026-07-01', undefined, '2026-07-04')).toBe(true)
    expect(matchesFixed(daily(3), '2026-07-01', undefined, '2026-07-05')).toBe(false)
  })
})

describe('weekly', () => {
  it('每周一（默认预设）', () => {
    // 2026-07-20 是周一
    expect(matchesFixed(weekly([1]), '2026-07-01', undefined, '2026-07-20')).toBe(true)
    expect(matchesFixed(weekly([1]), '2026-07-01', undefined, '2026-07-21')).toBe(false)
  })
  it('多个星期几', () => {
    const r = weekly([1, 3, 5])
    expect(matchesFixed(r, '2026-07-01', undefined, '2026-07-22')).toBe(true) // 周三
    expect(matchesFixed(r, '2026-07-01', undefined, '2026-07-23')).toBe(false) // 周四
  })
  it('缺省 weekdays = 锚定日的星期', () => {
    // 2026-07-01 是周三
    const r = weekly(undefined)
    expect(matchesFixed(r, '2026-07-01', undefined, '2026-07-08')).toBe(true)
    expect(matchesFixed(r, '2026-07-01', undefined, '2026-07-09')).toBe(false)
  })
  it('每 2 周：隔周不命中（跨周界对齐）', () => {
    const r = weekly([1], 2)
    // 锚定周的周一 2026-06-29；隔周 07-06 不命中，07-13 命中
    expect(matchesFixed(r, '2026-07-01', undefined, '2026-07-06')).toBe(false)
    expect(matchesFixed(r, '2026-07-01', undefined, '2026-07-13')).toBe(true)
  })
})

describe('monthly 与短月边界（决策表 #1/#2）', () => {
  it('每月 15 日', () => {
    expect(matchesFixed(monthly(15), '2026-01-15', undefined, '2026-07-15')).toBe(true)
    expect(matchesFixed(monthly(15), '2026-01-15', undefined, '2026-07-14')).toBe(false)
  })
  it('每月 31 日 clamp：4 月落在 30 日', () => {
    const r = monthly(31, 'clamp')
    expect(matchesFixed(r, '2026-01-31', undefined, '2026-04-30')).toBe(true)
    expect(matchesFixed(r, '2026-01-31', undefined, '2026-04-29')).toBe(false)
    expect(matchesFixed(r, '2026-01-31', undefined, '2026-03-31')).toBe(true)
  })
  it('每月 31 日 clamp：平年二月落在 2/28', () => {
    expect(matchesFixed(monthly(31, 'clamp'), '2026-01-31', undefined, '2026-02-28')).toBe(true)
  })
  it('每月 31 日 clamp：闰年二月落在 2/29', () => {
    expect(matchesFixed(monthly(31, 'clamp'), '2028-01-31', undefined, '2028-02-29')).toBe(true)
    expect(matchesFixed(monthly(31, 'clamp'), '2028-01-31', undefined, '2028-02-28')).toBe(false)
  })
  it('每月 31 日 skip：二月与四月无实例', () => {
    const r = monthly(31, 'skip')
    expect(fixedOccurrencesInRange(r, '2026-01-31', undefined, '2026-02-01', '2026-04-30')).toEqual([
      '2026-03-31',
    ])
  })
  it('每月最后一天（-1）：自动适配月长与闰年', () => {
    const r = monthly(-1)
    expect(matchesFixed(r, '2026-01-01', undefined, '2026-02-28')).toBe(true)
    expect(matchesFixed(r, '2026-01-01', undefined, '2026-04-30')).toBe(true)
    expect(matchesFixed(r, '2028-01-01', undefined, '2028-02-29')).toBe(true)
    expect(matchesFixed(r, '2028-01-01', undefined, '2028-02-28')).toBe(false)
  })
  it('每 2 个月对齐', () => {
    const r = monthly(10, 'clamp', 2)
    expect(matchesFixed(r, '2026-01-10', undefined, '2026-03-10')).toBe(true)
    expect(matchesFixed(r, '2026-01-10', undefined, '2026-04-10')).toBe(false)
  })
  it('每 3 个月与每 6 个月按锚点生成', () => {
    expect(matchesFixed(monthly(12, 'clamp', 3), '2026-01-12', undefined, '2026-04-12')).toBe(true)
    expect(matchesFixed(monthly(12, 'clamp', 3), '2026-01-12', undefined, '2026-05-12')).toBe(false)
    expect(matchesFixed(monthly(12, 'clamp', 6), '2026-01-12', undefined, '2026-07-12')).toBe(true)
  })
})

describe('窗口展开与逾期（决策表 #4）', () => {
  it('月窗口展开每周一', () => {
    expect(
      fixedOccurrencesInRange(weekly([1]), '2026-07-01', undefined, '2026-07-01', '2026-07-31'),
    ).toEqual(['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27'])
  })
  it('latestFixedOnOrBefore：返回最近一期（逾期显示只取这一条）', () => {
    expect(latestFixedOnOrBefore(weekly([1]), '2026-07-01', undefined, '2026-07-15')).toBe(
      '2026-07-13',
    )
  })
  it('锚定日前无实例', () => {
    expect(latestFixedOnOrBefore(daily(), '2026-08-01', undefined, '2026-07-15')).toBeUndefined()
  })
})

describe('after_completion（决策表 #5/#6/#7）', () => {
  it('完成后 7 天', () => {
    expect(nextAfterCompletion(ac(7, 'day'), '2026-07-01')).toBe('2026-07-08')
  })
  it('完成后 2 周', () => {
    expect(nextAfterCompletion(ac(2, 'week'), '2026-07-01')).toBe('2026-07-15')
  })
  it('完成后 1 个月 clamp：1/31 → 2/28（平年）', () => {
    expect(nextAfterCompletion(ac(1, 'month'), '2026-01-31')).toBe('2026-02-28')
  })
  it('完成后 1 个月 clamp：1/31 → 2/29（闰年）', () => {
    expect(nextAfterCompletion(ac(1, 'month'), '2028-01-31')).toBe('2028-02-29')
  })
  it('完成后 1 个月 skip：1/31 跳过短月直到 3/31', () => {
    expect(nextAfterCompletion(ac(1, 'month', 'skip'), '2026-01-31')).toBe('2026-03-31')
  })
  it('提前完成从实际完成日起算（机制定义）', () => {
    // 原定 7/20，7/15 提前完成 → 下一期 7/22
    expect(nextAfterCompletion(ac(7, 'day'), '2026-07-15')).toBe('2026-07-22')
  })
  it('跨年', () => {
    expect(nextAfterCompletion(ac(1, 'month'), '2026-12-15')).toBe('2027-01-15')
  })
})
