import { db, type Task } from './db'

const now = () => new Date().toISOString()
const today = () => new Date().toISOString().slice(0, 10)

/** 追加式 rank：MS7 引入拖拽时换 fractional indexing，排序语义兼容 */
const nextRank = () => Date.now().toString(36).padStart(10, '0')

export async function addTask(title: string): Promise<void> {
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

/** 普通任务完成：确定性主键 `${taskId}:single` 的三态记录（v4.2 §8.1） */
export async function completeTask(task: Task): Promise<void> {
  const t = now()
  const existing = await db.completionRecords.get(`${task.id}:single`)
  if (existing) {
    await db.completionRecords.update(existing.id, {
      resolution: 'completed',
      resolvedAt: t,
      titleSnapshot: task.title,
      updatedAt: t,
    })
  } else {
    await db.completionRecords.add({
      id: `${task.id}:single`,
      taskId: task.id,
      occurrenceKey: 'single',
      occurrenceDate: task.startDate ?? t.slice(0, 10),
      resolution: 'completed',
      resolvedAt: t,
      titleSnapshot: task.title,
      templateVersion: task.templateVersion,
      createdAt: t,
      updatedAt: t,
    })
  }
}

/** 取消完成 = 同一条记录置 voided，不删除（v4.2 §8.1） */
export async function uncompleteTask(taskId: string): Promise<void> {
  await db.completionRecords.update(`${taskId}:single`, {
    resolution: 'voided',
    updatedAt: now(),
  })
}
