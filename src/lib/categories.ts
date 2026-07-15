import { db, type ColorToken } from './db'

const now = () => new Date().toISOString()
const nextRank = () => Date.now().toString(36).padStart(10, '0')

/** 受限色板（v4.2 §2 分类：视觉区分但不依赖过多颜色） */
export const COLOR_TOKENS: Record<ColorToken, string> = {
  gray: '#8e8e93',
  blue: '#007aff',
  green: '#34c759',
  orange: '#ff9500',
  pink: '#ff2d55',
  purple: '#af52de',
}

export async function addCategory(
  name: string,
  colorToken: ColorToken = 'gray',
): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) return
  const t = now()
  await db.categories.add({
    id: crypto.randomUUID(),
    name: trimmed,
    colorToken,
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
