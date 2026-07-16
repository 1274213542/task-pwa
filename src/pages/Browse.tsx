import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Category, type ColorToken } from '../lib/db'
import {
  COLOR_TOKENS,
  addCategory,
  renameCategory,
  setCategoryColor,
  softDeleteCategory,
} from '../lib/categories'
import PageHeader from '../components/PageHeader'
import AppIcon from '../components/AppIcon'

const TOKEN_ORDER: ColorToken[] = ['gray', 'blue', 'green', 'orange', 'pink', 'purple']

function CategoryRow({ cat, taskCount }: { cat: Category; taskCount: number }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(cat.name)
  const [confirming, setConfirming] = useState(false)

  function commit() {
    setEditing(false)
    if (draft.trim() && draft.trim() !== cat.name) void renameCategory(cat.id, draft)
    else setDraft(cat.name)
  }

  function armDelete() {
    setConfirming(true)
    setTimeout(() => setConfirming(false), 3000)
  }

  return (
    <li
      className="flex items-center gap-3 border-b border-black/5 px-4 py-3
        last:border-b-0 dark:border-white/10"
    >
      <button
        aria-label="切换颜色"
        onClick={() => {
          const next =
            TOKEN_ORDER[(TOKEN_ORDER.indexOf(cat.colorToken) + 1) % TOKEN_ORDER.length]
          void setCategoryColor(cat.id, next)
        }}
        className="h-3.5 w-3.5 shrink-0 rounded-full transition active:scale-90"
        style={{ background: COLOR_TOKENS[cat.colorToken] }}
      />
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="min-w-0 flex-1 truncate text-left text-[15px]"
        >
          {cat.name}
        </button>
      )}
      <span className="text-[13px] text-neutral-400">{taskCount}</span>
      {confirming ? (
        <button
          onClick={() => void softDeleteCategory(cat.id)}
          className="shrink-0 rounded-lg bg-red-500 px-2 py-1 text-[12px]
            font-medium text-white"
        >
          确认删除
        </button>
      ) : (
        <button
          aria-label={`删除分类 ${cat.name}`}
          onClick={armDelete}
          className="shrink-0 px-1 text-neutral-300 dark:text-neutral-600"
        >
          ✕
        </button>
      )}
    </li>
  )
}

export default function Browse() {
  const [newName, setNewName] = useState('')

  const categories = useLiveQuery(
    () => db.categories.where('lifecycleStatus').equals('active').sortBy('rank'),
    [],
  )
  const activeTasks = useLiveQuery(
    () => db.tasks.where('lifecycleStatus').equals('active').toArray(),
    [],
  )
  const records = useLiveQuery(
    () =>
      db.completionRecords
        .orderBy('resolvedAt')
        .reverse()
        .filter((r) => r.resolution !== 'voided')
        .limit(100)
        .toArray(),
    [],
  )

  const countByCat = new Map<string, number>()
  for (const t of activeTasks ?? []) {
    if (t.categoryId)
      countByCat.set(t.categoryId, (countByCat.get(t.categoryId) ?? 0) + 1)
  }

  // 已完成记录按日分组（快照渲染：分类删除/任务改名后历史仍如实）
  const groups = new Map<string, NonNullable<typeof records>>()
  for (const r of records ?? []) {
    const day = r.resolvedAt.slice(0, 10)
    if (!groups.has(day)) groups.set(day, [])
    groups.get(day)!.push(r)
  }

  async function submitCategory() {
    const used = new Set((categories ?? []).map((c) => c.colorToken))
    const color = TOKEN_ORDER.find((t) => !used.has(t)) ?? 'gray'
    await addCategory(newName, color)
    setNewName('')
  }

  return (
    <section className="app-page">
      <PageHeader
        title="浏览"
        eyebrow="分类与记录"
        actions={<Link
          to="/settings"
          aria-label="设置"
          className="hit-target rounded-full text-neutral-500 dark:text-neutral-400"
        >
          <AppIcon name="settings" size={21} />
        </Link>}
      />

      <h2 className="section-label mt-6">分类</h2>
      <div className="list-card mt-2 overflow-hidden rounded-2xl bg-white dark:bg-neutral-800">
        <ul>
          {(categories ?? []).map((c) => (
            <CategoryRow key={c.id} cat={c} taskCount={countByCat.get(c.id) ?? 0} />
          ))}
        </ul>
        <div className="flex items-center gap-2 px-4 py-2.5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submitCategory()}
            placeholder="新建分类（如 学校 / 工作 / 生活）"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none
              placeholder:text-neutral-400"
          />
          <button
            onClick={() => void submitCategory()}
            disabled={!newName.trim()}
            className="text-[15px] font-medium text-[#2f765f] disabled:opacity-40"
          >
            添加
          </button>
        </div>
      </div>

      <h2 className="section-label mt-8">
        已完成记录
      </h2>
      {(records?.length ?? 0) === 0 ? (
        <div
          className="mt-2 rounded-2xl border border-dashed border-neutral-300 p-6
            text-center text-[14px] text-neutral-400 dark:border-neutral-700"
        >
          还没有完成记录
        </div>
      ) : (
        Array.from(groups.entries()).map(([day, rs]) => (
          <div key={day} className="mt-3">
            <p className="px-1 text-[12px] text-neutral-400">
              {new Date(day + 'T00:00:00').toLocaleDateString('zh-CN', {
                month: 'long',
                day: 'numeric',
                weekday: 'short',
              })}
            </p>
            <ul className="list-card mt-1.5 rounded-2xl bg-white px-4 dark:bg-neutral-800">
              {rs.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center gap-2 border-b border-black/5 py-2.5
                    last:border-b-0 dark:border-white/10"
                >
                  <span
                    className={`text-[15px] ${
                      r.resolution === 'completed'
                        ? 'text-neutral-400 line-through'
                        : 'text-neutral-400'
                    }`}
                  >
                    {r.titleSnapshot}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-2 text-[12px] text-neutral-400">
                    {r.categoryNameSnapshot && <span>{r.categoryNameSnapshot}</span>}
                    {r.resolution === 'skipped' && (
                      <span className="rounded bg-neutral-500/10 px-1.5 py-0.5">
                        已跳过
                      </span>
                    )}
                    {r.occurrenceKey !== 'single' && <span aria-label="周期任务">↻</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  )
}
