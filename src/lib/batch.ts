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

/** 带原始行号的批量解析，供 UI 精确指出失败项。 */
export function parseBatchEntries(value: string): { line: number; value: string }[] {
  return value
    .split(/\r?\n/)
    .map((raw, index) => ({ line: index + 1, value: raw.trim() }))
    .filter((entry) => entry.value.length > 0)
}
