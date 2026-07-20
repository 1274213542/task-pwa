export function formatDurationMinutes(totalMinutes: number): string {
  const safeMinutes = Math.max(0, Math.round(Number.isFinite(totalMinutes) ? totalMinutes : 0))
  const hours = Math.floor(safeMinutes / 60)
  const minutes = safeMinutes % 60
  if (safeMinutes === 0) return '0 小时'
  if (hours === 0) return `${minutes} 分钟`
  if (minutes === 0) return `${hours} 小时`
  return `${hours}小时${minutes}分`
}
