import { db, type Task } from './db'
import { type Recurrence, nextAfterCompletion } from './recurrence'
import { todayLocalISO } from './dates'

const now = () => new Date().toISOString()
const today = todayLocalISO // 本地民用日期，不是 UTC（v4.2 §7.5）

/** 追加式 rank：MS7 引入拖拽时换 fractional indexing，排序语义兼容 */
const nextRank = () => Date.now().toString(36).padStart(10, '0')

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
): Promise<void> {
  const trimmed = title.trim()
  if (!trimmed) return
  const t = now()
  const task: Task = {
    id: crypto.randomUUID(),
    title: trimmed,
    rank: nextRank(),
    startDate: today(),
    lifecycleStatus: 'active',
    templateVersion: 1,
    createdAt: t,
    updatedAt: t,
    ...(categoryId && { categoryId }),
    ...(recurrence && { recurrence }),
    ...(recurrence?.mode === 'after_completion' && {
      currentSequence: 1,
      nextDueDate: today(),
    }),
  }
  await db.tasks.add(task)
}

export async function renameTask(id: string, title: string): Promise<void> {
  const trimmed = title.trim()
  if (!trimmed) return
  // 只提交变化字段（v4.2 §6.3：禁整对象 put 覆盖）
  await db.tasks.update(id, { title: trimmed, updatedAt: now() })
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
