import { describe, expect, it } from 'vitest'
import type { CompletionRecord, Task } from './db'
import { checkAfterCompletionIntegrity } from './integrity'

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  title: '换滤芯',
  rank: 'r',
  startDate: '2026-07-01',
  lifecycleStatus: 'active',
  templateVersion: 1,
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-01T00:00:00Z',
  recurrence: {
    mode: 'after_completion',
    intervalValue: 7,
    intervalUnit: 'day',
    overflowPolicy: 'clamp',
  },
  currentSequence: 1,
  nextDueDate: '2026-07-01',
  ...over,
})

const rec = (
  seq: number,
  resolution: CompletionRecord['resolution'],
  occurrenceDate: string,
  completedDate?: string, // 实际完成的本地民用日期
): CompletionRecord => ({
  id: `t1:ac:${seq}`,
  taskId: 't1',
  occurrenceKey: `ac:${seq}`,
  occurrenceDate,
  resolution,
  resolvedAt: `${completedDate ?? occurrenceDate}T10:00:00Z`,
  ...(resolution === 'completed' && {
    completedDate: completedDate ?? occurrenceDate,
  }),
  titleSnapshot: '换滤芯',
  templateVersion: 1,
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-01T00:00:00Z',
})

describe('完整性校验（决策表 + v4.2 §7.4）', () => {
  it('无记录：期望 seq=1、nextDue=startDate', () => {
    const r = checkAfterCompletionIntegrity(task(), [])
    expect(r).toEqual({
      status: 'valid',
      expectedSequence: 1,
      expectedNextDueDate: '2026-07-01',
    })
  })

  it('完成一期后缓存一致 → valid；从实际完成日起算', () => {
    const r = checkAfterCompletionIntegrity(
      task({ currentSequence: 2, nextDueDate: '2026-07-10' }),
      [rec(1, 'completed', '2026-07-01', '2026-07-03')], // 迟两天完成
    )
    expect(r.status).toBe('valid')
    if (r.status === 'valid') expect(r.expectedNextDueDate).toBe('2026-07-10') // 7/3+7
  })

  it('跳过从原定日起算（不奖励拖延）', () => {
    const r = checkAfterCompletionIntegrity(
      task({ currentSequence: 2, nextDueDate: '2026-07-08' }),
      [rec(1, 'skipped', '2026-07-01', '2026-07-05')], // 7/5 才点跳过
    )
    expect(r.status).toBe('valid')
    if (r.status === 'valid') expect(r.expectedNextDueDate).toBe('2026-07-08') // 7/1+7
  })

  it('缓存偏差（sequence 落后）→ cache_mismatch，只建议重写缓存', () => {
    const r = checkAfterCompletionIntegrity(
      task({ currentSequence: 1, nextDueDate: '2026-07-01' }), // 另一端已完成，缓存旧
      [rec(1, 'completed', '2026-07-01')],
    )
    expect(r.status).toBe('cache_mismatch')
    if (r.status === 'cache_mismatch') {
      expect(r.expectedSequence).toBe(2)
      expect(r.expectedNextDueDate).toBe('2026-07-08')
    }
  })

  it('voided 记录不参与推导（撤销回退）', () => {
    const r = checkAfterCompletionIntegrity(
      task({ currentSequence: 1, nextDueDate: '2026-07-01' }),
      [rec(1, 'voided', '2026-07-01')],
    )
    expect(r.status).toBe('valid')
  })

  it('结构冲突：sequence 跳号', () => {
    const r = checkAfterCompletionIntegrity(task({ currentSequence: 3 }), [
      rec(1, 'completed', '2026-07-01'),
      rec(3, 'completed', '2026-07-15'), // 缺第 2 期
    ])
    expect(r.status).toBe('conflict')
  })

  it('结构冲突：前一期 voided 但后一期已解决', () => {
    const r = checkAfterCompletionIntegrity(task({ currentSequence: 3 }), [
      rec(1, 'voided', '2026-07-01'),
      rec(2, 'completed', '2026-07-08'),
    ])
    expect(r.status).toBe('conflict')
  })

  it('单次改期不算冲突（nextDueDate 允许手动修改）', () => {
    const r = checkAfterCompletionIntegrity(
      task({ currentSequence: 2, nextDueDate: '2026-07-20' }), // 用户把 7/10 改到 7/20
      [rec(1, 'completed', '2026-07-01', '2026-07-03')],
    )
    expect(r.status).toBe('valid')
  })
})
