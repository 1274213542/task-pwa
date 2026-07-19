import { db, type ExpenseCategory, type MarkerSymbol } from './db'
import { appendRank } from './rank'

const now = () => new Date().toISOString()

export async function saveExpenseCategory(input: {
  id?: string
  name: string
  icon?: MarkerSymbol
}): Promise<string> {
  const name = input.name.trim()
  if (!name) throw new Error('请输入分类名称')
  const active = await db.expenseCategories
    .where('lifecycleStatus')
    .equals('active')
    .sortBy('rank')
  const duplicate = active.find(
    (category) =>
      category.id !== input.id &&
      category.name.localeCompare(name, undefined, { sensitivity: 'base' }) === 0,
  )
  if (duplicate) throw new Error('已经存在同名分类')
  const existing = input.id ? await db.expenseCategories.get(input.id) : undefined
  const timestamp = now()
  const id = input.id ?? crypto.randomUUID()
  await db.expenseCategories.put({
    id,
    name,
    icon: input.icon ?? existing?.icon ?? 'dot',
    colorToken: existing?.colorToken ?? 'gray',
    rank: existing?.rank ?? appendRank(active.at(-1)?.rank),
    sortOrder: existing?.sortOrder ?? active.length,
    archived: false,
    lifecycleStatus: 'active',
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  })
  return id
}

export async function archiveExpenseCategory(
  id: string,
  replacementId?: string,
): Promise<void> {
  if (id === replacementId) throw new Error('不能合并到同一个分类')
  const replacement = replacementId
    ? await db.expenseCategories.get(replacementId)
    : undefined
  const timestamp = now()
  await db.transaction(
    'rw',
    db.expenseCategories,
    db.financeTransactions,
    db.expenseRecords,
    async () => {
      await db.financeTransactions
        .where('categoryId')
        .equals(id)
        .modify((transaction) => {
          if (replacement) {
            transaction.categoryId = replacement.id
            transaction.categoryNameSnapshot = replacement.name
          } else {
            delete transaction.categoryId
            transaction.categoryNameSnapshot = '未分类'
          }
          transaction.updatedAt = timestamp
        })
      await db.expenseRecords
        .where('categoryId')
        .equals(id)
        .modify((record) => {
          if (replacement) {
            record.categoryId = replacement.id
            record.categoryNameSnapshot = replacement.name
          } else {
            delete record.categoryId
            record.categoryNameSnapshot = '未分类'
          }
          record.updatedAt = timestamp
        })
      await db.expenseCategories.update(id, {
        archived: true,
        lifecycleStatus: 'deleted',
        deletedAt: timestamp,
        updatedAt: timestamp,
      })
    },
  )
}

export async function moveExpenseCategory(id: string, direction: -1 | 1): Promise<void> {
  const categories = await db.expenseCategories
    .where('lifecycleStatus')
    .equals('active')
    .sortBy('rank')
  const index = categories.findIndex((category) => category.id === id)
  const otherIndex = index + direction
  if (index < 0 || otherIndex < 0 || otherIndex >= categories.length) return
  const current = categories[index]
  const other = categories[otherIndex]
  const timestamp = now()
  await db.transaction('rw', db.expenseCategories, async () => {
    await db.expenseCategories.update(current.id, {
      rank: other.rank,
      sortOrder: otherIndex,
      updatedAt: timestamp,
    })
    await db.expenseCategories.update(other.id, {
      rank: current.rank,
      sortOrder: index,
      updatedAt: timestamp,
    })
  })
}

export function categoryLabel(category?: ExpenseCategory) {
  return category?.name ?? '未分类'
}
