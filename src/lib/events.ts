import { db, type ColorToken, type MarkerSymbol } from './db'
import { Temporal } from 'temporal-polyfill'

const now = () => new Date().toISOString()

/** 新建日历事项（v4.2 §8.1：单日 endDate = startDate；定时事项记录时区） */
export async function addEvent(opts: {
  title: string
  date: string // PlainDate
  endDate?: string // 跨日事项
  time?: string // "HH:MM"，给定则为定时事项
  endTime?: string
  notes?: string
  categoryId?: string
}): Promise<void> {
  const title = opts.title.trim()
  if (!title) return
  const t = now()
  const allDay = !opts.time
  const timezone = Temporal.Now.timeZoneId()
  let startAt: string | undefined
  let endAt: string | undefined
  if (opts.time) {
    startAt = Temporal.PlainDateTime.from(`${opts.date}T${opts.time}`)
      .toZonedDateTime(timezone)
      .toInstant()
      .toString()
    if (opts.endTime) {
      const endDate = opts.endDate && opts.endDate >= opts.date ? opts.endDate : opts.date
      endAt = Temporal.PlainDateTime.from(`${endDate}T${opts.endTime}`)
        .toZonedDateTime(timezone)
        .toInstant()
        .toString()
    }
  }
  await db.calendarEvents.add({
    id: crypto.randomUUID(),
    title,
    ...(opts.notes?.trim() && { notes: opts.notes.trim() }),
    allDay,
    startDate: opts.date,
    endDate: opts.endDate && opts.endDate > opts.date ? opts.endDate : opts.date,
    ...(startAt && { startAt, timezone }),
    ...(endAt && { endAt }),
    ...(opts.categoryId && { categoryId: opts.categoryId }),
    completionStatus: 'pending',
    lifecycleStatus: 'active',
    createdAt: t,
    updatedAt: t,
  })
}

export async function toggleEventCompletion(event: { id: string; completionStatus?: 'pending' | 'completed' }): Promise<void> {
  const completed = event.completionStatus === 'completed'
  await db.calendarEvents.update(event.id, {
    completionStatus: completed ? 'pending' : 'completed',
    completedAt: completed ? undefined : now(),
    updatedAt: now(),
  })
}

export async function renameEvent(id: string, title: string): Promise<void> {
  const trimmed = title.trim()
  if (!trimmed) return
  await db.calendarEvents.update(id, { title: trimmed, updatedAt: now() })
}

/** 编辑原事项：只更新原 ID，不复制记录；全天/定时切换时清理旧时间字段。 */
export async function updateEvent(
  id: string,
  opts: {
    title: string
    notes?: string
    date: string
    endDate?: string
    time?: string
    endTime?: string
    categoryId?: string
    visualToken?: ColorToken
    markerSymbol?: MarkerSymbol
    timezone?: string
  },
): Promise<void> {
  const title = opts.title.trim()
  if (!title) throw new Error('标题不能为空')
  const timezone = opts.timezone || Temporal.Now.timeZoneId()
  const time = opts.time?.trim()
  const startAt = time
    ? Temporal.PlainDateTime.from(`${opts.date}T${time}`)
        .toZonedDateTime(timezone)
        .toInstant()
        .toString()
    : undefined
  const endTime = opts.endTime?.trim()
  const effectiveEndDate = opts.endDate && opts.endDate >= opts.date ? opts.endDate : opts.date
  const endAt = time && endTime
    ? Temporal.PlainDateTime.from(`${effectiveEndDate}T${endTime}`)
        .toZonedDateTime(timezone)
        .toInstant()
        .toString()
    : undefined
  await db.calendarEvents.update(id, {
    title,
    notes: opts.notes?.trim() || undefined,
    allDay: !time,
    startDate: opts.date,
    endDate: effectiveEndDate,
    startAt,
    endAt,
    timezone: time ? timezone : undefined,
    categoryId: opts.categoryId || undefined,
    visualToken: opts.visualToken,
    markerSymbol: opts.markerSymbol,
    updatedAt: now(),
  })
}

export async function softDeleteEvent(id: string): Promise<void> {
  await db.calendarEvents.update(id, {
    lifecycleStatus: 'deleted',
    deletedAt: now(),
    updatedAt: now(),
  })
}
