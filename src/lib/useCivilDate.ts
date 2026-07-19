import { useEffect, useState } from 'react'
import { todayLocalISO } from './dates'

/**
 * Keeps civil-day projections correct while a PWA stays open across midnight.
 * A visibility/pageshow refresh also covers iOS suspending the timer in the
 * background and resuming on a different local day.
 */
export function useCivilDate(): string {
  const [date, setDate] = useState(todayLocalISO)

  useEffect(() => {
    let timeout = 0
    const scheduleMidnight = () => {
      window.clearTimeout(timeout)
      const now = new Date()
      const next = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0,
        0,
        0,
        80,
      )
      timeout = window.setTimeout(refresh, Math.max(250, next.getTime() - now.getTime()))
    }
    const refresh = () => {
      setDate(todayLocalISO())
      scheduleMidnight()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }

    scheduleMidnight()
    window.addEventListener('pageshow', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(timeout)
      window.removeEventListener('pageshow', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return date
}
