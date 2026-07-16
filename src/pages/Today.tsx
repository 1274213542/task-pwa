import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
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
import { db, type Category, type CompletionRecord, type Task } from '../lib/db'
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
  addTask,
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
): TodayItem[] {
  const recMap = new Map(records.map((r) => [r.id, r]))
  const items: TodayItem[] = []

  for (const task of tasks) {
    const r = task.recurrence
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
      opacity: isDragging ? 0.6 : 1,
    },
    dragProps: { ...attributes, ...listeners },
    selected,
    onMetaClick,
  })
}

export default function Today() {
  const [title, setTitle] = useState('')
  const [recurrence, setRecurrence] = useState<Recurrence | undefined>()
  const [categoryId, setCategoryId] = useState<string>('')
  const [showDone, setShowDone] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
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
    tasks && records ? buildItems(tasks, records, todayISO) : undefined
  const pending = items?.filter((i) => !i.completed) ?? []
  const done = items?.filter((i) => i.completed) ?? []

  const dateLabel = new Date().toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })

  async function submit() {
    await addTask(title, recurrence, categoryId || undefined)
    setTitle('')
    setRecurrence(undefined)
    setCategoryId('')
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
          if (item.kind === 'single') {
            item.completed
              ? await voidRecord(`${task.id}:single`)
              : await completeTask(task)
          } else if (item.kind === 'fixed') {
            item.completed
              ? await voidRecord(`${task.id}:${item.occurrenceKey}`)
              : await completeFixedOccurrence(task, item.occurrenceDate)
          } else {
            item.completed
              ? await undoAfterCompletion(task)
              : await resolveAfterCompletion(task, 'completed')
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
      item.conflict ??
      (item.subtitle && catText
        ? `${catText} · ${item.subtitle}`
        : (item.subtitle ?? catText))
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
      next.has(taskId) ? next.delete(taskId) : next.add(taskId)
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

  function onDragEnd(e: DragEndEvent) {
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

  return (
    <section>
      <p className="text-[13px] font-medium text-neutral-500 dark:text-neutral-400">
        {dateLabel}
      </p>
      <h1 className="mt-0.5 text-3xl font-bold tracking-tight">今天</h1>

      <div className="mt-5">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            placeholder="添加任务…"
            enterKeyHint="done"
            className="min-w-0 flex-1 rounded-xl bg-white px-4 py-2.5 text-[16px]
              outline-none placeholder:text-neutral-400 dark:bg-neutral-800"
          />
          <button
            onClick={() => void submit()}
            disabled={!title.trim()}
            aria-label="添加"
            className="h-[42px] w-[42px] shrink-0 rounded-xl bg-[#007aff] text-xl
              text-white transition active:scale-95 disabled:opacity-40"
          >
            +
          </button>
        </div>
        {title.trim() && (
          <>
            <RecurrencePicker value={recurrence} onChange={setRecurrence} />
            {(categories?.length ?? 0) > 0 && (
              <select
                aria-label="分类"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="mt-2 rounded-lg bg-white px-2 py-1.5 text-[13px]
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

      {items === undefined ? null : pending.length + done.length === 0 ? (
        <div
          className="mt-8 rounded-2xl border border-dashed border-neutral-300 p-8
            text-center text-neutral-400 dark:border-neutral-700"
        >
          今天没有任务
        </div>
      ) : (
        <>
          {pending.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={pending.map((p) => p.task.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="mt-4 rounded-2xl bg-white px-3 dark:bg-neutral-800">
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
            </DndContext>
          )}

          {/* 桌面批量操作条（⌘click 多选，⌘↵ 完成） */}
          {selectedPending.length > 0 && (
            <div
              className="fixed inset-x-4 bottom-20 z-20 mx-auto flex max-w-md items-center
                justify-between gap-3 rounded-2xl bg-neutral-900/90 px-4 py-2.5 text-white
                shadow-lg backdrop-blur md:bottom-6"
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
            <ul className="mt-3 rounded-2xl bg-white px-3 dark:bg-neutral-800">
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
                <ul className="mt-2 rounded-2xl bg-white px-3 dark:bg-neutral-800">
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
