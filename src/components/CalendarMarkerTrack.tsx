import type { CalendarMarkerSummary } from '../lib/calendarMarkers'

export default function CalendarMarkerTrack({
  summary,
  className = '',
}: {
  summary: CalendarMarkerSummary
  className?: string
}) {
  if (summary.tokens.length === 0) return null
  return (
    <span
      className={`calendar-marker-track ${className}`.trim()}
      aria-label={summary.ariaLabel}
    >
      {summary.visible.map((token) => (
        <i key={token.id} data-color-token={token.colorToken} title={token.label} />
      ))}
      {summary.overflowCount > 0 && <b aria-label={`另有 ${summary.overflowCount} 类`}>+{summary.overflowCount}</b>}
    </span>
  )
}
