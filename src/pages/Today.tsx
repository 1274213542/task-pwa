import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react'
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { FOCUS_QUICK_ADD_EVENT } from '../lib/appEvents'
import {
  db,
  type Category,
  type CompletionRecord,
  type Task,
  type TaskScheduleType,
} from '../lib/db'
import {
  type Recurrence,
  describeRecurrence,
  fixedOccurrencesInRange,
  latestFixedOnOrBefore,
} from '../lib/recurrence'
import { checkAfterCompletionIntegrity } from '../lib/integrity'
import { addDaysISO, todayLocalISO } from '../lib/dates'
import { useCivilDate } from '../lib/useCivilDate'
import {
  RecurrenceConflictError,
  addTaskBatch,
  completeFixedOccurrence,
  completeTask,
  migrateDailyCompletionHistory,
  pruneDailyCompletionHistory,
  reorderTask,
  repairAfterCompletionCache,
  resolveAfterCompletion,
  skipFixedOccurrence,
  softDeleteTask,
  undoAfterCompletion,
  voidRecord,
} from '../lib/tasks'
import { parseTimedBatchEntries } from '../lib/batch'
import TaskRow from '../components/TaskRow'
import AppIcon from '../components/AppIcon'
import MarkerIcon from '../components/MarkerIcon'
import RecurrencePicker from '../components/RecurrencePicker'
import PageHeader from '../components/PageHeader'
import MobilePageHeader from '../components/MobilePageHeader'
import TaskToolbar from '../components/TaskToolbar'
import TaskViewSettingsSheet from '../components/TaskViewSettingsSheet'
import TaskEditor, { type EditableTaskStatus } from '../components/TaskEditor'
import TaskIntentSelector from '../components/TaskIntentSelector'
import { MOTION } from '../lib/motion'
import {
  defaultFixedRecurrence,
  taskScopeOf,
} from '../lib/taskPeriods'
import { synchronizeTaskPeriod } from '../lib/taskPeriodSync'
import {
  activeTaskViewSettingCount,
  applyTaskViewSettings,
  parseTaskViewSettings,
  type TaskViewSettings,
} from '../lib/taskViewSettings'
import {
  childProgress,
  civilDateOf,
  effectiveTaskSchedule,
  taskChildrenMap,
  taskDueStatus,
  taskMapOf,
  taskNodeRoleOf,
  taskScheduleLabel,
} from '../lib/taskSchedule'
import {
  effectiveRecurrence,
  isLongTermTaskDefinition,
  isTodayTaskDefinition,
  taskViewFromStorage,
  type TaskView,
} from '../lib/taskViews'

/** 今天视图的投影条目（TaskOccurrenceView 的子集） */
interface TodayItem {
  task: Task
  view?: TaskView
  kind: 'single' | 'fixed' | 'ac' | 'template' | 'plan'
  occurrenceDate: string
  occurrenceKey: string
  completed: boolean
  overdue: boolean
  conflict?: string
  subtitle?: string
}

type TaskRowProjectionExtra = {
  liRef?: (el: HTMLElement | null) => void
  liStyle?: React.CSSProperties
  dragProps?: Record<string, unknown>
  dragging?: boolean
  featureTone?: 'charcoal' | 'lime' | 'purple' | 'custom'
  selected?: boolean
  onMetaClick?: () => void
  divider?: boolean
}

function buildItems(
  tasks: Task[],
  records: CompletionRecord[],
  todayISO: string,
  view: TaskView,
): TodayItem[] {
  const recMap = new Map(records.map((r) => [r.id, r]))
  const items: TodayItem[] = []
  const taskMap = new Map(tasks.map((task) => [task.id, task]))

  for (const task of tasks) {
    const role = taskNodeRoleOf(task)
    if (role === 'plan') {
      if (view === 'longTerm') {
        items.push({
          task,
          kind: 'plan',
          occurrenceDate: civilDateOf(task.startAt) ?? task.startDate ?? todayISO,
          occurrenceKey: 'plan',
          completed: false,
          overdue: false,
          subtitle: undefined,
        })
      }
      continue
    }
    const r = effectiveRecurrence(task)
    if (view === 'longTerm') {
      if (!isLongTermTaskDefinition(task, todayISO, tasks, taskMap)) continue
      const single = recMap.get(`${task.id}:single`)
      items.push({
        task,
        kind: r ? 'template' : 'single',
        occurrenceDate: civilDateOf(task.startAt) ?? task.startDate ?? todayISO,
        occurrenceKey: r ? 'template' : 'single',
        completed: !r && single?.resolution === 'completed',
        overdue: !r && taskDueStatus(task, todayISO, taskMap).tone === 'overdue',
        subtitle: r ? `${describeRecurrence(r)} · 长期模板` : taskScheduleLabel(task, todayISO, tasks),
      })
      continue
    }

    if (!isTodayTaskDefinition(task, todayISO, tasks, taskMap)) continue
    if (!r) {
      const legacyDailyKey = `daily:${todayISO}`
      const occurrenceKey = recMap.has(`${task.id}:${legacyDailyKey}`) ? legacyDailyKey : 'single'
      const rec = recMap.get(`${task.id}:${occurrenceKey}`)
      const completedDate = rec?.completedDate ?? civilDateOf(task.completedAt)
      if (rec?.resolution === 'completed' && completedDate && completedDate < todayISO) continue
      const completedOn = rec?.resolution === 'completed'
        ? `${rec.completedDate ?? rec.occurrenceDate}T12:00:00`
        : undefined
      const schedule = effectiveTaskSchedule(task, taskMap)
      const due = taskDueStatus(task, todayISO, taskMap, completedOn)
      items.push({
        task,
        kind: 'single',
        occurrenceDate: task.startDate ?? todayISO,
        occurrenceKey,
        completed: rec?.resolution === 'completed',
        overdue: due.tone === 'overdue',
        subtitle: taskScheduleLabel(
          task,
          todayISO,
          tasks,
          completedOn,
        ) + (schedule.inheritedFrom ? ' · 继承父任务日期' : ''),
      })
    } else if (r.mode === 'fixed_schedule') {
      const start = task.startDate ?? civilDateOf(task.startAt) ?? todayISO
      const due = latestFixedOnOrBefore(r, start, task.endDate, todayISO)
      if (!due) continue
      const rec = recMap.get(`${task.id}:fixed:${due}`)
      const resolved = rec && rec.resolution !== 'voided'
      if (resolved && due !== todayISO) continue
      // 错过 n 期徽标（v4.2 决策表 #4）：最近一期之前的未解决实例为计算态，不落库
      let missed = 0
      if (due < todayISO || !resolved) {
        const windowStart =
          start > addDaysISO(todayISO, -62) ? start : addDaysISO(todayISO, -62)
        missed = fixedOccurrencesInRange(r, start, task.endDate, windowStart, due)
          .filter((d) => d < due)
          .filter((d) => {
            const x = recMap.get(`${task.id}:fixed:${d}`)
            return !x || x.resolution === 'voided'
          }).length
      }
      items.push({
        task,
        kind: 'fixed',
        occurrenceDate: due,
        occurrenceKey: `fixed:${due}`,
        completed: rec?.resolution === 'completed',
        overdue: due < todayISO,
        subtitle:
          describeRecurrence(r) +
          (due < todayISO ? ` · 逾期（${due.slice(5)}）` : '') +
          (missed > 0 ? ` · 已错过 ${missed} 期` : ''),
      })
    } else {
      const acRecords = records.filter(
        (x) => x.taskId === task.id && x.occurrenceKey.startsWith('ac:'),
      )
      const check = checkAfterCompletionIntegrity(task, acRecords)
      if (check.status === 'cache_mismatch') {
        void repairAfterCompletionCache(
          task.id,
          check.expectedSequence,
          check.expectedNextDueDate,
        )
        continue
      }
      if (check.status === 'conflict') {
        items.push({
          task,
          kind: 'ac',
          occurrenceDate: task.nextDueDate ?? todayISO,
          occurrenceKey: `ac:${task.currentSequence ?? 1}`,
          completed: false,
          overdue: false,
          conflict: check.reason,
          subtitle: '⚠ 周期状态需要确认',
        })
        continue
      }
      const due = task.nextDueDate ?? todayISO
      if (due <= todayISO) {
        items.push({
          task,
          kind: 'ac',
          occurrenceDate: due,
          occurrenceKey: `ac:${task.currentSequence ?? 1}`,
          completed: false,
          overdue: due < todayISO,
          subtitle:
            describeRecurrence(r) +
            (due < todayISO ? ` · 逾期（${due.slice(5)}）` : ''),
        })
      }
      const prevSeq = (task.currentSequence ?? 1) - 1
      const prev = recMap.get(`${task.id}:ac:${prevSeq}`)
      if (prev?.resolution === 'completed' && prev.completedDate === todayISO) {
        items.push({
          task,
          kind: 'ac',
          occurrenceDate: prev.occurrenceDate,
          occurrenceKey: `ac:${prevSeq}`,
          completed: true,
          overdue: false,
          subtitle: describeRecurrence(r),
        })
      }
    }
  }
  return items.map((item) => ({ ...item, view }))
}

function SortablePendingRow({
  item,
  row,
  selected,
  onMetaClick,
  divider,
}: {
  item: TodayItem
  row: (item: TodayItem, extra?: TaskRowProjectionExtra) => React.ReactNode
  selected: boolean
  onMetaClick: () => void
  divider: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.task.id })
  return row(item, {
    liRef: setNodeRef,
    liStyle: {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.18 : 1,
    },
    dragProps: { ...attributes, ...listeners },
    dragging: isDragging,
    featureTone: 'custom',
    selected,
    onMetaClick,
    divider,
  })
}

export default function Today() {
  const reduceMotion = useReducedMotion()
  const location = useLocation()
  const [title, setTitle] = useState('')
  const [recurrence, setRecurrence] = useState<Recurrence | undefined>()
  const [categoryId, setCategoryId] = useState<string>('')
  const [planId, setPlanId] = useState('')
  const [newPlanTitle, setNewPlanTitle] = useState('')
  const [scope, setScope] = useState<TaskView>(
    () => taskViewFromStorage(localStorage.getItem('taskPrimaryViewV1') ?? localStorage.getItem('taskScope')),
  )
  const [fixed, setFixed] = useState(false)
  const [scheduleType, setScheduleType] = useState<TaskScheduleType>('today')
  const [scheduleStart, setScheduleStart] = useState(() => todayLocalISO())
  const [scheduleDue, setScheduleDue] = useState('')
  const [showBeforeStart, setShowBeforeStart] = useState(false)
  const [surfaceDaysBeforeDue, setSurfaceDaysBeforeDue] = useState(3)
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [viewSettingsOpen, setViewSettingsOpen] = useState(false)
  const [viewSettings, setViewSettings] = useState<TaskViewSettings>(() =>
    parseTaskViewSettings(localStorage.getItem('taskViewSettingsV1')),
  )
  const [syncingPeriod, setSyncingPeriod] = useState(false)
  const [toolbarStuck, setToolbarStuck] = useState(false)
  const [contentDirection, setContentDirection] = useState<1 | -1>(1)
  const [showDone, setShowDone] = useState(false)
  const [showDailyHistory, setShowDailyHistory] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<TodayItem | null>(null)
  // 完成感窗口（v4.2 §12）：勾选后原地保留 ~800ms 展示动画，再按策略归置
  const [recentlyDone, setRecentlyDone] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const toolbarSentinelRef = useRef<HTMLDivElement>(null)
  const submittingRef = useRef(false)
  const syncingPeriodRef = useRef(false)
  const scrollPositionsRef = useRef<Record<TaskView, number>>({ today: 0, longTerm: 0 })

  function holdInPlace(itemKey: string) {
    setRecentlyDone((prev) => new Set(prev).add(itemKey))
    setTimeout(() => {
      setRecentlyDone((prev) => {
        const next = new Set(prev)
        next.delete(itemKey)
        return next
      })
    }, 800)
  }
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // 触摸端以长按进入排序；容差允许手指自然微移，同时保留正常纵向滚动。
    useSensor(TouchSensor, {
      activationConstraint: { delay: 260, tolerance: 8 },
    }),
    // 键盘拖拽（space 拾起 / 方向键移动 / space 放下）：无障碍 + 可测试
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // ⌘N：聚焦快速添加（App 层广播）
  useEffect(() => {
    const focus = () => {
      setComposerOpen(true)
      window.requestAnimationFrame(() => inputRef.current?.focus())
    }
    window.addEventListener(FOCUS_QUICK_ADD_EVENT, focus)
    return () => window.removeEventListener(FOCUS_QUICK_ADD_EVENT, focus)
  }, [])

  useEffect(() => {
    if (!(location.state as { openTaskComposer?: boolean } | null)?.openTaskComposer) return
    setComposerOpen(true)
    window.requestAnimationFrame(() => inputRef.current?.focus())
    window.history.replaceState(
      { ...window.history.state, usr: null },
      '',
      window.location.href,
    )
  }, [location.state])

  useEffect(() => {
    localStorage.setItem('taskViewSettingsV1', JSON.stringify(viewSettings))
  }, [viewSettings])

  useEffect(() => {
    const sentinel = toolbarSentinelRef.current
    const scrollRoot = document.querySelector('.app-shell main')
    if (!sentinel || !(scrollRoot instanceof HTMLElement)) return
    let observer: IntersectionObserver | undefined
    let frame = 0

    const observe = () => {
      observer?.disconnect()
      const safeTop = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--ds-safe-top'),
      ) || 0
      observer = new IntersectionObserver(
        ([entry]) => setToolbarStuck(!entry.isIntersecting),
        {
          root: scrollRoot,
          threshold: 1,
          rootMargin: `${-(safeTop + 1)}px 0px 0px 0px`,
        },
      )
      observer.observe(sentinel)
    }

    const scheduleObserve = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(observe)
    }

    observe()
    // iOS can change the resolved safe-area after rotation or when a
    // standalone PWA resumes. Rebuild the threshold without remounting the
    // persistent toolbar so its material and geometry stay stable.
    window.addEventListener('resize', scheduleObserve)
    window.addEventListener('orientationchange', scheduleObserve)
    window.addEventListener('pageshow', scheduleObserve)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', scheduleObserve)
      window.removeEventListener('orientationchange', scheduleObserve)
      window.removeEventListener('pageshow', scheduleObserve)
    }
  }, [])

  const tasks = useLiveQuery(
    () => db.tasks.where('lifecycleStatus').equals('active').sortBy('rank'),
    [],
  )
  const records = useLiveQuery(() => db.completionRecords.toArray(), [])
  const categories = useLiveQuery(
    () => db.categories.where('lifecycleStatus').equals('active').sortBy('rank'),
    [],
  )
  const prefs = useLiveQuery(() => db.syncedPreferences.get('#prefs'), [])
  const policy = prefs?.defaultCompletedDisplay ?? 'keep'

  const todayISO = useCivilDate() // 跨零点与 iOS 后台恢复时刷新本地民用日期
  const catMap = new Map((categories ?? []).map((c) => [c.id, c]))
  const taskMap = useMemo(() => taskMapOf(tasks ?? []), [tasks])
  const childrenByParent = useMemo(() => taskChildrenMap(tasks ?? []), [tasks])
  const activePlans = useMemo(
    () => (tasks ?? []).filter((task) => taskNodeRoleOf(task) === 'plan'),
    [tasks],
  )
  const timedEntries = useMemo(() => parseTimedBatchEntries(title), [title])
  const batchInputInvalid = timedEntries.some((entry) => entry.error) ||
    (planId === '__new__' && !newPlanTitle.trim())
  const items =
    tasks && records ? buildItems(tasks, records, todayISO, scope) : undefined
  const keyOf = (i: TodayItem) => `${i.task.id}:${i.occurrenceKey}`
  const projectedItems = useMemo(
    () => items ? applyTaskViewSettings(items, viewSettings) : undefined,
    [items, viewSettings],
  )
  const pending =
    projectedItems?.filter((i) => !i.completed || recentlyDone.has(keyOf(i))) ?? []
  const done =
    projectedItems?.filter((i) => i.completed && !recentlyDone.has(keyOf(i))) ?? []
  const visiblePlanCount = projectedItems?.filter((item) => taskNodeRoleOf(item.task) === 'plan').length ?? 0
  const visibleTaskCount = (projectedItems?.length ?? 0) - visiblePlanCount
  const allDoneCount = items?.filter((item) => item.completed).length ?? 0
  const taskCounts = useMemo(() => {
    if (!tasks || !records) return { today: 0, longTerm: 0 }
    return {
      today: applyTaskViewSettings(buildItems(tasks, records, todayISO, 'today'), viewSettings)
        .filter((item) => taskNodeRoleOf(item.task) === 'task').length,
      longTerm: applyTaskViewSettings(buildItems(tasks, records, todayISO, 'longTerm'), viewSettings)
        .filter((item) => taskNodeRoleOf(item.task) === 'task').length,
    }
  }, [tasks, records, todayISO, viewSettings])
  const currentCompletedTaskIds = useMemo(() => {
    if (!tasks || !records) return new Set<string>()
    return new Set([
      ...buildItems(tasks, records, todayISO, 'today'),
      ...buildItems(tasks, records, todayISO, 'longTerm'),
    ].filter((item) => item.completed).map((item) => item.task.id))
  }, [tasks, records, todayISO])
  const activeSettingCount = activeTaskViewSettingCount(viewSettings)
  const completedDisplayPolicy =
    viewSettings.showCompleted || viewSettings.status === 'completed'
      ? policy === 'hide' ? 'keep' : policy
      : 'hide'
  const dailyHistory = useMemo(() => {
    if (!tasks || !records || scope !== 'today') return []
    const oldestDate = addDaysISO(todayISO, -6)
    const dailyTaskIds = new Set(tasks
      .filter((task) => taskScopeOf(task) === 'daily')
      .map((task) => task.id))
    return records
      .filter((record) =>
        dailyTaskIds.has(record.taskId) &&
        (record.occurrenceKey.startsWith('daily:') || record.occurrenceKey.startsWith('fixed:')) &&
        record.occurrenceDate >= oldestDate &&
        record.occurrenceDate <= todayISO &&
        (record.resolution === 'completed' || record.resolution === 'voided'),
      )
      .sort((a, b) => b.resolvedAt.localeCompare(a.resolvedAt))
  }, [tasks, records, scope, todayISO])

  useEffect(() => {
    if (!tasks || scope !== 'today') return
    let cancelled = false
    void (async () => {
      await migrateDailyCompletionHistory(tasks)
      if (!cancelled) await pruneDailyCompletionHistory(tasks, addDaysISO(todayISO, -6))
    })()
    return () => { cancelled = true }
  }, [tasks, scope, todayISO])

  const dateLabel = new Date().toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })

  function switchScope(next: TaskView) {
    if (next === scope) return
    setViewSettingsOpen(false)
    setContentDirection(next === 'longTerm' ? 1 : -1)
    const scrollRoot = document.querySelector('.app-shell main')
    let nextScrollTop: number | undefined
    if (scrollRoot instanceof HTMLElement) {
      const currentScrollTop = scrollRoot.scrollTop
      scrollPositionsRef.current[scope] = currentScrollTop
      const safeTop = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--ds-safe-top'),
      ) || 0
      const stickyThreshold = Math.max(
        0,
        (toolbarSentinelRef.current?.offsetTop ?? 0) - safeTop,
      )
      const rememberedScrollTop = scrollPositionsRef.current[next]
      // A tab switch must not move the toolbar itself. Restore an independent
      // position only when both scopes keep the toolbar in its sticky state;
      // otherwise retain the current page skeleton and let the user scroll.
      nextScrollTop = currentScrollTop >= stickyThreshold &&
        rememberedScrollTop >= stickyThreshold
        ? rememberedScrollTop
        : currentScrollTop
    }
    setScope(next)
    localStorage.setItem('taskPrimaryViewV1', next)
    if (!fixed) setScheduleType(next === 'today' ? 'today' : 'longTerm')
    setFeedback('')
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (scrollRoot instanceof HTMLElement) {
          scrollRoot.scrollTo({
            top: nextScrollTop ?? scrollPositionsRef.current[next],
            behavior: 'auto',
          })
        }
      })
    })
  }

  function setTaskType(nextFixed: boolean) {
    setFixed(nextFixed)
    setRecurrence(nextFixed ? defaultFixedRecurrence('daily') : undefined)
    if (nextFixed) setScheduleType('longTerm')
  }

  function selectScheduleType(next: TaskScheduleType) {
    setScheduleType(next)
    if (next !== 'unscheduled' && !scheduleStart) setScheduleStart(todayISO)
    if (next === 'unscheduled') setScheduleDue('')
    if (next !== 'longTerm') {
      setShowBeforeStart(false)
      setSurfaceDaysBeforeDue(3)
    }
  }

  async function syncCurrentPeriod() {
    if (syncingPeriodRef.current) return
    syncingPeriodRef.current = true
    setSyncingPeriod(true)
    setFeedback('正在同步今日周期任务…')
    try {
      const [dailyResult, weeklyResult] = await Promise.all([
        synchronizeTaskPeriod('daily', todayISO),
        synchronizeTaskPeriod('weekly', todayISO),
      ])
      setFeedback(dailyResult.repairs.length + weeklyResult.repairs.length > 0
        ? '已同步今日周期任务'
        : '当前已是最新')
      window.setTimeout(() => setFeedback(''), 2200)
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : '周期任务同步失败，请重试')
    } finally {
      syncingPeriodRef.current = false
      setSyncingPeriod(false)
    }
  }

  async function submit() {
    if (submittingRef.current || !title.trim() || batchInputInvalid) return
    submittingRef.current = true
    setSubmitting(true)
    setFeedback('')
    try {
      const result = await addTaskBatch({
        value: title,
        recurrence: fixed ? (recurrence ?? defaultFixedRecurrence('daily')) : undefined,
        categoryId: categoryId || undefined,
        startDate: scheduleStart || todayISO,
        taskScope: recurrence?.mode === 'fixed_schedule' && recurrence.frequency === 'weekly' ? 'weekly' : 'daily',
        planId: planId && planId !== '__new__' ? planId : undefined,
        newPlanTitle: planId === '__new__' ? newPlanTitle : undefined,
        schedule: fixed
          ? { scheduleType: 'longTerm', startAt: scheduleStart || todayISO }
          : {
              scheduleType,
              ...(scheduleType !== 'unscheduled' && { startAt: scheduleStart || todayISO }),
              ...(scheduleDue && { dueAt: scheduleDue }),
              showBeforeStart,
              surfaceDaysBeforeDue,
            },
      })
      if (result.created > 0) {
        setTitle('')
        setCategoryId('')
        setPlanId('')
        setNewPlanTitle('')
        setComposerOpen(false)
        setScheduleType('today')
        setScheduleStart(todayISO)
        setScheduleDue('')
        setShowBeforeStart(false)
        setSurfaceDaysBeforeDue(3)
        inputRef.current?.blur()
      }
      const failureText = result.failures.length
        ? `；失败 ${result.failures.map((item) => `第 ${item.line} 行「${item.value.slice(0, 18)}」：${item.reason}`).join('、')}`
        : ''
      setFeedback(`已添加 ${result.created} 个任务${failureText}`)
      window.setTimeout(() => setFeedback(''), 2200)
    } catch (reason) {
      console.error('添加任务失败', reason)
      setFeedback(reason instanceof Error ? reason.message : '添加失败，请重试')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  async function guarded(fn: () => Promise<void>) {
    try {
      await fn()
    } catch (e) {
      if (e instanceof RecurrenceConflictError) {
        alert(e.message)
      } else {
        throw e
      }
    }
  }

  function actionsFor(item: TodayItem) {
    const { task } = item
    return {
      onEdit: () => {
        setEditingItem(item)
      },
      onToggle: () => {
        if (item.kind === 'template' || item.kind === 'plan') {
          setEditingItem(item)
          return
        }
        void guarded(async () => {
          if (!item.completed) holdInPlace(`${task.id}:${item.occurrenceKey}`)
          if (item.kind === 'single') {
            if (item.completed) await voidRecord(`${task.id}:${item.occurrenceKey}`)
            else await completeTask(task)
          } else if (item.kind === 'fixed') {
            if (item.completed) await voidRecord(`${task.id}:${item.occurrenceKey}`)
            else await completeFixedOccurrence(task, item.occurrenceDate)
          } else {
            if (item.completed) await undoAfterCompletion(task)
            else await resolveAfterCompletion(task, 'completed')
          }
        })
      },
      onDelete: () => {
        void softDeleteTask(task.id)
      },
    }
  }

  function rowFor(
    item: TodayItem,
    extra: TaskRowProjectionExtra = {},
  ) {
    let nestingLevel = 0
    let parentId = item.task.parentTaskId
    const visitedParents = new Set<string>()
    while (parentId && !visitedParents.has(parentId) && nestingLevel < 4) {
      const parent = taskMap.get(parentId)
      if (!parent || parent.lifecycleStatus !== 'active') break
      visitedParents.add(parentId)
      nestingLevel += 1
      parentId = parent.parentTaskId
    }
    const cat = item.task.categoryId ? catMap.get(item.task.categoryId) : undefined
    const catText = cat ? cat.name : undefined
    const progress = childProgress(
      item.task.id,
      childrenByParent,
      currentCompletedTaskIds,
    )
    const subtitle =
      [
        item.kind === 'plan' ? '计划' : item.kind === 'single' ? '普通' : item.kind === 'template' ? '长期' : '固定',
        progress ? `子任务 ${progress.completed}/${progress.total}` : undefined,
        item.conflict,
        catText,
        item.subtitle,
      ]
        .filter(Boolean)
        .join(' · ')
    return (
      <TaskRow
        key={`${item.task.id}:${item.occurrenceKey}`}
        title={item.task.title}
        subtitle={subtitle}
        colorToken={
          item.task.visualToken ?? cat?.colorToken ?? (scope === 'longTerm' ? 'purple' : 'green')
        }
        markerSymbol={
          item.task.markerSymbol ??
          cat?.markerSymbol ??
          (item.kind === 'single' ? 'dot' : 'spark')
        }
        featureTone={
          item.task.visualToken || cat?.colorToken
            ? 'custom'
            : extra.featureTone ?? (item.completed ? 'custom' : 'lime')
        }
        completed={item.completed}
        organizational={item.kind === 'plan'}
        completionDisabled={item.kind === 'plan' || (item.kind === 'template' && Boolean(item.task.recurrence || taskScopeOf(item.task) === 'weekly'))}
        overdue={item.overdue}
        nestingLevel={nestingLevel}
        actions={actionsFor(item)}
        rowId={`${item.task.id}:${item.occurrenceKey}`}
        {...extra}
      />
    )
  }

  function toggleSelect(taskId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  async function completeItem(item: TodayItem) {
    if (item.kind === 'template' || item.kind === 'plan') return
    if (item.kind === 'single') {
      await completeTask(item.task)
    }
    else if (item.kind === 'fixed')
      await completeFixedOccurrence(item.task, item.occurrenceDate)
    else await resolveAfterCompletion(item.task, 'completed')
  }

  async function setEditedItemStatus(item: TodayItem, status: EditableTaskStatus) {
    const current: EditableTaskStatus = item.completed ? 'completed' : 'pending'
    if (status === current) return
    if (status === 'pending') {
      if (item.kind === 'ac') await undoAfterCompletion(item.task)
      else await voidRecord(`${item.task.id}:${item.occurrenceKey}`)
      return
    }
    if (status === 'completed') {
      await completeItem(item)
      return
    }
    if (item.kind === 'fixed') await skipFixedOccurrence(item.task, item.occurrenceDate)
    else if (item.kind === 'ac') await resolveAfterCompletion(item.task, 'skipped')
  }

  const selectedPending = pending.filter((i) => selectedIds.has(i.task.id))

  async function batchComplete() {
    for (const item of selectedPending) {
      if (!item.conflict) await guarded(() => completeItem(item))
    }
    setSelectedIds(new Set())
  }

  async function batchDelete() {
    for (const item of selectedPending) await softDeleteTask(item.task.id)
    setSelectedIds(new Set())
  }

  // ⌘↵：完成选中（v4.2 §10 桌面快捷键）
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && selectedIds.size > 0) {
        e.preventDefault()
        void batchComplete()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, pending])

  function onDragStart(e: DragStartEvent) {
    setActiveTaskId(String(e.active.id))
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveTaskId(null)
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = pending.map((p) => p.task.id)
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = arrayMove(pending, oldIndex, newIndex)
    const idx = reordered.findIndex((p) => p.task.id === active.id)
    void reorderTask(
      String(active.id),
      reordered[idx - 1]?.task.rank ?? null,
      reordered[idx + 1]?.task.rank ?? null,
    )
  }

  const activePending = pending.find((item) => item.task.id === activeTaskId)

  return (
    <section className="app-page page-tasks" data-scope={scope}>
      <PageHeader
        title="任务"
        eyebrow={scope === 'today' ? dateLabel : '持续与未来'}
        actions={(
          <button
            type="button"
            aria-label={composerOpen ? '收起新增任务' : '新增任务'}
            aria-expanded={composerOpen}
            onClick={() => {
              setComposerOpen((open) => !open)
            }}
            className="task-round-action task-round-action-primary"
          >
            <AppIcon name={composerOpen ? 'chevronUp' : 'plus'} size={24} />
          </button>
        )}
      />
      <MobilePageHeader
        title="任务"
        eyebrow={dateLabel}
        onPrimary={() => {
          setComposerOpen((open) => !open)
        }}
        primaryLabel={composerOpen ? '收起新增任务' : '新增任务'}
        primaryIcon={composerOpen ? 'chevronUp' : 'plus'}
      />

      <div ref={toolbarSentinelRef} className="task-toolbar-sentinel" aria-hidden />
      <TaskToolbar
        scope={scope}
        todayCount={taskCounts.today}
        longTermCount={taskCounts.longTerm}
        activeSettingCount={activeSettingCount}
        syncing={syncingPeriod}
        stuck={toolbarStuck}
        onScopeChange={switchScope}
        onOpenSettings={() => {
          setViewSettingsOpen(true)
        }}
        onSync={() => void syncCurrentPeriod()}
      />

      <motion.div
        key={scope}
        className={`task-content-surface task-density-${viewSettings.density}`}
        initial={reduceMotion ? { opacity: 0.88 } : { x: contentDirection * 10 }}
        animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
        transition={reduceMotion ? MOTION.reduced : MOTION.taskContent}
      >
      <div className="task-progress-line" aria-label="任务进度">
        <span>
          {activeSettingCount > 0 ? '筛选结果' : scope === 'today' ? '今日任务' : '长期任务'} {visibleTaskCount} 项
          {visiblePlanCount > 0 ? ` · ${visiblePlanCount} 个计划` : ''}
        </span>
        <i aria-hidden>·</i>
        <span>已完成 {allDoneCount} 项</span>
      </div>

      <AnimatePresence initial={false}>
      {composerOpen && <motion.div
        key="task-composer"
        initial={reduceMotion ? false : { opacity: 0, y: -6, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.99 }}
        transition={reduceMotion ? MOTION.reduced : MOTION.sheet}
        className="quick-card task-composer-card"
      >
        <div className="flex items-center gap-2">
          <textarea
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void submit()
              }
            }}
            rows={3}
            placeholder="每行一个任务；Enter 换行…"
            className="min-h-11 min-w-0 flex-1 resize-none rounded-xl bg-transparent px-3
              py-2.5 text-[16px] leading-6 outline-none placeholder:text-neutral-400"
          />
          <button
            onClick={() => void submit()}
            disabled={!title.trim() || submitting || batchInputInvalid}
            aria-label="添加"
            className="primary-action h-11 w-11 shrink-0 rounded-xl text-xl
              text-white transition active:scale-95 disabled:opacity-40"
          >
            <AppIcon name="plus" size={23} />
          </button>
        </div>
        <p className="batch-input-hint">
          <span className="mobile-composer-hint">可在行首输入 8.30 或 08:30</span>
          <span className="desktop-composer-hint">每行一个任务 · 行首时间可选 · ⌘/Ctrl + Enter 添加全部</span>
        </p>
        {timedEntries.some((entry) => entry.time || entry.error) && (
          <div className="task-batch-preview" aria-label="批量任务解析预览">
            {timedEntries.map((entry) => (
              <span key={`${entry.line}:${entry.value}`} data-error={entry.error || undefined}>
                <b>{entry.time ?? (entry.error ? '!' : '—')}</b>
                {entry.title || entry.value}
              </span>
            ))}
          </div>
        )}
        {title.trim() && <div className="task-quick-primary-fields">
          <label className="task-plan-picker">
            <span>所属计划</span>
            <select value={planId} onChange={(event) => setPlanId(event.target.value)} aria-label="所属计划">
              <option value="">不加入计划</option>
              {activePlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.title}</option>)}
              <option value="__new__">＋ 新建计划</option>
            </select>
          </label>
          {scheduleType !== 'unscheduled' && <label className="task-plan-picker">
            <span>{scheduleType === 'longTerm' ? '开始日期' : '日期'}</span>
            <input type="date" value={scheduleStart} onChange={(event) => setScheduleStart(event.target.value)} />
          </label>}
          {planId === '__new__' && (
            <label className="task-plan-picker task-plan-name-field">
              <span>计划名称</span>
              <input value={newPlanTitle} onChange={(event) => setNewPlanTitle(event.target.value)} placeholder="例如 回国" autoComplete="off" />
            </label>
          )}
        </div>}
        {title.trim() && <details className="task-quick-advanced">
          <summary>更多设置</summary>
          <div className="task-quick-advanced-body">
            <div className="segmented-control task-type-switch text-[12px]" role="group" aria-label="任务类型">
              <button onClick={() => setTaskType(false)} aria-pressed={!fixed} className={!fixed ? 'is-active' : ''}>普通任务</button>
              <button onClick={() => setTaskType(true)} aria-pressed={fixed} className={fixed ? 'is-active' : ''}>固定任务</button>
            </div>
            {fixed && <RecurrencePicker value={recurrence} onChange={setRecurrence} />}
            {(categories?.length ?? 0) > 0 && (
              <select aria-label="分类" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                <option value="">无分类</option>
                {categories!.map((category: Category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            )}
            {!fixed && <div className="task-schedule-composer" aria-label="任务时间设置">
              <TaskIntentSelector value={scheduleType} onChange={selectScheduleType} compact />
              {scheduleType !== 'unscheduled' && <label>
                DDL
                <input
                  type="datetime-local"
                  min={scheduleStart ? `${scheduleStart}T00:00` : undefined}
                  value={scheduleDue}
                  onChange={(event) => setScheduleDue(event.target.value)}
                />
              </label>}
              {scheduleType === 'longTerm' && <details className="task-schedule-advanced">
                <summary>显示规则</summary>
                <label className="task-schedule-toggle">
                  <input type="checkbox" checked={showBeforeStart} onChange={(event) => setShowBeforeStart(event.target.checked)} />
                  开始日期前仍显示
                </label>
                <label>提前进入近期
                  <span className="task-surface-days-input">
                    <input type="number" min={0} max={90} value={surfaceDaysBeforeDue} onChange={(event) => setSurfaceDaysBeforeDue(Number(event.target.value) || 0)} /> 天
                  </span>
                </label>
              </details>}
            </div>}
          </div>
        </details>}
      </motion.div>}
      </AnimatePresence>
      <p role="status" className="min-h-5 px-2 pt-1 text-[12px] text-neutral-500">
        {feedback}
      </p>

      {items === undefined ? null : pending.length + done.length === 0 ? (
        <div className="task-empty-state">
          <MarkerIcon symbol={scope === 'today' ? 'flower' : 'star'} color={scope === 'today' ? 'green' : 'purple'} size={58} />
          <strong>{activeSettingCount > 0
            ? '没有符合筛选条件的任务'
            : scope === 'today' ? '今天没有任务' : '没有长期任务'}</strong>
          <span>{activeSettingCount > 0
            ? '调整任务视图设置即可查看其他任务'
            : '在上方添加普通任务或会按周期更新的固定任务'}</span>
          {activeSettingCount > 0 && (
            <button type="button" onClick={() => setViewSettingsOpen(true)}>
              调整筛选
            </button>
          )}
        </div>
      ) : (
        <LayoutGroup id={`task-layout-${scope}`}>
          {pending.length > 0 && viewSettings.sort === 'manual' && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={onDragStart}
              onDragCancel={() => setActiveTaskId(null)}
              onDragEnd={onDragEnd}
              autoScroll
            >
              <SortableContext
                items={pending.map((p) => p.task.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="task-card-list task-compact-list">
                  <AnimatePresence initial={false}>
                  {pending.map((item, index) => (
                    <SortablePendingRow
                      key={`${item.task.id}:${item.occurrenceKey}`}
                      item={item}
                      row={rowFor}
                      selected={selectedIds.has(item.task.id)}
                      onMetaClick={() => toggleSelect(item.task.id)}
                      divider={index > 0}
                    />
                  ))}
                  </AnimatePresence>
                </ul>
              </SortableContext>
              <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(.22,.78,.2,1)' }}>
                {activePending ? (
                  <div className="drag-overlay-row">
                    <span className="drag-overlay-check" aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate text-[16px] font-medium">{activePending.task.title}</p>
                      <p className="truncate text-[12px] text-neutral-500">松手保存新顺序</p>
                    </div>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
          {pending.length > 0 && viewSettings.sort !== 'manual' && (
            <ul className="task-card-list task-compact-list">
              <AnimatePresence initial={false}>
                {pending.map((item, index) => rowFor(item, { divider: index > 0 }))}
              </AnimatePresence>
            </ul>
          )}

          {/* 桌面批量操作条（⌘click 多选，⌘↵ 完成） */}
          {selectedPending.length > 0 && (
            <div
              className="glass slide-up fixed inset-x-4 bottom-20 z-20 mx-auto flex
                max-w-md items-center justify-between gap-3 rounded-2xl
                bg-neutral-900/90 px-4 py-2.5 text-white shadow-lg backdrop-blur
                lg:bottom-6"
            >
              <span className="text-[14px]">已选 {selectedPending.length} 项</span>
              <div className="flex gap-2">
                <button
                  onClick={() => void batchComplete()}
                  className="rounded-lg bg-white px-3 py-1.5 text-[13px] font-medium
                    text-neutral-900"
                >
                  完成 ⌘↵
                </button>
                <button
                  onClick={() => void batchDelete()}
                  className="rounded-lg bg-red-500 px-3 py-1.5 text-[13px] font-medium"
                >
                  删除
                </button>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="rounded-lg px-2 py-1.5 text-[13px] text-neutral-300"
                >
                  取消
                </button>
              </div>
            </div>
          )}

          {/* 完成后展示策略（v4.2 需求 §1）：keep 原地保留 / collapse 折叠 / hide 隐藏 */}
          {done.length > 0 && completedDisplayPolicy === 'keep' && (
            <ul className="task-card-list completed-card-list mt-3">
              <AnimatePresence initial={false}>
                {done.map((i, index) => rowFor(i, { divider: index > 0 }))}
              </AnimatePresence>
            </ul>
          )}
          {done.length > 0 && completedDisplayPolicy === 'collapse' && (
            <div className="mt-3">
              <button
                onClick={() => setShowDone((s) => !s)}
                className="px-1 text-[13px] font-medium text-neutral-400"
              >
                <AppIcon
                  name="chevronDown"
                  size={15}
                  className={showDone ? '' : '-rotate-90'}
                />
                已完成 · {done.length}
              </button>
              {showDone && (
                <ul className="task-card-list completed-card-list mt-2">
                  <AnimatePresence initial={false}>
                    {done.map((i, index) => rowFor(i, { divider: index > 0 }))}
                  </AnimatePresence>
                </ul>
              )}
            </div>
          )}
          {/* hide：不渲染，已完成记录页可查 */}
        </LayoutGroup>
      )}
      {scope === 'today' && (
        <section className="daily-history-card" aria-labelledby="daily-history-title">
          <button
            type="button"
            className="daily-history-toggle"
            aria-expanded={showDailyHistory}
            onClick={() => setShowDailyHistory((value) => !value)}
            disabled={dailyHistory.length === 0}
          >
            <span id="daily-history-title">最近 7 天完成记录</span>
            <span>{dailyHistory.length}</span>
            <AppIcon name="chevronDown" size={16} className={showDailyHistory ? '' : '-rotate-90'} />
          </button>
          {showDailyHistory && dailyHistory.length > 0 && (
            <ul className="daily-history-list">
              {dailyHistory.map((record, index) => {
                const restored = record.resolution === 'voided'
                const completedAt = new Date(record.resolvedAt).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
                return (
                  <li key={record.id} data-restored={restored || undefined} data-divider={index > 0 || undefined}>
                    <div>
                      <strong>{record.titleSnapshot}</strong>
                      <small>{record.occurrenceDate} · {completedAt}{restored ? ' · 已恢复' : ''}</small>
                    </div>
                    <button
                      type="button"
                      disabled={restored}
                      onClick={() => void voidRecord(record.id)}
                    >
                      {restored ? '已恢复' : '恢复'}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
      </motion.div>
      {viewSettingsOpen && (
        <TaskViewSettingsSheet
          settings={viewSettings}
          onChange={setViewSettings}
          onClose={() => setViewSettingsOpen(false)}
        />
      )}
      {editingItem && (
        <TaskEditor
          item={{
            kind: 'task',
            task: editingItem.task,
            occurrenceKey: editingItem.occurrenceKey,
            date: editingItem.occurrenceDate,
            completed: editingItem.completed,
            skipped: false,
            subtitle: editingItem.subtitle,
          }}
          categories={categories ?? []}
          onStatusChange={(status) => setEditedItemStatus(editingItem, status)}
          onClose={() => setEditingItem(null)}
        />
      )}
    </section>
  )
}
