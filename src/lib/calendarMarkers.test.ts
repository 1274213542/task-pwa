import { describe, expect, it } from 'vitest'
import type { DateTypeDefinition, DateTypeMarker } from './db'
import { calendarMarkerSummary } from './calendarMarkers'

const definitions: DateTypeDefinition[] = [
  { id: 'work', name: '上班', colorToken: 'blue', rank: 'a', lifecycleStatus: 'active', createdAt: '', updatedAt: '' },
  { id: 'school', name: '上学', colorToken: 'green', rank: 'b', lifecycleStatus: 'active', createdAt: '', updatedAt: '' },
  { id: 'other', name: '其他', colorToken: 'purple', rank: 'c', lifecycleStatus: 'active', createdAt: '', updatedAt: '' },
  { id: 'travel', name: '旅行', colorToken: 'orange', rank: 'd', lifecycleStatus: 'active', createdAt: '', updatedAt: '' },
]

const marker = (typeId: string): DateTypeMarker => ({
  id: `2026-07-21:${typeId}`,
  date: '2026-07-21',
  typeId,
  lifecycleStatus: 'active',
  createdAt: '',
  updatedAt: '',
})
describe('calendar marker projection', () => {
  it('keeps configured order, centers up to three dots and reports overflow', () => {
    const summary = calendarMarkerSummary({
      date: '2026-07-21',
      definitions,
      markers: [marker('other'), marker('work'), marker('travel'), marker('school')],
      hasCalendarItems: true,
    })
    expect(summary.tokens.map((item) => item.label)).toEqual(['上班', '上学', '其他', '旅行', '其他安排'])
    expect(summary.visible.map((item) => item.label)).toEqual(['上班', '上学', '其他'])
    expect(summary.overflowCount).toBe(2)
  })

  it('deduplicates repeated offline writes by type id', () => {
    const summary = calendarMarkerSummary({
      date: '2026-07-21',
      definitions,
      markers: [marker('work'), marker('work')],
    })
    expect(summary.tokens).toHaveLength(1)
  })
})
