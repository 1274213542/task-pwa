import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Category } from '../lib/db'
import {
  addCategory,
  renameCategory,
  setCategoryColor,
  setCategoryMarker,
  softDeleteCategory,
} from '../lib/categories'
import PageHeader from '../components/PageHeader'
import AppIcon from '../components/AppIcon'
import MarkerIcon from '../components/MarkerIcon'
import {
  COLOR_TOKEN_ORDER,
  MARKER_SYMBOLS,
  nextColorToken,
  nextMarkerSymbol,
} from '../lib/themes'
import MobilePageHeader from '../components/MobilePageHeader'

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
    <li className="category-row">
      <button
        aria-label={`切换 ${cat.name} 的标记图形`}
        onClick={() => {
          void setCategoryMarker(cat.id, nextMarkerSymbol(cat.markerSymbol))
        }}
        className="category-token hit-target"
      >
        <span data-color-token={cat.colorToken}>
          <MarkerIcon
            symbol={cat.markerSymbol ?? 'dot'}
            color={cat.colorToken}
            size={28}
          />
        </span>
      </button>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          className="category-name-input min-w-0 bg-transparent outline-none"
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="category-name-button min-w-0 truncate text-left"
        >
          {cat.name}
        </button>
      )}
      {!confirming && (
        <>
          <button
            type="button"
            aria-label={`切换 ${cat.name} 的颜色`}
            data-color-token={cat.colorToken}
            className="category-color-button"
            onClick={() => void setCategoryColor(cat.id, nextColorToken(cat.colorToken))}
          />
          <span className="category-count tabular" aria-label={`${taskCount} 个任务`}>
            {taskCount}
          </span>
        </>
      )}
      {confirming ? (
        <button
          onClick={() => void softDeleteCategory(cat.id)}
          className="category-delete-confirm shrink-0 rounded-full bg-red-500 px-3 text-[12px]
            font-medium text-white"
        >
          确认删除
        </button>
      ) : (
        <button
          aria-label={`删除分类 ${cat.name}`}
          onClick={armDelete}
          className="category-delete hit-target shrink-0"
        >
          <AppIcon name="close" size={18} />
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
    const color = COLOR_TOKEN_ORDER.find((t) => !used.has(t)) ?? 'gray'
    const marker = MARKER_SYMBOLS[(categories?.length ?? 0) % MARKER_SYMBOLS.length]
    await addCategory(newName, color, marker)
    setNewName('')
  }

  return (
    <section className="app-page page-browse">
      <MobilePageHeader
        title="分类与记录"
        eyebrow="分类与记录"
        backHref="#/overview"
      />
      <PageHeader
        title="浏览"
        eyebrow="分类与记录"
        actions={<Link
          to="/settings"
          aria-label="设置"
          className="browse-settings-token hit-target rounded-full"
        >
          <AppIcon name="settings" size={21} />
        </Link>}
      />

      <div className="browse-layout">
        <section className="browse-categories" aria-labelledby="browse-categories-title">
          <div className="browse-section-head">
            <h2 id="browse-categories-title" className="browse-section-title">分类</h2>
            <span className="browse-count-token tabular">{categories?.length ?? 0}</span>
          </div>
          <div className="list-card browse-category-card bg-white dark:bg-neutral-800">
            <ul>
              {(categories ?? []).map((c) => (
                <CategoryRow key={c.id} cat={c} taskCount={countByCat.get(c.id) ?? 0} />
              ))}
            </ul>
            <div className="category-composer">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void submitCategory()}
                placeholder="新建分类（如 学校 / 工作 / 生活）"
              />
              <button
                onClick={() => void submitCategory()}
                disabled={!newName.trim()}
                className="category-add"
              >
                添加
              </button>
            </div>
          </div>
        </section>

        <section className="browse-records" aria-labelledby="browse-records-title">
          <div className="browse-section-head">
            <h2 id="browse-records-title" className="browse-section-title">
              <span>已完成</span><span className="browse-section-muted">记录</span>
            </h2>
            <span className="browse-count-token browse-count-complete tabular">
              {records?.length ?? 0}
            </span>
          </div>
          {(records?.length ?? 0) === 0 ? (
            <div className="browse-empty-state">还没有完成记录</div>
          ) : (
            <div className="record-groups">
              {Array.from(groups.entries()).map(([day, rs]) => (
                <article key={day} className="record-group">
                  <p className="record-date">
                    {new Date(day + 'T00:00:00').toLocaleDateString('zh-CN', {
                      month: 'long',
                      day: 'numeric',
                      weekday: 'short',
                    })}
                  </p>
                  <ul className="list-card record-list bg-white dark:bg-neutral-800">
                    {rs.map((r) => (
                      <li key={r.id} className="record-row">
                        <span
                          className={`record-title ${
                            r.resolution === 'completed' ? 'is-completed' : ''
                          }`}
                        >
                          {r.titleSnapshot}
                        </span>
                        <span className="record-meta">
                          {r.categoryNameSnapshot && (
                            <span className="record-category">{r.categoryNameSnapshot}</span>
                          )}
                          {r.resolution === 'skipped' && (
                            <span className="record-skipped">已跳过</span>
                          )}
                          {r.occurrenceKey !== 'single' && <span aria-label="周期任务">↻</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  )
}
