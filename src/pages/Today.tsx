import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
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
import { FOCUS_QUICK_ADD_EVENT } from '../App'
import {
  db,
  type Category,
  type CompletionRecord,
  type Task,
  type TaskScope,
} from '../lib/db'
import {
  type Recurrence,
  describeRecurrence,
  fixedOccurrencesInRange,
  latestFixedOnOrBefore,
} from '../lib/recurrence'
import { checkAfterCompletionIntegrity } from '../lib/integrity'
import { COLOR_TOKENS } from '../lib/categories'
import { addDaysISO, todayLocalISO } from '../lib/dates'
import {
  RecurrenceConflictError,
  addTasks,
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
import RecurrencePicker from '../components/RecurrencePicker'
import PageHeader from '../components/PageHeader'
import {
  defaultFixedRecurrence,
  taskScopeOf,
  weekEndISO,
  weekStartISO,
} from '../lib/taskPeriods'

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

function buildItems(
  tasks: Task[],
  records: CompletionRecord[],
  todayISO: string,
  scope: TaskScope,
): TodayItem[] {
  const recMap = new Map(records.map((r) => [r.id, r]))
  const items: TodayItem[] = []

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
      items.push({
        task,
        kind: 'single',
        occurrenceDate: task.startDate ?? todayISO,
        occurrenceKey: 'single',
        completed: rec?.resolution === 'completed',
        overdue: false,
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
  row: (item: TodayItem, extra?: object) => React.ReactNode
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
    selected,
    onMetaClick,
  })
}

export default function Today() {
  const [title, setTitle] = useState('')
  const [recurrence, setRecurrence] = useState<Recurrence | undefined>()
  const [categoryId, setCategoryId] = useState<string>('')
  const [scope, setScope] = useState<TaskScope>(
    () => (localStorage.getItem('taskScope') as TaskScope) || 'daily',
  )
  const [fixed, setFixed] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  // 完成感窗口（v4.2 §12）：勾选后原地保留 ~800ms 展示动画，再按策略归置
  const [recentlyDone, setRecentlyDone] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const submittingRef = useRef(false)

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
    const focus = () => inputRef.current?.focus()
    window.addEventListener(FOCUS_QUICK_ADD_EVENT, focus)
    return () => window.removeEventListener(FOCUS_QUICK_ADD_EVENT, focus)
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

  const todayISO = todayLocalISO() // 本地民用日期（v4.2 §7.5，勿用 UTC 切片）
  const catMap = new Map((categories ?? []).map((c) => [c.id, c]))
  const items =
    tasks && records ? buildItems(tasks, records, todayISO, scope) : undefined
  const keyOf = (i: TodayItem) => `${i.task.id}:${i.occurrenceKey}`
  const pending =
    items?.filter((i) => !i.completed || recentlyDone.has(keyOf(i))) ?? []
  const done =
    items?.filter((i) => i.completed && !recentlyDone.has(keyOf(i))) ?? []

  const dateLabel = new Date().toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })

  const weeklyRangeLabel = `${weekStartISO(todayISO).slice(5).replace('-', '/')} – ${weekEndISO(todayISO).slice(5).replace('-', '/')}`

  function switchScope(next: TaskScope) {
    setScope(next)
    localStorage.setItem('taskScope', next)
    if (fixed) setRecurrence(defaultFixedRecurrence(next))
    setFeedback('')
  }

  function setTaskType(nextFixed: boolean) {
    setFixed(nextFixed)
    setRecurrence(nextFixed ? defaultFixedRecurrence(scope) : undefined)
  }

  async function submit() {
    if (submittingRef.current || !title.trim()) return
    submittingRef.current = true
    setSubmitting(true)
    setFeedback('')
    try {
      const count = await addTasks(
        title,
        fixed ? (recurrence ?? defaultFixedRecurrence(scope)) : undefined,
        categoryId || undefined,
        undefined,
        scope,
      )
      setTitle('')
      setCategoryId('')
      setFeedback(count > 1 ? `已添加 ${count} 个任务` : '任务已添加')
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
      onToggle: () =>
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
        }),
      onSkip:
        item.kind === 'single' || item.completed || item.conflict
          ? undefined
          : () =>
              void guarded(async () => {
                if (item.kind === 'fixed') {
                  await skipFixedOccurrence(task, item.occurrenceDate)
                } else {
                  await resolveAfterCompletion(task, 'skipped')
                }
              }),
      // 两步确认由 TaskRow 承担；周期任务额外提供"仅本次"（=跳过本期）
      onDelete: () => void softDeleteTask(task.id),
      onDeleteOnce:
        task.recurrence && !item.completed && !item.conflict
          ? () =>
              void guarded(async () => {
                if (item.kind === 'fixed') {
                  await skipFixedOccurrence(task, item.occurrenceDate)
                } else {
                  await resolveAfterCompletion(task, 'skipped')
                }
              })
          : undefined,
      onRename:
        item.kind === 'single' || !item.completed
          ? (t: string) => void renameTask(task.id, t)
          : undefined,
    }
  }

  function rowFor(item: TodayItem, extra: object = {}) {
    const cat = item.task.categoryId ? catMap.get(item.task.categoryId) : undefined
    const catText = cat ? cat.name : undefined
    const subtitle =
      [item.kind === 'single' ? '普通' : '固定', item.conflict, catText, item.subtitle]
        .filter(Boolean)
        .join(' · ')
    return (
      <TaskRow
        key={`${item.task.id}:${item.occurrenceKey}`}
        title={item.task.title}
        subtitle={subtitle}
        dot={cat ? COLOR_TOKENS[cat.colorToken] : undefined}
        completed={item.completed}
        overdue={item.overdue}
        actions={actionsFor(item)}
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
        eyebrow={scope === 'daily' ? dateLabel : `本周 ${weeklyRangeLabel}`}
        actions={<div
          role="tablist"
          aria-label="任务周期"
          className="segmented-control flex rounded-xl bg-black/5 p-0.5 text-[13px] dark:bg-white/10"
        >
          {(['daily', 'weekly'] as const).map((value) => (
            <button
              key={value}
              role="tab"
              aria-selected={scope === value}
              onClick={() => switchScope(value)}
              className={`min-h-11 rounded-[10px] px-3.5 font-medium transition ${
                scope === value
                  ? 'is-active bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-white'
                  : 'text-neutral-500'
              }`}
            >
              {value === 'daily' ? '每日' : '每周'}
            </button>
          ))}
        </div>}
      />

      <div className="quick-card mt-4 rounded-2xl bg-white/70 p-2 shadow-sm ring-1 ring-black/5 dark:bg-neutral-800/70 dark:ring-white/5">
        <div className="flex items-center gap-2">
          <textarea
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void submit()
              }
            }}
            rows={1}
            placeholder="添加任务；多项可换行粘贴…"
            enterKeyHint="done"
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
            +
          </button>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 px-1 pb-1">
          <div className="flex rounded-lg bg-black/5 p-0.5 text-[12px] dark:bg-white/10">
            <button
              onClick={() => setTaskType(false)}
              aria-pressed={!fixed}
              className={`min-h-11 rounded-md px-2.5 ${!fixed ? 'bg-white shadow-sm dark:bg-neutral-700' : 'text-neutral-500'}`}
            >
              普通任务
            </button>
            <button
              onClick={() => setTaskType(true)}
              aria-pressed={fixed}
              className={`min-h-11 rounded-md px-2.5 ${fixed ? 'bg-white shadow-sm dark:bg-neutral-700' : 'text-neutral-500'}`}
            >
              固定任务
            </button>
          </div>
          {fixed && scope === 'daily' && title.trim() && (
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
        </div>
      </div>
      <p role="status" className="min-h-5 px-2 pt-1 text-[12px] text-neutral-500">
        {feedback}
      </p>

      {items === undefined ? null : pending.length + done.length === 0 ? (
        <div
          className="mt-8 rounded-2xl border border-dashed border-neutral-300 p-8
            text-center text-neutral-400 dark:border-neutral-700"
        >
          {scope === 'daily' ? '今天没有任务' : '本周没有任务'}
        </div>
      ) : (
        <>
          {pending.length > 0 && (
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
                <ul className="list-card mt-4 rounded-2xl bg-white px-3 dark:bg-neutral-800">
                  {pending.map((item) => (
                    <SortablePendingRow
                      key={`${item.task.id}:${item.occurrenceKey}`}
                      item={item}
                      row={rowFor}
                      selected={selectedIds.has(item.task.id)}
                      onMetaClick={() => toggleSelect(item.task.id)}
                    />
                  ))}
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
          {done.length > 0 && policy === 'keep' && (
            <ul className="list-card mt-3 rounded-2xl bg-white px-3 dark:bg-neutral-800">
              {done.map((i) => rowFor(i))}
            </ul>
          )}
          {done.length > 0 && policy === 'collapse' && (
            <div className="mt-3">
              <button
                onClick={() => setShowDone((s) => !s)}
                className="px-1 text-[13px] font-medium text-neutral-400"
              >
                {showDone ? '▾' : '▸'} 已完成 · {done.length}
              </button>
              {showDone && (
                <ul className="list-card mt-2 rounded-2xl bg-white px-3 dark:bg-neutral-800">
                  {done.map((i) => rowFor(i))}
                </ul>
              )}
            </div>
          )}
          {/* hide：不渲染，已完成记录页可查 */}
        </>
      )}
    </section>
  )
}
