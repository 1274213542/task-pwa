import { db, type ShoppingItem } from './db'
import {
  parseBatchEntries,
  parseBatchLines,
  type BatchCreateResult,
} from './batch'
import { appendRank, betweenRanks, normalizedRanks } from './rank'

const now = () => new Date().toISOString()
const nextRank = () => Date.now().toString(36).padStart(10, '0')

/* ---------- 地点 ---------- */

export async function addLocation(
  name: string,
  type: 'physical' | 'online',
): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) return
  const t = now()
  await db.shoppingLocations.add({
    id: crypto.randomUUID(),
    name: trimmed,
    type,
    rank: nextRank(),
    lifecycleStatus: 'active',
    createdAt: t,
    updatedAt: t,
  })
}

export async function renameLocation(id: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) return
  await db.shoppingLocations.update(id, { name: trimmed, updatedAt: now() })
}

/** 软删：仅从选择器隐藏；历史条目 locationId 永不置空（v4.2 §8.1） */
export async function softDeleteLocation(id: string): Promise<void> {
  await db.transaction('rw', db.shoppingLocations, db.shoppingItems, async () => {
    const location = await db.shoppingLocations.get(id)
    const timestamp = now()
    await db.shoppingLocations.update(id, {
      lifecycleStatus: 'deleted',
      deletedAt: timestamp,
      updatedAt: timestamp,
    })
    await db.shoppingItems
      .where('locationId')
      .equals(id)
      .filter((item) => item.lifecycleStatus === 'active')
      .modify((item) => {
        if (item.purchaseStatus === 'pending') item.locationId = undefined
        if (!item.locationNameSnapshot && location) item.locationNameSnapshot = location.name
        item.updatedAt = timestamp
      })
  })
}

/* ---------- 商品条目 ---------- */

export async function addItem(opts: {
  name: string
  quantity?: number
  unit?: string
  note?: string
  locationId?: string
}): Promise<void> {
  await addItems({ ...opts, names: [opts.name] })
}

/** 原子批量新增商品；重复名称有意义，因此不去重。 */
export async function addItems(opts: {
  names: string[] | string
  quantity?: number
  unit?: string
  note?: string
  locationId?: string
}): Promise<number> {
  const names = Array.isArray(opts.names)
    ? opts.names.map((name) => name.trim()).filter(Boolean)
    : parseBatchLines(opts.names)
  if (names.length === 0) return 0
  const t = now()
  const base = Date.now()
  const rows: ShoppingItem[] = names.map((name, index) => ({
    id: crypto.randomUUID(),
    name,
    ...(opts.quantity && opts.quantity > 0 && { quantity: opts.quantity }),
    ...(opts.unit?.trim() && { unit: opts.unit.trim() }),
    ...(opts.note?.trim() && { note: opts.note.trim() }),
    ...(opts.locationId && { locationId: opts.locationId }),
    rank: (base + index).toString(36).padStart(10, '0'),
    purchaseStatus: 'pending',
    lifecycleStatus: 'active',
    createdAt: t,
    updatedAt: t,
  }))
  await db.transaction('rw', db.shoppingItems, async () => {
    await db.shoppingItems.bulkAdd(rows)
  })
  return rows.length
}

export async function addItemsDetailed(opts: {
  names: string
  quantity?: number
  unit?: string
  note?: string
  locationId?: string
}): Promise<BatchCreateResult> {
  const entries = parseBatchEntries(opts.names)
  const failures: BatchCreateResult['failures'] = []
  let created = 0
  if (entries.length === 0) return { created, failures }

  const active = await db.shoppingItems
    .where('lifecycleStatus')
    .equals('active')
    .sortBy('rank')
  let rank = active.at(-1)?.rank
  await db.transaction('rw', db.shoppingItems, async () => {
    for (const entry of entries) {
      if (entry.value.length > 500) {
        failures.push({ line: entry.line, value: entry.value, reason: '名称超过 500 字' })
        continue
      }
      try {
        rank = appendRank(rank)
        const timestamp = now()
        await db.shoppingItems.add({
          id: crypto.randomUUID(),
          name: entry.value,
          ...(opts.quantity && opts.quantity > 0 && { quantity: opts.quantity }),
          ...(opts.unit?.trim() && { unit: opts.unit.trim() }),
          ...(opts.note?.trim() && { note: opts.note.trim() }),
          ...(opts.locationId && { locationId: opts.locationId }),
          rank,
          purchaseStatus: 'pending',
          lifecycleStatus: 'active',
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        created += 1
      } catch (reason) {
        failures.push({
          line: entry.line,
          value: entry.value,
          reason: reason instanceof Error ? reason.message : '写入失败',
        })
      }
    }
  })
  return { created, failures }
}

/** 同组排序或跨地点移动；地点与顺序在同一事务中保存。 */
export async function moveShoppingItem(
  id: string,
  locationId: string | undefined,
  beforeRank: string | null,
  afterRank: string | null,
  orderedScopeIds: string[] = [id],
): Promise<string> {
  const current = await db.shoppingItems.get(id)
  if (!current || current.lifecycleStatus !== 'active') {
    throw new Error('商品不存在或已删除')
  }

  let rank: string | undefined
  try {
    rank = betweenRanks(beforeRank, afterRank)
  } catch {
    // v7 and older used timestamp-like ranks. Normalize only the visible
    // ordering scope on the first move, preserving every item and its group.
  }

  if (rank) {
    const timestamp = now()
    const updated = await db.shoppingItems.update(id, {
      locationId,
      rank,
      updatedAt: timestamp,
    })
    if (updated !== 1) throw new Error('商品移动失败，请重试')
    return timestamp
  }

  const ids = [...new Set(orderedScopeIds)]
  if (!ids.includes(id)) ids.push(id)
  const ranks = normalizedRanks(ids.length)
  const timestamp = now()
  await db.transaction('rw', db.shoppingItems, async () => {
    const latest = await db.shoppingItems.get(id)
    if (!latest || latest.lifecycleStatus !== 'active') {
      throw new Error('商品不存在或已删除')
    }
    await Promise.all(
      ids.map((itemId, index) =>
        db.shoppingItems.update(itemId, {
          ...(itemId === id && { locationId }),
          rank: ranks[index],
          updatedAt: timestamp,
        }),
      ),
    )
  })
  return timestamp
}

/**
 * 撤销最近一次移动。
 *
 * expectedUpdatedAt 是移动成功时返回的版本令牌。若记录随后被购买、删除、
 * 同步或再次编辑，则拒绝覆盖较新的数据。
 */
export async function restoreShoppingItemPlacement(
  id: string,
  locationId: string | undefined,
  rank: string,
  expectedUpdatedAt: string,
): Promise<boolean> {
  return db.transaction('rw', db.shoppingItems, async () => {
    const current = await db.shoppingItems.get(id)
    if (
      !current ||
      current.lifecycleStatus !== 'active' ||
      current.updatedAt !== expectedUpdatedAt
    ) {
      return false
    }
    await db.shoppingItems.update(id, { locationId, rank, updatedAt: now() })
    return true
  })
}

/** 勾选已购：purchaseStatus 与 purchasedAt 同笔更新；写地点名快照 */
export async function markPurchased(item: ShoppingItem): Promise<void> {
  const location = item.locationId
    ? await db.shoppingLocations.get(item.locationId)
    : undefined
  await db.shoppingItems.update(item.id, {
    purchaseStatus: 'purchased',
    purchasedAt: now(),
    ...(location && { locationNameSnapshot: location.name }),
    updatedAt: now(),
  })
}

/** 误点撤销：恢复待购（快照保留无妨） */
export async function unmarkPurchased(id: string): Promise<void> {
  await db.shoppingItems.update(id, {
    purchaseStatus: 'pending',
    purchasedAt: undefined,
    updatedAt: now(),
  })
}

export async function softDeleteItem(id: string): Promise<string> {
  const deletedAt = now()
  const changed = await db.shoppingItems.update(id, {
    lifecycleStatus: 'deleted',
    deletedAt,
    updatedAt: deletedAt,
  })
  if (changed !== 1) throw new Error('商品删除失败，请重试')
  return deletedAt
}

/**
 * 撤销软删除。expectedDeletedAt 是删除提交时的版本令牌；如果其他设备
 * 已经修改这条商品，则拒绝覆盖较新的状态。
 */
export async function restoreDeletedItem(
  id: string,
  expectedDeletedAt: string,
): Promise<boolean> {
  return db.transaction('rw', db.shoppingItems, async () => {
    const item = await db.shoppingItems.get(id)
    if (
      !item ||
      item.lifecycleStatus !== 'deleted' ||
      item.deletedAt !== expectedDeletedAt ||
      item.updatedAt !== expectedDeletedAt
    ) return false
    await db.shoppingItems.update(id, {
      lifecycleStatus: 'active',
      deletedAt: undefined,
      updatedAt: now(),
    })
    return true
  })
}

/**
 * 地点频次建议（v4.2 §7 产品决定：派生建议，零新表）：
 * 按已购历史中同名商品的地点出现次数取众数。
 */
export function suggestLocationId(
  name: string,
  purchasedItems: ShoppingItem[],
  activeLocationIds: Set<string>,
): string | undefined {
  const key = name.trim()
  if (!key) return undefined
  const counts = new Map<string, number>()
  for (const it of purchasedItems) {
    if (it.name !== key || !it.locationId) continue
    if (!activeLocationIds.has(it.locationId)) continue // 已删地点不再推荐
    counts.set(it.locationId, (counts.get(it.locationId) ?? 0) + 1)
  }
  let best: string | undefined
  let bestCount = 0
  for (const [id, c] of counts) {
    if (c > bestCount) {
      best = id
      bestCount = c
    }
  }
  return best
}
