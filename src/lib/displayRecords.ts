type DisplayRecord = {
  id?: string
  title?: unknown
  parentTaskId?: string
}

const warnedRecords = new Set<string>()

export function hasDisplayTitle(record: DisplayRecord): boolean {
  return typeof record.title === 'string' && record.title.trim().length > 0
}

export function isRenderableRecord(
  record: DisplayRecord,
  source: string,
  type: 'task' | 'event' | 'parent-task' = 'task',
): boolean {
  if (hasDisplayTitle(record)) return true

  if (import.meta.env.DEV) {
    const key = `${source}:${type}:${record.id ?? '#missing-id'}`
    if (!warnedRecords.has(key)) {
      warnedRecords.add(key)
      console.warn('[task-display] Skipped record without display content', {
        id: record.id ?? null,
        type,
        title: record.title ?? null,
        parentId: record.parentTaskId ?? null,
        source,
      })
    }
  }
  return false
}

export function renderableTitle(record: DisplayRecord, fallback: string): string {
  return hasDisplayTitle(record) ? String(record.title).trim() : fallback
}
