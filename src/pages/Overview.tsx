import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Temporal } from 'temporal-polyfill'
import { db, type ColorToken } from '../lib/db'
import { buildCalendarItems, type CalItem } from '../lib/calendar'
import { todayLocalISO } from '../lib/dates'
import MobilePageHeader from '../components/MobilePageHeader'
import PageHeader from '../components/PageHeader'
import AppIcon from '../components/AppIcon'
import MarkerIcon from '../components/MarkerIcon'

function labelDate(dateISO: string, options: Intl.DateTimeFormatOptions) {
  return new Date(`${dateISO}T00:00:00`).toLocaleDateString('zh-CN', options)
}

function itemTitle(item: CalItem) {
  return item.kind === 'event' ? item.event.title : item.task.title
}

function itemColor(item: CalItem): ColorToken {
  const source = item.kind === 'event' ? item.event : item.task
  return source.visualToken ?? (item.kind === 'event' ? 'green' : 'purple')
}

export default function Overview() {
  const today = todayLocalISO()
  const snapshot = useLiveQuery(async () => {
    const [tasks, records, events, shopping] = await Promise.all([
      db.tasks.where('lifecycleStatus').equals('active').sortBy('rank'),
      db.completionRecords.toArray(),
      db.calendarEvents.where('lifecycleStatus').equals('active').toArray(),
      db.shoppingItems
        .where('purchaseStatus')
        .equals('pending')
        .filter((item) => item.lifecycleStatus === 'active')
        .toArray(),
    ])
    return { tasks, records, events, shopping }
  }, [])

  const view = useMemo(() => {
    if (!snapshot) return undefined
    const start = Temporal.PlainDate.from(today)
    const end = start.add({ days: 13 })
    const byDay = buildCalendarItems(
      snapshot.tasks,
      snapshot.records,
      snapshot.events,
      start.toString(),
      end.toString(),
    )
    const weekStart = start.subtract({ days: start.dayOfWeek - 1 })
    const weekDates = Array.from({ length: 7 }, (_, index) =>
      weekStart.add({ days: index }).toString(),
    )
    const nextSeven = Array.from({ length: 7 }, (_, index) => start.add({ days: index }).toString())
    const todayItems = byDay.get(today) ?? []
    const weekCount = weekDates.reduce((sum, date) => sum + (byDay.get(date)?.length ?? 0), 0)
    const upcoming = nextSeven
      .flatMap((date) => (byDay.get(date) ?? []).map((item) => ({ date, item })))
      .filter(({ item }) => item.kind === 'event' || (!item.completed && !item.skipped))
      .slice(0, 4)
    return {
      byDay,
      nextSeven,
      todayItems,
      weekCount,
      upcoming,
      fixed: snapshot.tasks.filter((task) => Boolean(task.recurrence)),
    }
  }, [snapshot, today])

  const todayLabel = labelDate(today, { month: 'long', day: 'numeric', weekday: 'long' })
  const completedToday = view?.todayItems.filter(
    (item) => item.kind === 'task' && item.completed,
  ).length ?? 0
  const todayTotal = view?.todayItems.length ?? 0

  return (
    <section className="app-page page-overview">
      <MobilePageHeader title="总览" eyebrow={todayLabel} />
      <PageHeader
        title="总览"
        eyebrow={todayLabel}
        actions={(
          <Link to="/settings" className="overview-settings" aria-label="设置">
            <AppIcon name="settings" size={20} />
          </Link>
        )}
      />

      <section className="overview-hero" aria-labelledby="overview-today-title">
        <div>
          <p>今天</p>
          <h2 id="overview-today-title">
            {todayTotal === 0 ? '保持轻盈的一天' : `${todayTotal - completedToday} 项待处理`}
          </h2>
          <span>{completedToday > 0 ? `已完成 ${completedToday} 项` : '先从最重要的一项开始'}</span>
        </div>
        <div className="overview-hero-progress" aria-label={`今天已完成 ${completedToday} 项，共 ${todayTotal} 项`}>
          <strong>{todayTotal ? Math.round((completedToday / todayTotal) * 100) : 0}</strong>
          <small>%</small>
        </div>
      </section>

      <div className="overview-metrics">
        <Link to="/plan" className="overview-metric overview-metric-week">
          <AppIcon name="calendar" size={21} />
          <span>本周计划</span>
          <strong>{view?.weekCount ?? 0}</strong>
        </Link>
        <Link to="/shopping" className="overview-metric overview-metric-shopping">
          <AppIcon name="shopping" size={21} />
          <span>待购清单</span>
          <strong>{snapshot?.shopping.length ?? 0}</strong>
        </Link>
        <Link to="/today" className="overview-metric overview-metric-fixed">
          <AppIcon name="sync" size={20} />
          <span>固定任务</span>
          <strong>{view?.fixed.length ?? 0}</strong>
        </Link>
      </div>

      <section className="overview-calendar-strip" aria-labelledby="overview-calendar-title">
        <header>
          <div>
            <p>接下来</p>
            <h2 id="overview-calendar-title">七天概览</h2>
          </div>
          <Link to="/plan">查看日历 <AppIcon name="chevronRight" size={16} /></Link>
        </header>
        <div className="overview-days">
          {(view?.nextSeven ?? []).map((date) => {
            const items = view?.byDay.get(date) ?? []
            return (
              <Link key={date} to="/plan" data-has-items={items.length > 0 || undefined} data-today={date === today || undefined}>
                <span>{labelDate(date, { weekday: 'narrow' })}</span>
                <strong>{Number(date.slice(8))}</strong>
                <i aria-hidden />
              </Link>
            )
          })}
        </div>
      </section>

      <section className="overview-upcoming" aria-labelledby="overview-upcoming-title">
        <header>
          <div>
            <p>近期</p>
            <h2 id="overview-upcoming-title">下一步</h2>
          </div>
          <Link to="/today">全部任务</Link>
        </header>
        {(view?.upcoming.length ?? 0) > 0 ? (
          <ul>
            {view!.upcoming.map(({ date, item }, index) => (
              <li key={`${date}:${item.kind}:${index}`} data-color-token={itemColor(item)}>
                <span className="overview-upcoming-marker">
                  <MarkerIcon symbol={item.kind === 'event' ? 'diamond' : 'dot'} color={itemColor(item)} size={18} />
                </span>
                <div>
                  <strong>{itemTitle(item)}</strong>
                  <small>{date === today ? '今天' : labelDate(date, { month: 'numeric', day: 'numeric', weekday: 'short' })}</small>
                </div>
                <AppIcon name="chevronRight" size={16} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="overview-empty">未来七天没有待办安排</div>
        )}
      </section>

      <div className="overview-utility-links">
        <Link to="/browse"><AppIcon name="category" size={18} /> 分类与完成记录</Link>
        <Link to="/settings"><AppIcon name="settings" size={18} /> 数据与偏好</Link>
      </div>
    </section>
  )
}
