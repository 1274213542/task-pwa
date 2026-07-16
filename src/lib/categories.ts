import { db, type ColorToken, type MarkerSymbol } from './db'

const now = () => new Date().toISOString()
const nextRank = () => Date.now().toString(36).padStart(10, '0')

/** 受限色板（v4.2 §2 分类：视觉区分但不依赖过多颜色） */
export const COLOR_TOKENS: Record<ColorToken, string> = {
  gray: '#a4a4a0',
  blue: '#35b8d4',
  green: '#3fae7a',
  orange: '#ff650f',
  pink: '#df469c',
  purple: '#a89ded',
}

export async function addCategory(
  name: string,
  colorToken: ColorToken = 'gray',
  markerSymbol: MarkerSymbol = 'dot',
): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) return
  const t = now()
  await db.categories.add({
    id: crypto.randomUUID(),
    name: trimmed,
    colorToken,
    markerSymbol,
    rank: nextRank(),
    lifecycleStatus: 'active',
    createdAt: t,
    updatedAt: t,
  })
}

export async function renameCategory(id: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) return
  await db.categories.update(id, { name: trimmed, updatedAt: now() })
}

export async function setCategoryColor(
  id: string,
  colorToken: ColorToken,
): Promise<void> {
  await db.categories.update(id, { colorToken, updatedAt: now() })
}

export async function setCategoryMarker(
  id: string,
  markerSymbol: MarkerSymbol,
): Promise<void> {
  await db.categories.update(id, { markerSymbol, updatedAt: now() })
}

/**
 * 软删分类（v4.2 §8.1）：仅从选择器/列表隐藏；
 * 活动任务显示为"无分类"（categoryId 保留不置空），历史靠快照解析。
 */
export async function softDeleteCategory(id: string): Promise<void> {
  await db.categories.update(id, {
    lifecycleStatus: 'deleted',
    deletedAt: now(),
    updatedAt: now(),
  })
}
