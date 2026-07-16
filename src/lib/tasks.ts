import {
  db,
  type ColorToken,
  type MarkerSymbol,
  type Task,
  type TaskScope,
} from './db'
import { type Recurrence, nextAfterCompletion } from './recurrence'
import { todayLocalISO } from './dates'
import { appendRank, betweenRanks, isFiKey, normalizedRanks } from './rank'
import { parseBatchLines } from './batch'
import { periodAnchorISO } from './taskPeriods'

const now = () => new Date().toISOString()
const today = todayLocalISO // 本地民用日期，不是 UTC（v4.2 §7.5）

export class RecurrenceConflictError extends Error {
  constructor() {
    super('周期状态需要确认：另一台设备可能已推进本期')
    this.name = 'RecurrenceConflictError'
  }
}

export async function addTask(
  title: string,
  recurrence?: Recurrence,
  categoryId?: string,
  startDate?: string, // 缺省 = 今天（本地民用日期）
  taskScope: TaskScope = 'daily',
): Promise<void> {
  await addTasks([title], recurrence, categoryId, startDate, taskScope)
}

/** 原子批量新增：保持行序、保留重复标题，失败时整批回滚。 */
export async function addTasks(
  titles: string[] | string,
  recurrence?: Recurrence,
  categoryId?: string,
  startDate?: string,
  taskScope: TaskScope = 'daily',
): Promise<number> {
  const clean = Array.isArray(titles)
    ? titles.map((title) => title.trim()).filter(Boolean)
    : parseBatchLines(titles)
  if (clean.length === 0) return 0

  return db.transaction('rw', db.tasks, async () => {
    const active = await db.tasks
      .where('lifecycleStatus')
      .equals('active')
      .sortBy('rank')
    const last = active.at(-1)
    let rank = last?.rank
    const fallbackBase = Date.now()
    const anchor = periodAnchorISO(taskScope, startDate ?? today())
    const t = now()
    const rows: Task[] = clean.map((title, index) => {
      rank = rank === undefined || isFiKey(rank)
        ? appendRank(rank)
        : (fallbackBase + index).toString(36).padStart(10, '0')
      return {
        id: crypto.randomUUID(),
        title,
        rank,
        startDate: anchor,
        taskScope,
        lifecycleStatus: 'active',
        templateVersion: 1,
        createdAt: t,
        updatedAt: t,
        ...(categoryId && { categoryId }),
        ...(recurrence && { recurrence }),
        ...(recurrence?.mode === 'after_completion' && {
          currentSequence: 1,
          nextDueDate: anchor,
        }),
      }
    })
    await db.tasks.bulkAdd(rows)
    return rows.length
  })
}

export async function renameTask(id: string, title: string): Promise<void> {
  const trimmed = title.trim()
  if (!trimmed) return
  // 只提交变化字段（v4.2 §6.3：禁整对象 put 覆盖）
  await db.tasks.update(id, { title: trimmed, updatedAt: now() })
}

/** 日历编辑器使用的局部更新：只覆盖用户实际可编辑的现有字段。 */
export async function updateTask(
  id: string,
  changes: {
    title: string
    notes?: string
    categoryId?: string
    startDate: string
    endDate?: string
    taskScope?: TaskScope
    visualToken?: ColorToken
    markerSymbol?: MarkerSymbol
  },
): Promise<void> {
  const title = changes.title.trim()
  if (!title) throw new Error('标题不能为空')
  if (changes.endDate && changes.endDate < changes.startDate) {
    throw new Error('结束日期不能早于开始日期')
  }
  await db.tasks.update(id, {
    title,
    notes: changes.notes?.trim() || undefined,
    categoryId: changes.categoryId || undefined,
    startDate: changes.startDate,
    endDate: changes.endDate || undefined,
    taskScope: changes.taskScope ?? 'daily',
    visualToken: changes.visualToken,
    markerSymbol: changes.markerSymbol,
    updatedAt: now(),
  })
}

export async function softDeleteTask(id: string): Promise<void> {
  await db.tasks.update(id, {
    lifecycleStatus: 'deleted',
    deletedAt: now(),
    updatedAt: now(),
  })
}

/* ---------- 完成记录（确定性主键，v4.2 §7.1） ----------
 * occurrenceKey：'single' | `fixed:${原计划日期}` | `ac:${sequence}`
 * recordId = `${taskId}:${occurrenceKey}`（key 内不含 taskId）
 */

async function upsertRecord(
  task: Task,
  occurrenceKey: string,
  occurrenceDate: string,
  resolution: 'completed' | 'skipped',
): Promise<void> {
  const t = now()
  const id = `${task.id}:${occurrenceKey}`
  // 完成当时的分类快照：分类删除/改名后历史仍如实（v4.2 §6）
  const category = task.categoryId
    ? await db.categories.get(task.categoryId)
    : undefined
  const snapshot = {
    titleSnapshot: task.title,
    ...(task.categoryId && { categoryIdSnapshot: task.categoryId }),
    ...(category && { categoryNameSnapshot: category.name }),
  }
  const completedDate = resolution === 'completed' ? today() : undefined
  const existing = await db.completionRecords.get(id)
  if (existing) {
    await db.completionRecords.update(id, {
      resolution,
      resolvedAt: t,
      ...(completedDate && { completedDate }),
      ...snapshot,
      updatedAt: t,
    })
  } else {
    await db.completionRecords.add({
      id,
      taskId: task.id,
      occurrenceKey,
      occurrenceDate,
      resolution,
      resolvedAt: t,
      ...(completedDate && { completedDate }),
      ...snapshot,
      templateVersion: task.templateVersion,
      createdAt: t,
      updatedAt: t,
    })
  }
}

/** 普通任务完成 */
export async function completeTask(task: Task): Promise<void> {
  await upsertRecord(task, 'single', task.startDate ?? today(), 'completed')
}

/** fixed 周期某一期完成（occurrenceDate = 原计划日期，改期不改 key） */
export async function completeFixedOccurrence(
  task: Task,
  occurrenceDate: string,
): Promise<void> {
  await upsertRecord(task, `fixed:${occurrenceDate}`, occurrenceDate, 'completed')
}

/** fixed 周期某一期跳过（决策表 #7：跳过写 skipped 记录，不影响其他期） */
export async function skipFixedOccurrence(
  task: Task,
  occurrenceDate: string,
): Promise<void> {
  await upsertRecord(task, `fixed:${occurrenceDate}`, occurrenceDate, 'skipped')
}

/** 取消完成 = 同一条记录置 voided，不删除（v4.2 §8.1） */
export async function voidRecord(recordId: string): Promise<void> {
  await db.completionRecords.update(recordId, {
    resolution: 'voided',
    updatedAt: now(),
  })
}

/* ---------- after_completion：条件事务推进（v4.2 §7.3） ----------
 * 确定性 ID 只保证不产生两条记录；防止两台离线设备各自推进 currentSequence
 * 必须靠 [id+currentSequence] 前置条件 + 对象形式 modify（服务器可重放）。
 */

export async function resolveAfterCompletion(
  task: Task,
  resolution: 'completed' | 'skipped',
): Promise<void> {
  const rule = task.recurrence
  if (rule?.mode !== 'after_completion') throw new Error('任务类型不符')
  const seq = task.currentSequence ?? 1
  const dueDate = task.nextDueDate ?? today()
  // 完成从实际完成日起算；跳过从原定日起算（不奖励拖延）
  const base = resolution === 'completed' ? today() : dueDate
  const nextDue = nextAfterCompletion(rule, base)

  await db.transaction('rw', db.tasks, db.completionRecords, db.categories, async () => {
    await upsertRecord(task, `ac:${seq}`, dueDate, resolution)
    const changed = await db.tasks
      .where('[id+currentSequence]')
      .equals([task.id, seq])
      .modify({
        currentSequence: seq + 1,
        nextDueDate: nextDue,
        updatedAt: now(),
      })
    if (changed !== 1) throw new RecurrenceConflictError()
  })
}

/** 撤销最近一期（仅允许最近，v4.2 决策表；同样走条件事务） */
export async function undoAfterCompletion(task: Task): Promise<void> {
  const seq = (task.currentSequence ?? 1) - 1
  if (seq < 1) return
  const record = await db.completionRecords.get(`${task.id}:ac:${seq}`)
  if (!record || record.resolution === 'voided') return

  await db.transaction('rw', db.tasks, db.completionRecords, async () => {
    const changed = await db.tasks
      .where('[id+currentSequence]')
      .equals([task.id, seq + 1])
      .modify({
        currentSequence: seq,
        nextDueDate: record.occurrenceDate,
        updatedAt: now(),
      })
    if (changed !== 1) throw new RecurrenceConflictError()
    await db.completionRecords.update(record.id, {
      resolution: 'voided',
      updatedAt: now(),
    })
  })
}

/**
 * 拖拽重排（MS7）：常态只写一条 rank；
 * 首次遇到旧格式键时在同一事务内做一次全表规范化，再落目标 rank。
 */
export async function reorderTask(
  taskId: string,
  beforeRank: string | null, // 新位置前一行的 rank（无=移到最前）
  afterRank: string | null, //  新位置后一行的 rank（无=移到最后）
): Promise<void> {
  try {
    const rank = betweenRanks(beforeRank, afterRank)
    await db.tasks.update(taskId, { rank, updatedAt: now() })
  } catch {
    // 旧 base36 时间戳键与 fractional 键混存 → 一次性规范化后重试
    await db.transaction('rw', db.tasks, async () => {
      const active = await db.tasks
        .where('lifecycleStatus')
        .equals('active')
        .sortBy('rank')
      const moving = active.find((t) => t.id === taskId)
      if (!moving) return
      const rest = active.filter((t) => t.id !== taskId)
      const beforeIdx =
        beforeRank === null ? -1 : rest.findIndex((t) => t.rank === beforeRank)
      const order = [
        ...rest.slice(0, beforeIdx + 1),
        moving,
        ...rest.slice(beforeIdx + 1),
      ]
      const keys = normalizedRanks(order.length)
      const t = now()
      for (let i = 0; i < order.length; i++) {
        await db.tasks.update(order[i].id, { rank: keys[i], updatedAt: t })
      }
    })
  }
}

/** cache_mismatch 自动修复：只重写缓存字段，永不动记录（v4.2 §7.4） */
export async function repairAfterCompletionCache(
  taskId: string,
  expectedSequence: number,
  expectedNextDueDate: string,
): Promise<void> {
  await db.tasks.update(taskId, {
    currentSequence: expectedSequence,
    nextDueDate: expectedNextDueDate,
    updatedAt: now(),
  })
}
