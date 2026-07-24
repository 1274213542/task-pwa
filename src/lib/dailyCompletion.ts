export interface DailyCompletionCandidate {
  completed: boolean
  skipped?: boolean
}

export function dailyCompletionRate(items: DailyCompletionCandidate[]) {
  const eligible = items.filter((item) => !item.skipped)
  const completed = eligible.filter((item) => item.completed).length
  const total = eligible.length
  return {
    completed,
    total,
    percentage: total === 0 ? undefined : Math.round((completed / total) * 100),
  }
}

export function isPreviousDayCompletion(
  completed: boolean,
  completionDate: string | undefined,
  today: string,
) {
  return completed && Boolean(completionDate && completionDate < today)
}
