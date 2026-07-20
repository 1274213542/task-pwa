import type { ColorToken, DateTypeDefinition, DateTypeMarker } from './db'

export interface CalendarMarkerToken {
  id: string
  label: string
  colorToken: ColorToken
}

export interface CalendarMarkerSummary {
  tokens: CalendarMarkerToken[]
  visible: CalendarMarkerToken[]
  overflowCount: number
  ariaLabel: string
}

/**
 * One deterministic projection is shared by the month grid and Overview.
 * Date-type markers keep their configured rank; ordinary calendar content is
 * represented once by a neutral token instead of competing for the same pixel.
 */
export function calendarMarkerSummary(input: {
  date: string
  definitions: DateTypeDefinition[]
  markers: DateTypeMarker[]
  hasCalendarItems?: boolean
  maxVisible?: number
}): CalendarMarkerSummary {
  const activeTypeIds = new Set(input.markers
    .filter((marker) => marker.date === input.date && marker.lifecycleStatus === 'active')
    .map((marker) => marker.typeId))
  const tokens = input.definitions
    .filter((definition) => activeTypeIds.has(definition.id))
    .map((definition) => ({
      id: definition.id,
      label: definition.name,
      colorToken: definition.colorToken,
    }))

  if (input.hasCalendarItems) {
    tokens.push({ id: 'calendar-items', label: '其他安排', colorToken: 'gray' })
  }

  const maxVisible = Math.max(1, input.maxVisible ?? 3)
  const visible = tokens.slice(0, maxVisible)
  const overflowCount = Math.max(0, tokens.length - visible.length)
  return {
    tokens,
    visible,
    overflowCount,
    ariaLabel: tokens.length > 0 ? tokens.map((token) => token.label).join('、') : '无安排',
  }
}
