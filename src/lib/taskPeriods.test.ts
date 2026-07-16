import { describe, expect, it } from 'vitest'
import {
  defaultFixedRecurrence,
  periodOccurrenceKey,
  taskScopeOf,
  weekEndISO,
  weekStartISO,
} from './taskPeriods'

describe('每日 / 每周固定任务周期边界', () => {
  it('v6 旧任务缺少作用域时兼容为每日，已有新字段不被覆盖', () => {
    expect(taskScopeOf({ taskScope: undefined })).toBe('daily')
    expect(taskScopeOf({ taskScope: 'weekly' })).toBe('weekly')
  })

  it('每日任务每天得到不同的确定性完成键', () => {
    expect(periodOccurrenceKey('daily', '2026-07-16')).toBe('fixed:2026-07-16')
    expect(periodOccurrenceKey('daily', '2026-07-17')).toBe('fixed:2026-07-17')
  })

  it('同一周任意一天共享周一完成键，下周一自动切换', () => {
    expect(weekStartISO('2026-07-16')).toBe('2026-07-13')
    expect(weekEndISO('2026-07-16')).toBe('2026-07-19')
    expect(periodOccurrenceKey('weekly', '2026-07-13')).toBe('fixed:2026-07-13')
    expect(periodOccurrenceKey('weekly', '2026-07-19')).toBe('fixed:2026-07-13')
    expect(periodOccurrenceKey('weekly', '2026-07-20')).toBe('fixed:2026-07-20')
  })

  it('默认固定模板分别是每天与周一', () => {
    expect(defaultFixedRecurrence('daily').frequency).toBe('daily')
    expect(defaultFixedRecurrence('weekly')).toMatchObject({
      frequency: 'weekly',
      weekdays: [1],
    })
  })
})
