import type { CompletionRecord } from './db'
import { localDateISOOf } from './dates'

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

/**
 * Completion belongs to the local civil day on which the user resolved it.
 * `occurrenceDate` is only the scheduled/source date and must not be used as a
 * fallback before `resolvedAt`, otherwise an overdue task completed today is
 * incorrectly treated as a historical completion.
 */
export function completionCivilDate(record: CompletionRecord): string | undefined {
  return record.completedDate ?? localDateISOOf(record.resolvedAt) ?? record.occurrenceDate
}

/**
 * Compatibility projection for ordinary one-time tasks.
 *
 * Older releases migrated `single` rows into `daily:YYYY-MM-DD` rows. Reading
 * both key shapes here keeps those real completion dates intact without
 * rewriting history or allowing an old completion to leak into today's list.
 */
export function latestOneTimeCompletion(
  records: CompletionRecord[],
  taskId: string,
): CompletionRecord | undefined {
  return records
    .filter((record) =>
      record.taskId === taskId &&
      record.resolution === 'completed' &&
      (record.occurrenceKey === 'single' || record.occurrenceKey.startsWith('daily:')),
    )
    .sort((a, b) => {
      const byDate = (completionCivilDate(b) ?? '').localeCompare(completionCivilDate(a) ?? '')
      return byDate || b.resolvedAt.localeCompare(a.resolvedAt)
    })[0]
}
