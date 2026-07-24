import { describe, expect, it } from 'vitest'
import {
  completionCivilDate,
  dailyCompletionRate,
  isPreviousDayCompletion,
  latestOneTimeCompletion,
} from './dailyCompletion'
import type { CompletionRecord } from './db'

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

  it('兼容旧 daily 记录并按真实完成日识别一次性任务', () => {
    const record = {
      id: 'task-1:daily:2026-07-23',
      taskId: 'task-1',
      occurrenceKey: 'daily:2026-07-23',
      occurrenceDate: '2026-07-20',
      resolution: 'completed',
      resolvedAt: '2026-07-23T13:20:00+09:00',
      completedDate: '2026-07-23',
      titleSnapshot: '健身',
      templateVersion: 1,
      createdAt: '2026-07-23T13:20:00+09:00',
      updatedAt: '2026-07-23T13:20:00+09:00',
    } satisfies CompletionRecord

    expect(completionCivilDate(record)).toBe('2026-07-23')
    expect(latestOneTimeCompletion([record], 'task-1')).toBe(record)
    expect(isPreviousDayCompletion(true, completionCivilDate(record), '2026-07-24')).toBe(true)
  })

  it('优先使用 resolvedAt 而不是旧的计划日期', () => {
    const record = {
      id: 'task-2:single',
      taskId: 'task-2',
      occurrenceKey: 'single',
      occurrenceDate: '2026-07-20',
      resolution: 'completed',
      resolvedAt: '2026-07-24T01:30:00Z',
      titleSnapshot: '逾期任务',
      templateVersion: 1,
      createdAt: '2026-07-24T01:30:00Z',
      updatedAt: '2026-07-24T01:30:00Z',
    } satisfies CompletionRecord

    expect(completionCivilDate(record)).toBe('2026-07-24')
  })
})
