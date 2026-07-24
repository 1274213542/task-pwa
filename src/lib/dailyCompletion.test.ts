import { describe, expect, it } from 'vitest'
import {
  dailyCompletionRate,
  isPreviousDayCompletion,
} from './dailyCompletion'

describe('首页本日任务完成率', () => {
  it('排除跳过任务并保留已完成隐藏任务的完成记录', () => {
    expect(dailyCompletionRate([
      { completed: true },
      { completed: false },
      { completed: false, skipped: true },
    ])).toEqual({ completed: 1, total: 2, percentage: 50 })
  })

  it('当天无任务时不显示误导性的 0%', () => {
    expect(dailyCompletionRate([])).toEqual({ completed: 0, total: 0, percentage: undefined })
  })

  it('跨天后不把前一天完成的投影继续当作今天事项', () => {
    expect(isPreviousDayCompletion(true, '2026-07-23', '2026-07-24')).toBe(true)
    expect(isPreviousDayCompletion(true, '2026-07-24', '2026-07-24')).toBe(false)
    expect(isPreviousDayCompletion(false, '2026-07-23', '2026-07-24')).toBe(false)
  })
})
