import { describe, expect, it } from 'vitest'
import type { CompletionRecord, Task } from './db'
import { planTaskPeriodSync } from './taskPeriodSync'

const recurringTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'fixed-1',
  title: '每日回顾',
  rank: 'a',
  startDate: '2026-07-19',
  taskScope: 'daily',
  recurrence: {
    mode: 'fixed_schedule',
    frequency: 'daily',
    interval: 1,
    overflowPolicy: 'clamp',
  },
  lifecycleStatus: 'active',
  templateVersion: 1,
  createdAt: '2026-07-19T00:00:00Z',
  updatedAt: '2026-07-19T00:00:00Z',
  ...overrides,
})

describe('task period synchronisation plan', () => {
  it('is idempotent for a complete current template', () => {
    const plan = planTaskPeriodSync([recurringTask()], [], 'daily', '2026-07-19')
    expect(plan).toEqual({ templateCount: 1, repairs: [], conflicts: [] })
  })

  it('repairs legacy scope/start fields without creating a second task', () => {
    const legacy = recurringTask({ taskScope: undefined, startDate: undefined })
    const first = planTaskPeriodSync([legacy], [], 'daily', '2026-07-19')
    expect(first.repairs).toEqual([{
      id: 'fixed-1',
      changes: { taskScope: 'daily', startDate: '2026-07-19' },
    }])
    const repaired = { ...legacy, ...first.repairs[0].changes }
    expect(planTaskPeriodSync([repaired], [], 'daily', '2026-07-19').repairs).toEqual([])
  })

  it('repairs only after-completion cache fields and leaves records untouched', () => {
    const task = recurringTask({
      recurrence: {
        mode: 'after_completion',
        intervalValue: 1,
        intervalUnit: 'week',
        overflowPolicy: 'clamp',
      },
      currentSequence: 1,
      nextDueDate: '2026-07-19',
    })
    const record: CompletionRecord = {
      id: 'fixed-1:ac:1',
      taskId: 'fixed-1',
      occurrenceKey: 'ac:1',
      occurrenceDate: '2026-07-19',
      resolution: 'completed',
      resolvedAt: '2026-07-19T10:00:00Z',
      completedDate: '2026-07-19',
      titleSnapshot: '每日回顾',
      templateVersion: 1,
      createdAt: '2026-07-19T10:00:00Z',
      updatedAt: '2026-07-19T10:00:00Z',
    }
    const plan = planTaskPeriodSync([task], [record], 'daily', '2026-07-20')
    expect(plan.repairs[0].changes).toMatchObject({
      currentSequence: 2,
      nextDueDate: '2026-07-26',
    })
    expect(record.resolution).toBe('completed')
  })
})
