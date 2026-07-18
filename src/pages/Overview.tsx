import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Temporal } from 'temporal-polyfill'
import { db, type ColorToken } from '../lib/db'
import { buildCalendarItems, type CalItem } from '../lib/calendar'
import { todayLocalISO } from '../lib/dates'
import MobilePageHeader from '../components/MobilePageHeader'
import PageHeader from '../components/PageHeader'
import AppIcon from '../components/AppIcon'
import { FOCUS_QUICK_ADD_EVENT } from '../lib/appEvents'
import {
  completeFixedOccurrence,
  completeTask,
  resolveAfterCompletion,
  undoAfterCompletion,
  voidRecord,
} from '../lib/tasks'
import { toggleEventCompletion } from '../lib/events'

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

function itemCompleted(item: CalItem) {
  return item.kind === 'event' ? item.completed : item.completed
}

function compactMoney(value: number) {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    notation: value >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: 0,
  }).format(value)
}

export default function Overview() {
  const navigate = useNavigate()
  const today = todayLocalISO()
  const [feedback, setFeedback] = useState('')
  const snapshot = useLiveQuery(async () => {
    const [tasks, records, events, shopping, workRecords, expenseRecords, prefs] = await Promise.all([
      db.tasks.where('lifecycleStatus').equals('active').sortBy('rank'),
      db.completionRecords.toArray(),
      db.calendarEvents.where('lifecycleStatus').equals('active').toArray(),
      db.shoppingItems
        .where('purchaseStatus')
        .equals('pending')
        .filter((item) => item.lifecycleStatus === 'active')
        .toArray(),
      db.workRecords.where('lifecycleStatus').equals('active').toArray(),
      db.expenseRecords.where('lifecycleStatus').equals('active').toArray(),
      db.syncedPreferences.get('#prefs'),
    ])
    return { tasks, records, events, shopping, workRecords, expenseRecords, prefs }
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
    const nextSeven = Array.from({ length: 7 }, (_, index) => start.add({ days: index }).toString())
    const todayItems = byDay.get(today) ?? []
    const upcoming = nextSeven
      .flatMap((date) => (byDay.get(date) ?? []).map((item) => ({ date, item })))
      .filter(({ item }) => !itemCompleted(item) && (item.kind === 'event' || !item.skipped))
      .slice(0, 4)
    return {
      byDay,
      nextSeven,
      todayItems,
      upcoming,
      fixed: snapshot.tasks.filter((task) => Boolean(task.recurrence)),
      monthExpense: snapshot.expenseRecords
        .filter((record) => record.date.startsWith(today.slice(0, 7)))
        .reduce((sum, record) => sum + record.amount, 0),
      monthWorkMinutes: snapshot.workRecords
        .filter((record) => record.worked && record.date.startsWith(today.slice(0, 7)))
        .reduce((sum, record) => sum + record.durationMinutes, 0),
    }
  }, [snapshot, today])

  const todayLabel = labelDate(today, { month: 'long', day: 'numeric', weekday: 'long' })
  const completedToday = view?.todayItems.filter(itemCompleted).length ?? 0
  const todayTotal = view?.todayItems.length ?? 0
  const todayVisible = (view?.todayItems ?? []).filter((item) =>
    snapshot?.prefs?.defaultCompletedDisplay === 'hide' ? !itemCompleted(item) : true,
  )

  function openTaskComposer() {
    navigate('/today')
    window.setTimeout(() => window.dispatchEvent(new CustomEvent(FOCUS_QUICK_ADD_EVENT)), 60)
  }

  async function toggleItem(item: CalItem) {
    try {
      if (item.kind === 'event') {
        await toggleEventCompletion(item.event)
      } else if (item.task.recurrence?.mode === 'after_completion') {
        if (item.completed) await undoAfterCompletion(item.task)
        else await resolveAfterCompletion(item.task, 'completed')
      } else if (item.completed) {
        await voidRecord(`${item.task.id}:${item.occurrenceKey}`)
      } else if (item.task.recurrence?.mode === 'fixed_schedule') {
        await completeFixedOccurrence(item.task, item.date)
      } else {
        await completeTask(item.task)
      }
      setFeedback(itemCompleted(item) ? '已恢复为待处理' : '已完成')
      window.setTimeout(() => setFeedback(''), 1600)
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : '操作失败')
    }
  }

  return (
    <section className="app-page page-overview">
      <MobilePageHeader
        title="总览"
        eyebrow={todayLabel}
        onPrimary={openTaskComposer}
        primaryLabel="新增任务"
      />
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
        <Link to="/finance" className="overview-metric overview-metric-finance">
          <AppIcon name="finance" size={20} />
          <span>本月支出</span>
          <strong>{compactMoney(view?.monthExpense ?? 0)}</strong>
          <small>{Math.round((view?.monthWorkMinutes ?? 0) / 60)} 小时工作</small>
        </Link>
      </div>

      <section className="overview-today-list" aria-labelledby="overview-today-list-title">
        <header>
          <div><p>本日计划</p><h2 id="overview-today-list-title">今天需要处理</h2></div>
          <Link to="/today">管理任务</Link>
        </header>
        <p className="overview-action-feedback" role="status">{feedback}</p>
        {todayVisible.length > 0 ? (
          <ul>
            {todayVisible.map((item, index) => (
              <li
                key={`${item.kind}:${item.kind === 'event' ? item.event.id : item.task.id}:${item.date}:${index}`}
                data-color-token={itemColor(item)}
                data-completed={itemCompleted(item) || undefined}
              >
                <button
                  className="overview-item-check"
                  aria-label={itemCompleted(item) ? '取消完成' : '完成'}
                  onClick={() => void toggleItem(item)}
                >
                  {itemCompleted(item) && <AppIcon name="check" size={14} />}
                </button>
                <div><strong>{itemTitle(item)}</strong><small>{item.kind === 'event' ? '日历事项' : item.subtitle ?? '任务'}</small></div>
                <AppIcon name={item.kind === 'event' ? 'calendar' : 'tasks'} size={17} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="overview-empty">今天没有待处理事项</div>
        )}
        {snapshot?.prefs?.defaultCompletedDisplay === 'collapse' && completedToday > 0 && (
          <small className="overview-completed-summary">已完成 {completedToday} 项</small>
        )}
      </section>

      <section className="overview-calendar-strip" aria-labelledby="overview-calendar-title">
        <header>
          <div>
            <p>接下来</p>
            <h2 id="overview-calendar-title">未来七天</h2>
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
                <button className="overview-item-check" aria-label="完成" onClick={() => void toggleItem(item)} />
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
