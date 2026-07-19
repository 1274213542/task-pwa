import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db, type ShoppingItem } from './db'
import {
  moveShoppingItem,
  restoreDeletedItem,
  restoreShoppingItemPlacement,
  softDeleteItem,
} from './shopping'
import { compareRanks } from './rank'

const initialTimestamp = '2026-07-19T00:00:00.000Z'

function item(
  id: string,
  locationId: string,
  rank: string,
): ShoppingItem {
  return {
    id,
    name: id,
    locationId,
    rank,
    purchaseStatus: 'pending',
    lifecycleStatus: 'active',
    createdAt: initialTimestamp,
    updatedAt: initialTimestamp,
  }
}

beforeEach(async () => {
  await db.open()
  await db.shoppingItems.clear()
  await db.shoppingLocations.clear()
})

afterAll(async () => {
  await db.shoppingItems.clear()
  await db.shoppingLocations.clear()
  db.close()
})

describe('购物商品移动与安全撤销', () => {
  it('软删除后立即消失，并且只有版本未变化时可撤销', async () => {
    const water = item('water-delete', 'market', 'a0')
    await db.shoppingItems.add(water)
    const deletedAt = await softDeleteItem(water.id)
    expect(await db.shoppingItems.get(water.id)).toMatchObject({
      lifecycleStatus: 'deleted',
      deletedAt,
    })
    expect(await restoreDeletedItem(water.id, deletedAt)).toBe(true)
    expect(await db.shoppingItems.get(water.id)).toMatchObject({
      lifecycleStatus: 'active',
    })
  })

  it('返回移动版本令牌，并可用该令牌恢复原地点与顺序', async () => {
    const moving = item('milk', 'market', 'a0')
    const target = item('bread', 'pharmacy', 'b0')
    await db.shoppingItems.bulkAdd([moving, target])

    const movedAt = await moveShoppingItem(
      moving.id,
      target.locationId,
      target.rank,
      null,
      [target.id, moving.id],
    )
    expect(await db.shoppingItems.get(moving.id)).toMatchObject({
      locationId: 'pharmacy',
      updatedAt: movedAt,
    })

    expect(await restoreShoppingItemPlacement(
      moving.id,
      moving.locationId,
      moving.rank,
      movedAt,
    )).toBe(true)
    expect(await db.shoppingItems.get(moving.id)).toMatchObject({
      locationId: 'market',
      rank: 'a0',
    })
  })

  it('记录在移动后又发生变化时拒绝陈旧撤销', async () => {
    const moving = item('water', 'market', 'a0')
    const target = item('paper', 'pharmacy', 'b0')
    await db.shoppingItems.bulkAdd([moving, target])
    const movedAt = await moveShoppingItem(
      moving.id,
      target.locationId,
      target.rank,
      null,
      [target.id, moving.id],
    )
    await db.shoppingItems.update(moving.id, {
      note: '另一端已修改',
      updatedAt: '2026-07-19T01:00:00.000Z',
    })

    expect(await restoreShoppingItemPlacement(
      moving.id,
      moving.locationId,
      moving.rank,
      movedAt,
    )).toBe(false)
    expect(await db.shoppingItems.get(moving.id)).toMatchObject({
      locationId: 'pharmacy',
      note: '另一端已修改',
    })
  })

  it('移动不存在或已删除的商品时明确失败', async () => {
    await expect(moveShoppingItem('missing', undefined, null, null)).rejects.toThrow(
      '商品不存在或已删除',
    )
  })

  it('同一地点内排序会写入稳定 rank，重新读取后仍保持新顺序', async () => {
    const first = item('milk', 'market', 'a0')
    const second = item('bread', 'market', 'b0')
    const third = item('paper', 'market', 'c0')
    await db.shoppingItems.bulkAdd([first, second, third])

    await moveShoppingItem(
      third.id,
      'market',
      null,
      first.rank,
      [third.id, first.id, second.id],
    )

    const reloaded = (await db.shoppingItems.toArray())
      .filter((entry) => entry.locationId === 'market')
      .sort((a, b) => compareRanks(a.rank, b.rank))
      .map((entry) => entry.id)
    expect(reloaded).toEqual(['paper', 'milk', 'bread'])
  })

  it('可以拖入空地点，关闭并重新打开数据库后地点仍正确', async () => {
    const moving = item('water', 'pharmacy', 'a0')
    await db.shoppingItems.add(moving)

    await moveShoppingItem(moving.id, 'amazon', null, null)
    db.close()
    await db.open()

    expect(await db.shoppingItems.get(moving.id)).toMatchObject({
      locationId: 'amazon',
      lifecycleStatus: 'active',
    })
  })
})
