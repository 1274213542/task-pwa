import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'

/**
 * 手动排序 rank（v4.2 §10：MS7 引入 fractional indexing）。
 * 历史数据用的是 base36 时间戳追加键，与 fractional-indexing 键格式不兼容；
 * 首次拖拽时对整表做一次规范化重写，此后每次拖拽只写一条 rank（MS7 验收）。
 */

export function isFiKey(rank: string): boolean {
  try {
    generateKeyBetween(rank, null)
    return true
  } catch {
    return false
  }
}

/** 两个相邻 rank 之间取键；格式不兼容时抛错，由调用方触发规范化 */
export function betweenRanks(a: string | null, b: string | null): string {
  return generateKeyBetween(a, b)
}

/** 追加键：末尾 rank 合法则接续，否则退回时间戳（规范化前的过渡态） */
export function appendRank(maxRank: string | undefined): string {
  if (maxRank !== undefined) {
    try {
      return generateKeyBetween(maxRank, null)
    } catch {
      return Date.now().toString(36).padStart(10, '0')
    }
  }
  return generateKeyBetween(null, null)
}

/** 按当前顺序生成 n 个规范键（一次性全表重写用） */
export function normalizedRanks(n: number): string[] {
  return generateNKeysBetween(null, null, n)
}

/**
 * fractional-indexing 的键必须按代码单元顺序比较。
 * localeCompare 会受语言环境及大小写排序规则影响，可能与 IndexedDB 的
 * `sortBy('rank')` 结果不一致，导致拖拽完成后视觉顺序回跳。
 */
export function compareRanks(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}
