import { db } from './db'
import { Temporal } from 'temporal-polyfill'

const now = () => new Date().toISOString()

/** 新建日历事项（v4.2 §8.1：单日 endDate = startDate；定时事项记录时区） */
export async function addEvent(opts: {
  title: string
  date: string // PlainDate
  endDate?: string // 跨日事项
  time?: string // "HH:MM"，给定则为定时事项
  notes?: string
  categoryId?: string
}): Promise<void> {
  const title = opts.title.trim()
  if (!title) return
  const t = now()
  const allDay = !opts.time
  const timezone = Temporal.Now.timeZoneId()
  let startAt: string | undefined
  if (opts.time) {
    startAt = Temporal.PlainDateTime.from(`${opts.date}T${opts.time}`)
      .toZonedDateTime(timezone)
      .toInstant()
      .toString()
  }
  await db.calendarEvents.add({
    id: crypto.randomUUID(),
    title,
    ...(opts.notes?.trim() && { notes: opts.notes.trim() }),
    allDay,
    startDate: opts.date,
    endDate: opts.endDate && opts.endDate > opts.date ? opts.endDate : opts.date,
    ...(startAt && { startAt, timezone }),
    ...(opts.categoryId && { categoryId: opts.categoryId }),
    lifecycleStatus: 'active',
    createdAt: t,
    updatedAt: t,
  })
}

export async function renameEvent(id: string, title: string): Promise<void> {
  const trimmed = title.trim()
  if (!trimmed) return
  await db.calendarEvents.update(id, { title: trimmed, updatedAt: now() })
}

export async function softDeleteEvent(id: string): Promise<void> {
  await db.calendarEvents.update(id, {
    lifecycleStatus: 'deleted',
    deletedAt: now(),
    updatedAt: now(),
  })
}
