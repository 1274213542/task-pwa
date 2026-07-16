import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { monthGrid } from '../lib/calendar'
import { todayLocalISO } from '../lib/dates'
import MarkerIcon from './MarkerIcon'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

export default function DesktopSidebarExtras() {
  const today = todayLocalISO()
  const cursor = useMemo(() => new Date(`${today}T00:00:00`), [today])
  const days = useMemo(
    () => monthGrid(cursor.getFullYear(), cursor.getMonth() + 1, 1),
    [cursor],
  )
  const categories = useLiveQuery(
    () => db.categories.where('lifecycleStatus').equals('active').sortBy('rank'),
    [],
  )
  const tasks = useLiveQuery(
    () => db.tasks.where('lifecycleStatus').equals('active').toArray(),
    [],
  )

  const counts = useMemo(() => {
    const next = new Map<string, number>()
    for (const task of tasks ?? []) {
      if (task.categoryId) next.set(task.categoryId, (next.get(task.categoryId) ?? 0) + 1)
    }
    return next
  }, [tasks])
  const fallbackFilters = useMemo(() => [
    {
      label: '固定任务',
      count: (tasks ?? []).filter((task) => Boolean(task.recurrence)).length,
      symbol: 'spark' as const,
      color: 'green' as const,
    },
    {
      label: '普通任务',
      count: (tasks ?? []).filter((task) => !task.recurrence).length,
      symbol: 'dot' as const,
      color: 'purple' as const,
    },
  ], [tasks])

  return (
    <div className="desktop-sidebar-extras hidden lg:grid">
      <section className="sidebar-mini-calendar" aria-label="本月迷你日历">
        <header>
          <strong>{cursor.getFullYear()} 年 {cursor.getMonth() + 1} 月</strong>
          <Link to="/plan">打开日历</Link>
        </header>
        <div className="sidebar-mini-weekdays" aria-hidden>
          {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="sidebar-mini-grid">
          {days.map((date) => (
            <span
              key={date}
              data-today={date === today || undefined}
              data-outside={date.slice(0, 7) !== today.slice(0, 7) || undefined}
            >
              {Number(date.slice(8))}
            </span>
          ))}
        </div>
      </section>

      <section className="sidebar-categories" aria-label="任务分类">
        <header>
          <strong>分类</strong>
          <Link to="/browse">管理</Link>
        </header>
        <ul>
          {(categories ?? []).slice(0, 4).map((category) => (
            <li key={category.id}>
              <MarkerIcon
                symbol={category.markerSymbol ?? 'dot'}
                color={category.colorToken}
                size={16}
              />
              <span>{category.name}</span>
              <small>{counts.get(category.id) ?? 0}</small>
            </li>
          ))}
          {(categories?.length ?? 0) === 0 && fallbackFilters.map((filter) => (
            <li key={filter.label}>
              <MarkerIcon symbol={filter.symbol} color={filter.color} size={16} />
              <span>{filter.label}</span>
              <small>{filter.count}</small>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
