/** 将多行输入转成有序条目：保留重复项，只忽略空白行。 */
export function parseBatchLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}
