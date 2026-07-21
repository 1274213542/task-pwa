import { describe, expect, it } from 'vitest'
import type { Task } from './db'
import { effectiveRecurrence, isLongTermTaskDefinition, isTodayTaskDefinition, taskViewFromStorage } from './taskViews'

function task(id: string, fields: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    rank: id,
    lifecycleStatus: 'active',
    templateVersion: 1,
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    ...fields,
  }
}

describe('今日任务 / 长期任务 projection', () => {
  const today = '2026-07-21'

  it('keeps recurring templates long-term and only surfaces a matching occurrence today', () => {
    const weekly = task('weekly', {
      startDate: today,
      scheduleType: 'today',
      recurrence: {
        mode: 'fixed_schedule',
        frequency: 'weekly',
        interval: 1,
        weekdays: [2],
        overflowPolicy: 'clamp',
      },
    })
    expect(isLongTermTaskDefinition(weekly, today, [weekly])).toBe(true)
    expect(isTodayTaskDefinition(weekly, today, [weekly])).toBe(true)
  })

  it('surfaces a non-recurring long-term task on its deadline day', () => {
    const deadline = task('deadline', {
      scheduleType: 'longTerm',
      startAt: '2026-07-01',
      dueAt: today,
    })
    expect(isLongTermTaskDefinition(deadline, today, [deadline])).toBe(true)
    expect(isTodayTaskDefinition(deadline, today, [deadline])).toBe(true)
  })

  it('maps legacy weekly rows and stored tab values without rewriting data', () => {
    const legacy = task('legacy-weekly', { taskScope: 'weekly', startDate: today })
    expect(effectiveRecurrence(legacy)?.mode).toBe('fixed_schedule')
    expect(taskViewFromStorage('weekly')).toBe('longTerm')
  })
})
