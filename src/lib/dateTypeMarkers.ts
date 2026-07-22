import { db, type ColorToken, type DateTypeDefinition } from './db'
import { appendRank } from './rank'

const now = () => new Date().toISOString()

export async function saveDateTypeDefinition(input: {
  id?: string
  name: string
  colorToken?: ColorToken
}): Promise<string> {
  const name = input.name.trim()
  if (!name) throw new Error('请输入类型名称')
  const active = await db.dateTypeDefinitions
    .where('lifecycleStatus')
    .equals('active')
    .sortBy('rank')
  const existing = active.find((item) =>
    item.name.localeCompare(name, undefined, { sensitivity: 'base' }) === 0,
  )
  if (existing && existing.id !== input.id) return existing.id
  const timestamp = now()
  if (input.id) {
    const current = await db.dateTypeDefinitions.get(input.id)
    if (!current || current.lifecycleStatus !== 'active') throw new Error('日期类型不存在或已删除')
    await db.dateTypeDefinitions.update(input.id, {
      name,
      colorToken: input.colorToken ?? current.colorToken,
      updatedAt: timestamp,
    })
    return input.id
  }
  const id = crypto.randomUUID()
  const row: DateTypeDefinition = {
    id,
    name,
    colorToken: input.colorToken ?? 'orange',
    rank: appendRank(active.at(-1)?.rank),
    lifecycleStatus: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  await db.dateTypeDefinitions.put(row)
  return id
}

export async function deleteDateTypeDefinition(id: string): Promise<void> {
  const timestamp = now()
  await db.transaction('rw', db.dateTypeDefinitions, db.dateTypeMarkers, async () => {
    const current = await db.dateTypeDefinitions.get(id)
    if (!current || current.lifecycleStatus !== 'active') return
    await db.dateTypeDefinitions.update(id, {
      lifecycleStatus: 'deleted',
      deletedAt: timestamp,
      updatedAt: timestamp,
    })
    const markers = await db.dateTypeMarkers.where('typeId').equals(id).toArray()
    await db.dateTypeMarkers.bulkPut(markers.map((marker) => ({
      ...marker,
      lifecycleStatus: 'deleted' as const,
      deletedAt: timestamp,
      updatedAt: timestamp,
    })))
  })
}

export async function applyDateTypeMarkers(dates: string[], typeId: string): Promise<void> {
  if (!typeId) throw new Error('请选择日期类型')
  const definition = await db.dateTypeDefinitions.get(typeId)
  if (!definition || definition.lifecycleStatus !== 'active') throw new Error('日期类型不存在')
  const timestamp = now()
  const uniqueDates = [...new Set(dates)]
  await db.dateTypeMarkers.bulkPut(uniqueDates.map((date) => ({
    id: `${date}:${typeId}`,
    date,
    typeId,
    lifecycleStatus: 'active' as const,
    createdAt: timestamp,
    updatedAt: timestamp,
  })))
}

export async function clearDateTypeMarkers(dates: string[], typeId?: string): Promise<void> {
  const selected = new Set(dates)
  const rows = await db.dateTypeMarkers.toArray()
  const timestamp = now()
  await db.dateTypeMarkers.bulkPut(rows
    .filter((row) => selected.has(row.date) && (!typeId || row.typeId === typeId))
    .map((row) => ({
      ...row,
      lifecycleStatus: 'deleted' as const,
      deletedAt: timestamp,
      updatedAt: timestamp,
    })))
}
