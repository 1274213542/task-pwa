import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type CompletionRecord, type Task } from '../lib/db'
import {
  type Recurrence,
  describeRecurrence,
  latestFixedOnOrBefore,
} from '../lib/recurrence'
import { checkAfterCompletionIntegrity } from '../lib/integrity'
import {
  RecurrenceConflictError,
  addTask,
  completeFixedOccurrence,
  completeTask,
  renameTask,
  repairAfterCompletionCache,
  resolveAfterCompletion,
  skipFixedOccurrence,
  softDeleteTask,
  undoAfterCompletion,
  voidRecord,
} from '../lib/tasks'
import TaskRow from '../components/TaskRow'
import RecurrencePicker from '../components/RecurrencePicker'

/** 今天视图的投影条目（TaskOccurrenceView 的 MS3 子集） */
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
      const due = latestFixedOnOrBefore(r, task.startDate ?? todayISO, task.endDate, todayISO)
      if (!due) continue
      const rec = recMap.get(`${task.id}:fixed:${due}`)
      const resolved = rec && rec.resolution !== 'voided'
      // 已解决且不是今天的历史期不再占据今天视图
      if (resolved && due !== todayISO) continue
      items.push({
        task,
        kind: 'fixed',
        occurrenceDate: due,
        occurrenceKey: `fixed:${due}`,
        completed: rec?.resolution === 'completed',
        overdue: due < todayISO,
        subtitle:
          describeRecurrence(r) + (due < todayISO ? ` · 逾期（${due.slice(5)}）` : ''),
      })
    } else {
      // after_completion：完整性校验（v4.2 §7.4）
      const acRecords = records.filter(
        (x) => x.taskId === task.id && x.occurrenceKey.startsWith('ac:'),
      )
      const check = checkAfterCompletionIntegrity(task, acRecords)
      if (check.status === 'cache_mismatch') {
        // 缓存偏差：只重写缓存字段，火后即忘（永不动记录）
        void repairAfterCompletionCache(
          task.id,
          check.expectedSequence,
          check.expectedNextDueDate,
        )
        continue // liveQuery 修复后自动重渲
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
            describeRecurrence(r) + (due < todayISO ? ` · 逾期（${due.slice(5)}）` : ''),
        })
      }
      // 今天刚完成的一期保留显示（完成感窗口，勾选可撤销）——
      // 与"下一期是否到期"无关，必须在到期判断之外
      const prevSeq = (task.currentSequence ?? 1) - 1
      const prev = recMap.get(`${task.id}:ac:${prevSeq}`)
      if (
        prev?.resolution === 'completed' &&
        prev.resolvedAt.slice(0, 10) === todayISO
      ) {
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

export default function Today() {
  const [title, setTitle] = useState('')
  const [recurrence, setRecurrence] = useState<Recurrence | undefined>()

  const tasks = useLiveQuery(
    () => db.tasks.where('lifecycleStatus').equals('active').sortBy('rank'),
    [],
  )
  const records = useLiveQuery(() => db.completionRecords.toArray(), [])

  const todayISO = new Date().toISOString().slice(0, 10)
  const items =
    tasks && records ? buildItems(tasks, records, todayISO) : undefined

  const dateLabel = new Date().toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })

  async function submit() {
    await addTask(title, recurrence)
    setTitle('')
    setRecurrence(undefined)
  }

  async function guarded(fn: () => Promise<void>) {
    try {
      await fn()
    } catch (e) {
      if (e instanceof RecurrenceConflictError) {
        alert(e.message) // MS4 换 toast；冲突时不推进，历史已保留
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
      onDelete: () => {
        if (task.recurrence) {
          // v4.2 决策表 #10：周期任务删除必须区分。MS3 用两段式确认，MS4 换 sheet
          const wholeSeriesOk = confirm(
            '删除整个周期任务？\n（历史完成记录会保留；如只想跳过本次请点"取消"再用"跳过"）',
          )
          if (wholeSeriesOk) void softDeleteTask(task.id)
        } else {
          void softDeleteTask(task.id)
        }
      },
      onRename:
        item.kind === 'single' || !item.completed
          ? (t: string) => void renameTask(task.id, t)
          : undefined,
    }
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
          <RecurrencePicker value={recurrence} onChange={setRecurrence} />
        )}
      </div>

      {items === undefined ? null : items.length === 0 ? (
        <div
          className="mt-8 rounded-2xl border border-dashed border-neutral-300 p-8
            text-center text-neutral-400 dark:border-neutral-700"
        >
          今天没有任务
        </div>
      ) : (
        <ul className="mt-4 rounded-2xl bg-white px-3 dark:bg-neutral-800">
          {items.map((item) => (
            <TaskRow
              key={`${item.task.id}:${item.occurrenceKey}`}
              title={item.task.title}
              subtitle={item.conflict ?? item.subtitle}
              completed={item.completed}
              overdue={item.overdue}
              actions={actionsFor(item)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
