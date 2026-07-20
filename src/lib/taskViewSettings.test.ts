import { describe, expect, it } from 'vitest'
import { Temporal } from 'temporal-polyfill'
import { todayLocalISO } from './dates'
import {
  DEFAULT_TASK_VIEW_SETTINGS,
  activeTaskViewSettingCount,
  applyTaskViewSettings,
  parseTaskViewSettings,
  type TaskViewCandidate,
} from './taskViewSettings'

const item = (
  id: string,
  completed: boolean,
  recurring: boolean,
  createdAt: string,
  updatedAt: string,
): TaskViewCandidate & { id: string } => ({
  id,
  completed,
  task: {
    id,
    createdAt,
    updatedAt,
    ...(recurring && {
      recurrence: {
        mode: 'fixed_schedule',
        frequency: 'daily',
        interval: 1,
        overflowPolicy: 'clamp',
      } as const,
    }),
  },
})

const rows = [
  item('a', false, false, '2026-07-01', '2026-07-02'),
  item('b', true, true, '2026-07-03', '2026-07-04'),
  item('c', false, true, '2026-07-02', '2026-07-05'),
]

describe('task view settings', () => {
  it('keeps manual order and combines status/property filters', () => {
    const result = applyTaskViewSettings(rows, {
      ...DEFAULT_TASK_VIEW_SETTINGS,
      status: 'pending',
      property: 'recurring',
    })
    expect(result.map((row) => row.id)).toEqual(['c'])
  })

  it('sorts by recent update without mutating the source order', () => {
    const result = applyTaskViewSettings(rows, {
      ...DEFAULT_TASK_VIEW_SETTINGS,
      sort: 'updated',
    })
    expect(result.map((row) => row.id)).toEqual(['c', 'a', 'b'])
    expect(rows.map((row) => row.id)).toEqual(['a', 'b', 'c'])
  })

  it('stably moves completed rows below pending rows without rewriting manual order', () => {
    const result = applyTaskViewSettings([
      item('completed-first', true, false, '2026-07-01', '2026-07-01'),
      item('pending-first', false, false, '2026-07-02', '2026-07-02'),
      item('completed-second', true, false, '2026-07-03', '2026-07-03'),
      item('pending-second', false, false, '2026-07-04', '2026-07-04'),
    ], {
      ...DEFAULT_TASK_VIEW_SETTINGS,
      sort: 'manual',
    })

    expect(result.map((row) => row.id)).toEqual([
      'pending-first',
      'pending-second',
      'completed-first',
      'completed-second',
    ])
  })

  it('completed-only remains useful even when completed rows are globally hidden', () => {
    const result = applyTaskViewSettings(rows, {
      ...DEFAULT_TASK_VIEW_SETTINGS,
      status: 'completed',
      showCompleted: false,
    })
    expect(result.map((row) => row.id)).toEqual(['b'])
  })

  it('filters a child by its inherited parent schedule', () => {
    const inheritedRows: Array<TaskViewCandidate & { id: string }> = [
      {
        id: 'parent',
        completed: false,
        task: {
          id: 'parent',
          createdAt: '2026-07-01',
          updatedAt: '2026-07-01',
          scheduleType: 'longTerm',
          startAt: '2026-07-20',
          dueAt: '2026-07-31',
        },
      },
      {
        id: 'child',
        completed: false,
        task: {
          id: 'child',
          createdAt: '2026-07-01',
          updatedAt: '2026-07-01',
          parentTaskId: 'parent',
          inheritsParentSchedule: true,
        },
      },
    ]
    const result = applyTaskViewSettings(inheritedRows, {
      ...DEFAULT_TASK_VIEW_SETTINGS,
      schedule: 'longTerm',
    })
    expect(result.map((row) => row.id)).toEqual(['parent', 'child'])
  })

  it('keeps manual order but sorts smart mode by overdue and nearest DDL', () => {
    const today = Temporal.PlainDate.from(todayLocalISO())
    const scheduled: Array<TaskViewCandidate & { id: string }> = [
      ['manual-first', undefined],
      ['tomorrow', today.add({ days: 1 }).toString()],
      ['overdue', today.subtract({ days: 2 }).toString()],
      ['today', today.toString()],
      ['later', today.add({ days: 30 }).toString()],
    ].map(([id, dueAt]) => ({
      id: id!,
      completed: false,
      task: {
        id: id!,
        createdAt: '2026-07-01',
        updatedAt: '2026-07-01',
        scheduleType: dueAt ? 'longTerm' : 'unscheduled',
        ...(dueAt && { startAt: today.subtract({ days: 20 }).toString(), dueAt }),
      },
    }))
    expect(applyTaskViewSettings(scheduled, {
      ...DEFAULT_TASK_VIEW_SETTINGS,
      sort: 'smart',
    }).map((row) => row.id)).toEqual(['overdue', 'today', 'tomorrow', 'manual-first', 'later'])
    expect(applyTaskViewSettings(scheduled, {
      ...DEFAULT_TASK_VIEW_SETTINGS,
      sort: 'manual',
    }).map((row) => row.id)).toEqual(scheduled.map((row) => row.id))
  })

  it('recovers safely from invalid persisted settings and counts active changes', () => {
    expect(parseTaskViewSettings('{broken')).toEqual(DEFAULT_TASK_VIEW_SETTINGS)
    expect(activeTaskViewSettingCount({
      ...DEFAULT_TASK_VIEW_SETTINGS,
      property: 'recurring',
      density: 'compact',
    })).toBe(2)
  })
})
