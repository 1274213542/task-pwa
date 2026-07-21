/** 将多行输入转成有序条目：保留重复项，只忽略空白行。 */
export function parseBatchLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

export interface BatchFailure {
  line: number
  value: string
  reason: string
}

export interface BatchCreateResult {
  created: number
  failures: BatchFailure[]
}

export interface TimedBatchEntry {
  line: number
  value: string
  title: string
  /** Device-local wall-clock time, never an Instant. */
  time?: string
  error?: string
}

/**
 * Parse an optional leading local time without making time mandatory.
 * Supported examples: `8.00 起床`, `08:30 出门`, `9：00 公交`.
 * A time-looking but invalid prefix is reported instead of silently becoming
 * part of the title, so one bad line cannot create a surprising task.
 */
export function parseTimedBatchEntries(value: string): TimedBatchEntry[] {
  return value
    .split(/\r?\n/)
    .map((raw, index) => ({ line: index + 1, value: raw.trim() }))
    .filter((entry) => entry.value.length > 0)
    .map((entry) => {
      const matched = entry.value.match(/^(\d{1,2})[.:：．](\d{2})\s*(.*)$/)
      if (!matched) return { ...entry, title: entry.value }
      const hour = Number(matched[1])
      const minute = Number(matched[2])
      const title = matched[3].trim()
      if (hour > 23 || minute > 59) {
        return { ...entry, title, error: '时间格式无效' }
      }
      if (!title) return { ...entry, title, error: '时间后缺少任务名称' }
      return {
        ...entry,
        title,
        time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      }
    })
}

/** 带原始行号的批量解析，供 UI 精确指出失败项。 */
export function parseBatchEntries(value: string): { line: number; value: string }[] {
  return value
    .split(/\r?\n/)
    .map((raw, index) => ({ line: index + 1, value: raw.trim() }))
    .filter((entry) => entry.value.length > 0)
}
