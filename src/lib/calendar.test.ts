import { describe, expect, it } from 'vitest'
import type { CalendarEvent, Task } from './db'
import { buildCalendarItems, monthGrid } from './calendar'

describe('monthGrid（MS5 验收：真实日期/星期/月长/闰年）', () => {
  it('2028 年 2 月（闰年）：含 2/29，共 29 天', () => {
    const grid = monthGrid(2028, 2, 1)
    expect(grid).toHaveLength(42)
    expect(grid).toContain('2028-02-29')
    expect(grid.filter((d) => d.startsWith('2028-02'))).toHaveLength(29)
  })
  it('2026 年 2 月（平年）：28 天，无 2/29', () => {
    const grid = monthGrid(2026, 2, 1)
    expect(grid).not.toContain('2026-02-29')
    expect(grid.filter((d) => d.startsWith('2026-02'))).toHaveLength(28)
  })
  it('周一起始：2026-07 的首格是 6/29（周一）', () => {
    const grid = monthGrid(2026, 7, 1)
    expect(grid[0]).toBe('2026-06-29')
    expect(grid[2]).toBe('2026-07-01') // 7/1 是周三，第三格
  })
  it('周日起始', () => {
    const grid = monthGrid(2026, 7, 0)
    expect(grid[0]).toBe('2026-06-28') // 周日
  })
  it('跨年月：2026-01 前导来自 2025-12', () => {
    const grid = monthGrid(2026, 1, 1)
    expect(grid[0]).toBe('2025-12-29')
  })
})

const baseTask = (over: Partial<Task>): Task => ({
  id: 't1',
  title: 'x',
  rank: 'r',
  lifecycleStatus: 'active',
  templateVersion: 1,
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-01T00:00:00Z',
  ...over,
})

describe('buildCalendarItems（统一投影，任务不复制存储）', () => {
  it('does not project organizational plans as calendar tasks', () => {
    const plan = baseTask({ id: 'plan', nodeRole: 'plan', scheduleType: 'longTerm', startAt: '2026-07-10' })
    expect(buildCalendarItems([plan], [], [], '2026-07-01', '2026-07-31').size).toBe(0)
  })

  it('三类同屏：普通任务、周期实例、日程', () => {
    const tasks = [
      baseTask({ id: 'a', startDate: '2026-07-10' }),
      baseTask({
        id: 'b',
        startDate: '2026-07-01',
        recurrence: {
          mode: 'fixed_schedule',
          frequency: 'weekly',
          interval: 1,
          weekdays: [1],
          overflowPolicy: 'clamp',
        },
      }),
      baseTask({
        id: 'c',
        recurrence: {
          mode: 'after_completion',
          intervalValue: 7,
          intervalUnit: 'day',
          overflowPolicy: 'clamp',
        },
        currentSequence: 1,
        nextDueDate: '2026-07-13',
      }),
    ]
    const events: CalendarEvent[] = [
      {
        id: 'e1',
        title: '答辩',
        allDay: true,
        startDate: '2026-07-13',
        endDate: '2026-07-13',
        lifecycleStatus: 'active',
        createdAt: '',
        updatedAt: '',
      },
    ]
    const byDay = buildCalendarItems(tasks, [], events, '2026-07-01', '2026-07-31')
    expect(byDay.get('2026-07-10')?.map((i) => i.kind)).toEqual(['task'])
    // 7/13 周一：weekly 实例 + ac 到期 + 日程 = 三条
    expect(byDay.get('2026-07-13')).toHaveLength(3)
    // weekly 在 7 月有 4 个周一
    const mondays = ['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27']
    for (const m of mondays) {
      expect(byDay.get(m)?.some((i) => i.kind === 'task' && i.task.id === 'b')).toBe(true)
    }
  })

  it('跨日事项按日切片，且窗口裁剪', () => {
    const events: CalendarEvent[] = [
      {
        id: 'e2',
        title: '旅行',
        allDay: true,
        startDate: '2026-07-30',
        endDate: '2026-08-02',
        lifecycleStatus: 'active',
        createdAt: '',
        updatedAt: '',
      },
    ]
    const byDay = buildCalendarItems([], [], events, '2026-07-01', '2026-07-31')
    expect(byDay.get('2026-07-30')).toHaveLength(1)
    expect(byDay.get('2026-07-31')).toHaveLength(1)
    expect(byDay.get('2026-08-01')).toBeUndefined() // 超窗不生成
  })
})
