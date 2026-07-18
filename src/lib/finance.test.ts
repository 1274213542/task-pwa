import { describe, expect, it } from 'vitest'
import type { ExpenseRecord, WorkRecord } from './db'
import {
  calculateDurationMinutes,
  expenseSummary,
  workSummary,
} from './finance'

const work = (over: Partial<WorkRecord> = {}): WorkRecord => ({
  id: crypto.randomUUID(),
  date: '2026-07-18',
  worked: true,
  durationMinutes: 480,
  hourlyRate: 1200,
  currency: 'JPY',
  lifecycleStatus: 'active',
  createdAt: '2026-07-18T00:00:00Z',
  updatedAt: '2026-07-18T00:00:00Z',
  ...over,
})

const expense = (over: Partial<ExpenseRecord> = {}): ExpenseRecord => ({
  id: crypto.randomUUID(),
  amount: 800,
  date: '2026-07-18',
  lifecycleStatus: 'active',
  createdAt: '2026-07-18T00:00:00Z',
  updatedAt: '2026-07-18T00:00:00Z',
  ...over,
})

describe('工作时长与工资统计', () => {
  it('支持小时数和跨午夜时间段，并扣除休息', () => {
    expect(calculateDurationMinutes({ hours: 7.5, breakMinutes: 30 })).toBe(420)
    expect(calculateDurationMinutes({ startTime: '22:00', endTime: '02:00', breakMinutes: 15 })).toBe(225)
  })

  it('按记录中的时薪快照计算，不依赖当前默认时薪', () => {
    const summary = workSummary([
      work({ hourlyRate: 1000, durationMinutes: 60 }),
      work({ hourlyRate: 2000, durationMinutes: 60, date: '2026-07-19' }),
    ], '2026-07-01', '2026-07-31')
    expect(summary).toEqual({ minutes: 120, gross: 3000, days: 2 })
  })
})

describe('支出统计', () => {
  it('按范围、分类和商家汇总', () => {
    const summary = expenseSummary([
      expense({ amount: 800, merchant: '超市', categoryNameSnapshot: '餐饮' }),
      expense({ amount: 1200, merchant: 'Amazon', categoryNameSnapshot: '购物' }),
      expense({ amount: 999, date: '2026-08-01' }),
    ], '2026-07-01', '2026-07-31')
    expect(summary.total).toBe(2000)
    expect(summary.byCategory).toEqual([['购物', 1200], ['餐饮', 800]])
    expect(summary.byMerchant).toEqual([['Amazon', 1200], ['超市', 800]])
  })
})
