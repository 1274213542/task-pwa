import { db, type ShoppingItem } from './db'

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
  await db.shoppingLocations.update(id, {
    lifecycleStatus: 'deleted',
    deletedAt: now(),
    updatedAt: now(),
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
  const name = opts.name.trim()
  if (!name) return
  const t = now()
  await db.shoppingItems.add({
    id: crypto.randomUUID(),
    name,
    ...(opts.quantity && opts.quantity > 0 && { quantity: opts.quantity }),
    ...(opts.unit?.trim() && { unit: opts.unit.trim() }),
    ...(opts.note?.trim() && { note: opts.note.trim() }),
    ...(opts.locationId && { locationId: opts.locationId }),
    rank: nextRank(),
    purchaseStatus: 'pending',
    lifecycleStatus: 'active',
    createdAt: t,
    updatedAt: t,
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

export async function softDeleteItem(id: string): Promise<void> {
  await db.shoppingItems.update(id, {
    lifecycleStatus: 'deleted',
    deletedAt: now(),
    updatedAt: now(),
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
