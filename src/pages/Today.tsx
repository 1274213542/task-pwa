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
import { CLOSE_TASK_MENU_EVENT, FOCUS_QUICK_ADD_EVENT } from '../lib/appEvents'
import {
  db,
  type Category,
  type CompletionRecord,
  type Task,
  type TaskScheduleType,
  type TaskScope,
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
  addTasksDetailed,
  completeFixedOccurrence,
  completeTask,
  renameTask,
  reorderTask,
  repairAfterCompletionCache,
  resolveAfterCompletion,
  skipFixedOccurrence,
  softDeleteTask,
  undoAfterCompletion,
  voidRecord,
} from '../lib/tasks'
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
  weekEndISO,
  weekStartISO,
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
  effectiveTaskSchedule,
  taskDueStatus,
  taskScheduleLabel,
} from '../lib/taskSchedule'

/** 今天视图的投影条目（TaskOccurrenceView 的子集） */
interface TodayItem {
  task: Task
  kind: 'single' | 'fixed' | 'ac'
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
}

function buildItems(
  tasks: Task[],
  records: CompletionRecord[],
  todayISO: string,
  scope: TaskScope,
): TodayItem[] {
  const recMap = new Map(records.map((r) => [r.id, r]))
  const items: TodayItem[] = []
  const taskMap = new Map(tasks.map((task) => [task.id, task]))

  for (const task of tasks) {
    if (taskScopeOf(task) !== scope) continue
    const r = task.recurrence
    if (scope === 'weekly') {
      const periodStart = weekStartISO(todayISO)
      const periodEnd = weekEndISO(todayISO)
      if (task.startDate && task.startDate > periodEnd) continue
      if (!r) {
        const rec = recMap.get(`${task.id}:single`)
        items.push({
          task,
          kind: 'single',
          occurrenceDate: task.startDate ?? periodStart,
          occurrenceKey: 'single',
          completed: rec?.resolution === 'completed',
          overdue: false,
        })
      } else {
        if (task.endDate && task.endDate < periodStart) continue
        const occurrenceKey = `fixed:${periodStart}`
        const rec = recMap.get(`${task.id}:${occurrenceKey}`)
        items.push({
          task,
          kind: 'fixed',
          occurrenceDate: periodStart,
          occurrenceKey,
          completed: rec?.resolution === 'completed',
          overdue: false,
          subtitle: '每周 · 周一更新',
        })
      }
      continue
    }
    if (!r) {
      const rec = recMap.get(`${task.id}:single`)
      const schedule = effectiveTaskSchedule(task, taskMap)
      const due = taskDueStatus(task, todayISO, taskMap, rec?.resolution === 'completed' ? rec.resolvedAt : undefined)
      items.push({
        task,
        kind: 'single',
        occurrenceDate: task.startDate ?? todayISO,
        occurrenceKey: 'single',
        completed: rec?.resolution === 'completed',
        overdue: due.tone === 'overdue',
        subtitle: taskScheduleLabel(
          task,
          todayISO,
          tasks,
          rec?.resolution === 'completed' ? rec.resolvedAt : undefined,
        ) + (schedule.inheritedFrom ? ' · 继承父任务日期' : ''),
      })
    } else if (r.mode === 'fixed_schedule') {
      const start = task.startDate ?? todayISO
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
  return items
}

function SortablePendingRow({
  item,
  row,
  selected,
  onMetaClick,
}: {
  item: TodayItem
  row: (item: TodayItem, extra?: TaskRowProjectionExtra) => React.ReactNode
  selected: boolean
  onMetaClick: () => void
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
  })
}

export default function Today() {
  const reduceMotion = useReducedMotion()
  const location = useLocation()
  const [title, setTitle] = useState('')
  const [recurrence, setRecurrence] = useState<Recurrence | undefined>()
  const [categoryId, setCategoryId] = useState<string>('')
  const [scope, setScope] = useState<TaskScope>(
    () => (localStorage.getItem('taskScope') as TaskScope) || 'daily',
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  // A task menu is a page-level transient surface: task rows never own an
  // independent open state, so menus cannot accumulate on top of each other.
  const [openMenuTaskId, setOpenMenuTaskId] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<TodayItem | null>(null)
  // 完成感窗口（v4.2 §12）：勾选后原地保留 ~800ms 展示动画，再按策略归置
  const [recentlyDone, setRecentlyDone] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const toolbarSentinelRef = useRef<HTMLDivElement>(null)
  const submittingRef = useRef(false)
  const syncingPeriodRef = useRef(false)
  const scrollPositionsRef = useRef<Record<TaskScope, number>>({ daily: 0, weekly: 0 })

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
      setOpenMenuTaskId(null)
      setComposerOpen(true)
      window.requestAnimationFrame(() => inputRef.current?.focus())
    }
    window.addEventListener(FOCUS_QUICK_ADD_EVENT, focus)
    return () => window.removeEventListener(FOCUS_QUICK_ADD_EVENT, focus)
  }, [])

  useEffect(() => {
    if (!(location.state as { openTaskComposer?: boolean } | null)?.openTaskComposer) return
    setOpenMenuTaskId(null)
    setComposerOpen(true)
    window.requestAnimationFrame(() => inputRef.current?.focus())
    window.history.replaceState(
      { ...window.history.state, usr: null },
      '',
      window.location.href,
    )
  }, [location.state])

  useEffect(() => {
    const closeMenu = () => setOpenMenuTaskId(null)
    window.addEventListener(CLOSE_TASK_MENU_EVENT, closeMenu)
    return () => window.removeEventListener(CLOSE_TASK_MENU_EVENT, closeMenu)
  }, [])

  useEffect(() => {
    const closeMenu = () => setOpenMenuTaskId(null)
    const closeWhenHidden = () => {
      if (document.visibilityState !== 'visible') closeMenu()
    }
    // Capture catches the actual scrolling element on both Safari and the PWA
    // shell without changing the list's own scroll physics.
    window.addEventListener('scroll', closeMenu, true)
    window.addEventListener('blur', closeMenu)
    document.addEventListener('visibilitychange', closeWhenHidden)
    return () => {
      window.removeEventListener('scroll', closeMenu, true)
      window.removeEventListener('blur', closeMenu)
      document.removeEventListener('visibilitychange', closeWhenHidden)
    }
  }, [])

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
  const allDoneCount = items?.filter((item) => item.completed).length ?? 0
  const taskCounts = {
    daily: tasks?.filter((task) => taskScopeOf(task) === 'daily').length ?? 0,
    weekly: tasks?.filter((task) => taskScopeOf(task) === 'weekly').length ?? 0,
  }
  const activeSettingCount = activeTaskViewSettingCount(viewSettings)
  const completedDisplayPolicy =
    viewSettings.showCompleted || viewSettings.status === 'completed'
      ? policy === 'hide' ? 'keep' : policy
      : 'hide'

  const dateLabel = new Date().toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })

  const weeklyRangeLabel = `${weekStartISO(todayISO).slice(5).replace('-', '/')} – ${weekEndISO(todayISO).slice(5).replace('-', '/')}`

  function switchScope(next: TaskScope) {
    if (next === scope) return
    setOpenMenuTaskId(null)
    setViewSettingsOpen(false)
    setContentDirection(next === 'weekly' ? 1 : -1)
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
    localStorage.setItem('taskScope', next)
    if (fixed) setRecurrence(defaultFixedRecurrence(next))
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
    setOpenMenuTaskId(null)
    setFixed(nextFixed)
    setRecurrence(nextFixed ? defaultFixedRecurrence(scope) : undefined)
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
    setOpenMenuTaskId(null)
    setFeedback(scope === 'daily' ? '正在同步今日固定任务…' : '正在同步本周固定任务…')
    try {
      const result = await synchronizeTaskPeriod(scope, todayISO)
      setFeedback(result.repairs.length > 0
        ? scope === 'daily'
          ? '已同步今日固定任务'
          : '已同步本周固定任务'
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
    if (submittingRef.current || !title.trim()) return
    submittingRef.current = true
    setSubmitting(true)
    setOpenMenuTaskId(null)
    setFeedback('')
    try {
      const result = await addTasksDetailed(
        title,
        fixed ? (recurrence ?? defaultFixedRecurrence(scope)) : undefined,
        categoryId || undefined,
        undefined,
        scope,
        fixed
          ? { scheduleType: 'today', startAt: todayISO }
          : {
              scheduleType,
              ...(scheduleType !== 'unscheduled' && { startAt: scheduleStart || todayISO }),
              ...(scheduleDue && { dueAt: scheduleDue }),
              showBeforeStart,
              surfaceDaysBeforeDue,
            },
      )
      if (result.created > 0) {
        setTitle('')
        setCategoryId('')
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
        setOpenMenuTaskId(null)
        setEditingItem(item)
      },
      onToggle: () => {
        setOpenMenuTaskId(null)
        void guarded(async () => {
          if (!item.completed) holdInPlace(`${task.id}:${item.occurrenceKey}`)
          if (item.kind === 'single') {
            if (item.completed) await voidRecord(`${task.id}:single`)
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
      onSkip:
        item.kind === 'single' || item.completed || item.conflict
          ? undefined
          : () => {
              setOpenMenuTaskId(null)
              void guarded(async () => {
                if (item.kind === 'fixed') {
                  await skipFixedOccurrence(task, item.occurrenceDate)
                } else {
                  await resolveAfterCompletion(task, 'skipped')
                }
              })
            },
      // 两步确认由 TaskRow 承担；周期任务额外提供"仅本次"（=跳过本期）
      onDelete: () => {
        setOpenMenuTaskId(null)
        void softDeleteTask(task.id)
      },
      onDeleteOnce:
        task.recurrence && !item.completed && !item.conflict
          ? () => {
              setOpenMenuTaskId(null)
              void guarded(async () => {
                if (item.kind === 'fixed') {
                  await skipFixedOccurrence(task, item.occurrenceDate)
                } else {
                  await resolveAfterCompletion(task, 'skipped')
                }
              })
            }
          : undefined,
      onRename:
        item.kind === 'single' || !item.completed
          ? (t: string) => {
              setOpenMenuTaskId(null)
              void renameTask(task.id, t)
            }
          : undefined,
    }
  }

  function rowFor(
    item: TodayItem,
    extra: TaskRowProjectionExtra = {},
  ) {
    const itemMenuId = keyOf(item)
    let nestingLevel = 0
    let parentId = item.task.parentTaskId
    const visitedParents = new Set<string>()
    while (parentId && !visitedParents.has(parentId) && nestingLevel < 4) {
      visitedParents.add(parentId)
      nestingLevel += 1
      parentId = tasks?.find((candidate) => candidate.id === parentId)?.parentTaskId
    }
    const cat = item.task.categoryId ? catMap.get(item.task.categoryId) : undefined
    const catText = cat ? cat.name : undefined
    const progress = childProgress(
      item.task.id,
      tasks ?? [],
      new Set((records ?? []).filter((record) => record.resolution === 'completed').map((record) => record.taskId)),
    )
    const subtitle =
      [
        item.kind === 'single' ? '普通' : '固定',
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
          item.task.visualToken ?? cat?.colorToken ?? (scope === 'weekly' ? 'purple' : 'green')
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
        overdue={item.overdue}
        nestingLevel={nestingLevel}
        actions={actionsFor(item)}
        menuOpen={openMenuTaskId === itemMenuId}
        menuId={`task-menu-${item.task.id}-${item.occurrenceKey}`}
        onMenuToggle={() =>
          setOpenMenuTaskId((current) => (current === itemMenuId ? null : itemMenuId))
        }
        onMenuClose={() => setOpenMenuTaskId(null)}
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
    if (item.kind === 'single') await completeTask(item.task)
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
    setOpenMenuTaskId(null)
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
        eyebrow={scope === 'daily' ? dateLabel : `本周 ${weeklyRangeLabel}`}
        actions={(
          <button
            type="button"
            aria-label={composerOpen ? '收起新增任务' : '新增任务'}
            aria-expanded={composerOpen}
            onClick={() => {
              setOpenMenuTaskId(null)
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
          setOpenMenuTaskId(null)
          setComposerOpen((open) => !open)
        }}
        primaryLabel={composerOpen ? '收起新增任务' : '新增任务'}
        primaryIcon={composerOpen ? 'chevronUp' : 'plus'}
      />

      <div ref={toolbarSentinelRef} className="task-toolbar-sentinel" aria-hidden />
      <TaskToolbar
        scope={scope}
        dailyCount={taskCounts.daily}
        weeklyCount={taskCounts.weekly}
        activeSettingCount={activeSettingCount}
        syncing={syncingPeriod}
        stuck={toolbarStuck}
        onScopeChange={switchScope}
        onOpenSettings={() => {
          setOpenMenuTaskId(null)
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
      <div
        className="task-date-context"
        aria-label={scope === 'daily' ? dateLabel : `本周 ${weeklyRangeLabel}`}
      >
        <span>{scope === 'daily' ? dateLabel : `本周 ${weeklyRangeLabel}`}</span>
      </div>

      <div className="task-progress-line" aria-label="任务进度">
        <span>{activeSettingCount > 0 ? '筛选结果' : scope === 'daily' ? '今日任务' : '本周任务'} {pending.length + done.length} 项</span>
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
            disabled={!title.trim() || submitting}
            aria-label="添加"
            className="primary-action h-11 w-11 shrink-0 rounded-xl text-xl
              text-white transition active:scale-95 disabled:opacity-40"
          >
            <AppIcon name="plus" size={23} />
          </button>
        </div>
        <p className="batch-input-hint">
          <span className="mobile-composer-hint">每行一个任务</span>
          <span className="desktop-composer-hint">Enter 换行 · ⌘/Ctrl + Enter 添加全部</span>
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2 px-1 pb-1">
          <div className="segmented-control task-type-switch text-[12px]" role="group" aria-label="任务类型">
            <button
              onClick={() => setTaskType(false)}
              aria-pressed={!fixed}
              className={!fixed ? 'is-active' : ''}
            >
              普通任务
            </button>
            <button
              onClick={() => setTaskType(true)}
              aria-pressed={fixed}
              className={fixed ? 'is-active' : ''}
            >
              固定任务
            </button>
          </div>
          {fixed && title.trim() && (
            <details className="w-full">
              <summary className="cursor-pointer px-1 text-[12px] text-neutral-400">
                调整重复周期
              </summary>
              <RecurrencePicker value={recurrence} onChange={setRecurrence} />
            </details>
          )}
          {title.trim() && (
            <>
            {(categories?.length ?? 0) > 0 && (
              <select
                aria-label="分类"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="min-h-11 rounded-xl bg-white px-2 py-1.5 text-[13px]
                  text-neutral-500 dark:bg-neutral-800"
              >
                <option value="">无分类</option>
                {categories!.map((c: Category) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              )}
            </>
          )}
          {!fixed && (
            <div className="task-schedule-composer" aria-label="任务时间设置">
              <div className="task-schedule-intent-heading">
                <span>先选择这件事的时间意图</span>
                <strong>{scheduleType === 'today' ? '今天' : scheduleType === 'longTerm' ? '长期' : '收集箱'}</strong>
              </div>
              <TaskIntentSelector value={scheduleType} onChange={selectScheduleType} compact />
              {scheduleType !== 'unscheduled' && (
                <label>
                  {scheduleType === 'today' ? '执行日期' : '开始日期'}
                  <input
                    type="date"
                    value={scheduleStart}
                    onChange={(event) => setScheduleStart(event.target.value)}
                  />
                </label>
              )}
              {scheduleType !== 'unscheduled' && (
                <label>
                  DDL（可选时间）
                  <input
                    type="datetime-local"
                    min={scheduleStart ? `${scheduleStart}T00:00` : undefined}
                    value={scheduleDue}
                    onChange={(event) => setScheduleDue(event.target.value)}
                  />
                </label>
              )}
              {scheduleType === 'longTerm' && (
                <details className="task-schedule-advanced">
                  <summary>高级显示规则</summary>
                  <label className="task-schedule-toggle">
                    <input
                      type="checkbox"
                      checked={showBeforeStart}
                      onChange={(event) => setShowBeforeStart(event.target.checked)}
                    />
                    开始日期前仍显示
                  </label>
                  <label>
                    提前进入近期
                    <span className="task-surface-days-input">
                      <input
                        type="number"
                        min={0}
                        max={90}
                        value={surfaceDaysBeforeDue}
                        onChange={(event) => setSurfaceDaysBeforeDue(Number(event.target.value) || 0)}
                      /> 天
                    </span>
                  </label>
                </details>
              )}
            </div>
          )}
        </div>
      </motion.div>}
      </AnimatePresence>
      <p role="status" className="min-h-5 px-2 pt-1 text-[12px] text-neutral-500">
        {feedback}
      </p>

      {items === undefined ? null : pending.length + done.length === 0 ? (
        <div className="task-empty-state">
          <MarkerIcon symbol={scope === 'daily' ? 'flower' : 'star'} color={scope === 'daily' ? 'green' : 'purple'} size={58} />
          <strong>{activeSettingCount > 0
            ? '没有符合筛选条件的任务'
            : scope === 'daily' ? '今天没有任务' : '本周没有任务'}</strong>
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
                  {pending.map((item) => (
                    <SortablePendingRow
                      key={`${item.task.id}:${item.occurrenceKey}`}
                      item={item}
                      row={rowFor}
                      selected={selectedIds.has(item.task.id)}
                      onMetaClick={() => toggleSelect(item.task.id)}
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
                {pending.map((item) => rowFor(item))}
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
                {done.map((i) => rowFor(i))}
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
                    {done.map((i) => rowFor(i))}
                  </AnimatePresence>
                </ul>
              )}
            </div>
          )}
          {/* hide：不渲染，已完成记录页可查 */}
        </LayoutGroup>
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
