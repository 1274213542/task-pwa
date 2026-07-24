import { Temporal } from 'temporal-polyfill'

/**
 * 民用日期工具（v4.2 §7.5）：任务归属日一律用设备本地的 PlainDate。
 * 严禁 `new Date().toISOString().slice(0,10)`——那是 UTC 日期，
 * 在 UTC+9 的清晨会差一天（真实踩坑：2026-07-16 早晨算出 07-15）。
 */
export const todayLocalISO = (): string => Temporal.Now.plainDateISO().toString()

export const addDaysISO = (iso: string, days: number): string =>
  Temporal.PlainDate.from(iso).add({ days }).toString()

export function localDateISOOf(value?: string): string | undefined {
  if (!value) return undefined
  try {
    return Temporal.Instant.from(value)
      .toZonedDateTimeISO(Temporal.Now.timeZoneId())
      .toPlainDate()
      .toString()
  } catch {
    try {
      return Temporal.PlainDate.from(value.slice(0, 10)).toString()
    } catch {
      return undefined
    }
  }
}
