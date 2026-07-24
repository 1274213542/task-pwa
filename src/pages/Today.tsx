import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
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
import { parseTimedBatchEntries, type TimedBatchEntry } from '../lib/batch'
import TaskRow from '../components/TaskRow'
import AppIcon from '../components/AppIcon'
import MarkerIcon from '../components/MarkerIcon'
import PageHeader from '../components/PageHeader'
import MobilePageHeader from '../components/MobilePageHeader'
import TaskToolbar from '../components/TaskToolbar'
import TaskViewSettingsSheet from '../components/TaskViewSettingsSheet'
import TaskEditor, { type EditableTaskStatus } from '../components/TaskEditor'
import BatchTaskSettingsSheet from '../components/BatchTaskSettingsSheet'
import TaskPlanPickerSheet from '../components/TaskPlanPickerSheet'
import InlinePlanChildComposer from '../components/InlinePlanChildComposer'
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
  taskChildKindOf,
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

function timedBatchErrorMessage(entry: TimedBatchEntry): string {
  if (entry.errorCode === 'missing_title') {
    return `第 ${entry.line} 行只有时间，请补充任务名称，例如“18:00 吃饭”`
  }
  if (entry.errorCode === 'invalid_time') {
    return `第 ${entry.line} 行时间无效，请使用 00:00–23:59`
  }
  return `第 ${entry.line} 行${entry.error ? `：${entry.error}` : '无法识别'}`
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
      const hasTodayChecklistChild = view === 'today' && tasks.some((child) => (
        child.parentTaskId === task.id
        && taskChildKindOf(child, taskMap) === 'checklist'
        && isTodayTaskDefinition(child, todayISO, tasks, taskMap)
      ))
      if (view === 'longTerm' || hasTodayChecklistChild) {
        items.push({
          task,
          kind: 'plan',
          occurrenceDate: civilDateOf(task.startAt) ?? task.startDate ?? todayISO,
          occurrenceKey: 'plan',
          completed: false,
          overdue: false,
          subtitle: hasTodayChecklistChild ? '今日清单' : undefined,
        })
      }
      continue
    }
    // Timeline steps are itinerary data. They are projected by the Plan page
    // and previewed under their parent, never flattened into checkable tasks.
    if (taskChildKindOf(task, taskMap) === 'timeline') continue
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
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [recurrence, setRecurrence] = useState<Recurrence | undefined>()
  const [categoryId, setCategoryId] = useState<string>('')
  const [planId, setPlanId] = useState('')
  const [planPickerOpen, setPlanPickerOpen] = useState(false)
  const [scope, setScope] = useState<TaskView>(
    () => taskViewFromStorage(localStorage.getItem('taskPrimaryViewV1') ?? localStorage.getItem('taskScope')),
  )
  const [fixed, setFixed] = useState(false)
  const [scheduleType, setScheduleType] = useState<TaskScheduleType>(
    () => scope === 'today' ? 'today' : 'longTerm',
  )
  const [scheduleStart, setScheduleStart] = useState(() => todayLocalISO())
  const [scheduleDue, setScheduleDue] = useState('')
  const [showBeforeStart, setShowBeforeStart] = useState(false)
  const [surfaceDaysBeforeDue, setSurfaceDaysBeforeDue] = useState(3)
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [batchSettingsOpen, setBatchSettingsOpen] = useState(false)
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
  const [expandedParentIds, setExpandedParentIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [addingChildParentId, setAddingChildParentId] = useState('')
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
    const state = location.state as { openTaskComposer?: boolean; planId?: string } | null
    if (!state?.openTaskComposer) return
    if (state.planId) setPlanId(state.planId)
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
  const firstTimedEntryError = timedEntries.find((entry) => entry.error)
  const batchInputInvalid = Boolean(firstTimedEntryError)
  const batchValidationMessage = firstTimedEntryError
    ? timedBatchErrorMessage(firstTimedEntryError)
    : ''
  const selectedPlan = activePlans.find((plan) => plan.id === planId)
  const batchContentSummary = !planId
    ? '独立任务'
    : timedEntries.every((entry) => Boolean(entry.time))
      ? '时间步骤'
      : timedEntries.some((entry) => Boolean(entry.time))
        ? '时间步骤与子任务'
        : '清单子任务'
  const selectedCategoryName = categories?.find((category) => category.id === categoryId)?.name
  const batchSettingsSummary = fixed
    ? describeRecurrence(recurrence ?? defaultFixedRecurrence('daily'))
    : [
        scheduleType === 'today' ? '今日任务' : scheduleType === 'longTerm' ? '长期任务' : '暂不排期',
        selectedCategoryName,
        scheduleDue ? '已设 DDL' : undefined,
      ].filter(Boolean).join(' · ')
  const items =
    tasks && records ? buildItems(tasks, records, todayISO, scope) : undefined
  const keyOf = (i: TodayItem) => `${i.task.id}:${i.occurrenceKey}`
  const projectedItems = useMemo(
    () => items ? applyTaskViewSettings(items, viewSettings) : undefined,
    [items, viewSettings],
  )
  const hiddenTaskIds = useMemo(() => {
    const hidden = new Set<string>()
    const visibleTaskIds = new Set(projectedItems?.map((item) => item.task.id) ?? [])
    const stack = [...childrenByParent.keys()].filter((parentId) =>
      visibleTaskIds.has(parentId) && !expandedParentIds.has(parentId))
    while (stack.length > 0) {
      const parentId = stack.pop()!
      for (const child of childrenByParent.get(parentId) ?? []) {
        if (hidden.has(child.id)) continue
        hidden.add(child.id)
        stack.push(child.id)
      }
    }
    return hidden
  }, [childrenByParent, expandedParentIds, projectedItems])
  const pending =
    projectedItems?.filter((i) =>
      !hiddenTaskIds.has(i.task.id) &&
      (!i.completed || recentlyDone.has(keyOf(i)))) ?? []
  const done =
    projectedItems?.filter((i) =>
      !hiddenTaskIds.has(i.task.id) &&
      i.completed &&
      !recentlyDone.has(keyOf(i))) ?? []
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
        planId: planId || undefined,
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
        setFixed(false)
        setRecurrence(undefined)
        setCategoryId('')
        setPlanId('')
        setComposerOpen(false)
        setScheduleType(scope === 'today' ? 'today' : 'longTerm')
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
    const directChildren = childrenByParent.get(item.task.id) ?? []
    const progress = childProgress(
      item.task.id,
      tasks ?? [],
      currentCompletedTaskIds,
    ) ?? (directChildren.length > 0 ? {
      completed: directChildren.filter((child) => currentCompletedTaskIds.has(child.id)).length,
      total: directChildren.length,
    } : undefined)
    const collapsible = directChildren.length > 0
    const expanded = expandedParentIds.has(item.task.id)
    const timelinePreview = directChildren
      .filter((child) => taskChildKindOf(child, taskMap) === 'timeline')
      .sort((a, b) => (a.startAt ?? '').localeCompare(b.startAt ?? ''))
      .map((child) => ({
        id: child.id,
        time: child.startAt?.slice(11, 16) ?? '',
        title: child.title,
        completed: currentCompletedTaskIds.has(child.id),
        onToggle: (() => {
          const childItem = (items ?? []).find((candidate) =>
            candidate.task.id === child.id &&
            candidate.kind !== 'plan' &&
            candidate.kind !== 'template')
          if (!childItem) return undefined
          return () => {
            void guarded(() => setEditedItemStatus(
              childItem,
              childItem.completed ? 'pending' : 'completed',
            ))
          }
        })(),
      }))
    const subtitle =
      [
        item.kind === 'plan' ? undefined : item.kind === 'single' ? '普通' : item.kind === 'template' ? '长期' : '固定',
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
        completed={item.kind === 'plan' && progress
          ? progress.total > 0 && progress.completed === progress.total
          : item.completed}
        organizational={item.kind === 'plan'}
        completionDisabled={item.kind === 'template' && Boolean(item.task.recurrence || taskScopeOf(item.task) === 'weekly')}
        overdue={item.overdue}
        nestingLevel={nestingLevel}
        childProgress={progress}
        timelinePreview={expanded ? timelinePreview : []}
        collapsible={collapsible}
        expanded={expanded}
        onToggleExpanded={collapsible ? () => {
          setExpandedParentIds((current) => {
            const next = new Set(current)
            if (next.has(item.task.id)) next.delete(item.task.id)
            else next.add(item.task.id)
            return next
          })
        } : undefined}
        onAddChild={item.kind === 'plan' ? () => {
          setExpandedParentIds((current) => new Set(current).add(item.task.id))
          setAddingChildParentId(item.task.id)
        } : undefined}
        groupContent={addingChildParentId === item.task.id ? (
          <InlinePlanChildComposer
            parent={item.task}
            tasks={tasks ?? []}
            scheduleType={effectiveTaskSchedule(item.task, taskMap).type}
            onCancel={() => setAddingChildParentId('')}
            onSaved={(created) => {
              setAddingChildParentId('')
              setFeedback(`已向“${item.task.title}”添加 ${created} 项`)
            }}
          />
        ) : undefined}
        actions={item.kind === 'plan' && collapsible
          ? {
              ...actionsFor(item),
              onToggle: () => { void toggleGroupChildren(item.task.id) },
            }
          : actionsFor(item)}
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

  async function toggleGroupChildren(parentId: string) {
    const childIds = new Set((childrenByParent.get(parentId) ?? []).map((child) => child.id))
    const childItems = (items ?? []).filter(
      (item) => childIds.has(item.task.id) && item.kind !== 'plan' && item.kind !== 'template',
    )
    if (childItems.length === 0) return
    const shouldComplete = childItems.some((item) => !item.completed)
    for (const child of childItems) {
      if (child.completed === shouldComplete) continue
      await guarded(() => setEditedItemStatus(
        child,
        shouldComplete ? 'completed' : 'pending',
      ))
    }
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
        <div className="task-composer-input-block">
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
            aria-describedby="task-batch-hint"
            aria-errormessage={firstTimedEntryError ? `task-batch-error-${firstTimedEntryError.line}` : undefined}
            aria-invalid={firstTimedEntryError ? true : undefined}
            className="task-composer-input min-h-11 min-w-0 resize-none rounded-xl bg-transparent px-3
              py-2.5 text-[16px] leading-6 outline-none placeholder:text-neutral-400"
          />
        </div>
        <p id="task-batch-hint" className="batch-input-hint">
          <span className="mobile-composer-hint">可在行首输入 8.30 或 08:30</span>
          <span className="desktop-composer-hint">每行一个任务 · 行首时间可选 · ⌘/Ctrl + Enter 添加全部</span>
        </p>
        {timedEntries.some((entry) => entry.time || entry.error) && (
          <div className="task-batch-preview" aria-label="批量任务解析预览" aria-live="polite">
            {timedEntries.map((entry) => (
              <span key={`${entry.line}:${entry.value}`} data-error={entry.error || undefined}>
                <b>{entry.time ?? (entry.error ? '!' : '—')}</b>
                <span className="task-batch-preview-copy">
                  <strong>{entry.title || entry.value}</strong>
                  {entry.error && <em id={`task-batch-error-${entry.line}`}>{timedBatchErrorMessage(entry)}</em>}
                </span>
              </span>
            ))}
          </div>
        )}
        {title.trim() && <div className="task-quick-primary-fields">
          <div className="task-plan-picker">
            <span>归属对象</span>
            <button type="button" className="task-plan-picker-button" onClick={() => setPlanPickerOpen(true)}>
              <span>{selectedPlan?.title ?? '不加入计划'}</span>
              <AppIcon name="chevronRight" size={16} />
            </button>
            <small>{batchContentSummary}</small>
          </div>
          {scheduleType !== 'unscheduled' && <label className="task-plan-picker">
            <span>{scheduleType === 'longTerm' ? '开始日期' : '日期'}</span>
            <input type="date" value={scheduleStart} onChange={(event) => setScheduleStart(event.target.value)} />
          </label>}
        </div>}
        <button
          type="button"
          className="task-batch-settings-trigger"
          onClick={() => setBatchSettingsOpen(true)}
        >
          <AppIcon name="filter" size={18} />
          <span>
            <strong>批量设置</strong>
            <small>{batchSettingsSummary}</small>
          </span>
          <AppIcon name="chevronRight" size={16} />
        </button>
        <div className="task-composer-footer">
          <span
            id="task-batch-status"
            className="task-composer-status"
            data-error={batchValidationMessage || undefined}
            role={batchValidationMessage ? 'alert' : 'status'}
            aria-live="polite"
          >
            {firstTimedEntryError
              ? '请修正上方内容'
              : batchValidationMessage || (timedEntries.length > 0
              ? `准备添加 ${timedEntries.length} 项`
              : '')}
          </span>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!title.trim() || submitting || batchInputInvalid}
            className="primary-action task-composer-submit"
          >
            <AppIcon name="plus" size={18} />
            <span>{submitting
              ? '添加中…'
              : timedEntries.length > 0
                ? `添加 ${timedEntries.length} 项`
                : '添加任务'}</span>
          </button>
        </div>
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
      {batchSettingsOpen && (
        <BatchTaskSettingsSheet
          fixed={fixed}
          recurrence={recurrence}
          categories={categories ?? []}
          categoryId={categoryId}
          scheduleType={scheduleType}
          scheduleStart={scheduleStart}
          scheduleDue={scheduleDue}
          showBeforeStart={showBeforeStart}
          surfaceDaysBeforeDue={surfaceDaysBeforeDue}
          onTaskTypeChange={setTaskType}
          onRecurrenceChange={setRecurrence}
          onCategoryChange={setCategoryId}
          onScheduleTypeChange={selectScheduleType}
          onScheduleDueChange={setScheduleDue}
          onShowBeforeStartChange={setShowBeforeStart}
          onSurfaceDaysBeforeDueChange={setSurfaceDaysBeforeDue}
          onManageCategories={() => {
            setBatchSettingsOpen(false)
            navigate('/browse')
          }}
          onClose={() => setBatchSettingsOpen(false)}
        />
      )}
      {planPickerOpen && (
        <TaskPlanPickerSheet
          plans={activePlans}
          selectedId={planId}
          startDate={scheduleStart || todayISO}
          onSelect={setPlanId}
          onClose={() => setPlanPickerOpen(false)}
          onFeedback={setFeedback}
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
