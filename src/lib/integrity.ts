import type { CompletionRecord, Task } from './db'
import { type AfterCompletionRule, nextAfterCompletion } from './recurrence'

/**
 * after_completion 完整性校验（v4.2 §7.4）。
 * - cache_mismatch：currentSequence/nextDueDate 缓存与记录推导不符且推导唯一 → 自动重写缓存
 * - conflict：结构性冲突 → 保留全部记录、暂停自动推进、提示用户确认
 * 校验永不增删改 CompletionRecord。
 */
export type IntegrityResult =
  | { status: 'valid'; expectedSequence: number; expectedNextDueDate: string }
  | { status: 'cache_mismatch'; expectedSequence: number; expectedNextDueDate: string }
  | { status: 'conflict'; reason: string }

export function checkAfterCompletionIntegrity(
  task: Task,
  records: CompletionRecord[], // 该任务的全部 ac: 记录（含 voided）
): IntegrityResult {
  const rule = task.recurrence
  if (!rule || rule.mode !== 'after_completion') {
    return { status: 'conflict', reason: '任务不是完成后周期类型' }
  }

  const acRecords = records
    .filter((r) => r.occurrenceKey.startsWith('ac:'))
    .map((r) => ({ ...r, seq: Number(r.occurrenceKey.slice(3)) }))
    .sort((a, b) => a.seq - b.seq)

  // 结构冲突 1：sequence 跳号（非 voided 记录的序号必须连续从 1 起）
  const resolved = acRecords.filter((r) => r.resolution !== 'voided')
  for (let i = 0; i < resolved.length; i++) {
    if (resolved[i].seq !== i + 1) {
      return {
        status: 'conflict',
        reason: `完成记录序号不连续（期望 ${i + 1}，实际 ${resolved[i].seq}）`,
      }
    }
  }

  // 结构冲突 2：已 voided 的前一期之后仍存在已解决期
  const voidedSeqs = acRecords.filter((r) => r.resolution === 'voided').map((r) => r.seq)
  const maxResolved = resolved.length > 0 ? resolved[resolved.length - 1].seq : 0
  for (const v of voidedSeqs) {
    if (v < maxResolved) {
      return {
        status: 'conflict',
        reason: `第 ${v} 期已撤销，但其后的第 ${maxResolved} 期已有解决记录`,
      }
    }
  }

  // 推导期望值：下一期基准 = 最新非 voided 记录（completed 取实际完成日，skipped 取原定日）
  const expectedSequence = maxResolved + 1
  let expectedNextDueDate: string
  if (maxResolved === 0) {
    expectedNextDueDate = task.startDate ?? task.createdAt.slice(0, 10)
  } else {
    const latest = resolved[resolved.length - 1]
    const base =
      latest.resolution === 'completed'
        ? (latest.resolvedAt?.slice(0, 10) ?? latest.occurrenceDate)
        : latest.occurrenceDate
    expectedNextDueDate = nextAfterCompletion(rule as AfterCompletionRule, base)
  }

  const seqOk = (task.currentSequence ?? 1) === expectedSequence
  // nextDueDate 允许用户单次改期（直接改字段是合法操作，v4.2 §7.3）——
  // 仅 sequence 不符才算缓存偏差；日期只在 sequence 修复时一并重算
  if (seqOk) {
    return { status: 'valid', expectedSequence, expectedNextDueDate }
  }
  return { status: 'cache_mismatch', expectedSequence, expectedNextDueDate }
}
