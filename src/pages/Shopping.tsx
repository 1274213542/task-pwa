import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type ShoppingItem, type ShoppingLocation } from '../lib/db'
import {
  addItems,
  addLocation,
  markPurchased,
  renameLocation,
  softDeleteItem,
  softDeleteLocation,
  suggestLocationId,
  unmarkPurchased,
} from '../lib/shopping'
import PageHeader from '../components/PageHeader'

function ItemRow({
  item,
  locationLabel,
}: {
  item: ShoppingItem
  locationLabel?: string
}) {
  const [confirming, setConfirming] = useState(false)
  const purchased = item.purchaseStatus === 'purchased'

  return (
    <li
      className="flex items-center gap-3 border-b border-black/5 px-1 py-2.5
        last:border-b-0 dark:border-white/10"
    >
      <button
        aria-label={purchased ? '恢复待购' : '已购买'}
        onClick={() =>
          purchased ? void unmarkPurchased(item.id) : void markPurchased(item)
        }
        className="hit-target -ml-2.5 shrink-0 transition active:scale-95"
      >
        <span
          className={`flex h-[22px] w-[22px] items-center justify-center rounded-md
            border-[1.5px] ${
              purchased
                ? 'border-[#34c759] bg-[#34c759] text-white'
                : 'border-neutral-300 dark:border-neutral-600'
            }`}
        >
          {purchased && (
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path
                className="check-path"
                d="M2 6.5L4.5 9L10 3.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
      </button>

      <div className="min-w-0 flex-1">
        <p
          className={`strike truncate text-[15px] ${
            purchased ? 'text-neutral-400' : ''
          }`}
          data-done={purchased}
        >
          {item.name}
          {item.quantity && (
            <span className="ml-1.5 text-[13px] text-neutral-400">
              ×{item.quantity}
              {item.unit ?? ''}
            </span>
          )}
        </p>
        {(item.note || locationLabel) && (
          <p className="truncate text-[12px] text-neutral-400">
            {[locationLabel, item.note].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>

      {confirming ? (
        <button
          onClick={() => void softDeleteItem(item.id)}
          className="shrink-0 rounded-lg bg-red-500 px-2 py-1 text-[12px]
            font-medium text-white"
        >
          确认删除
        </button>
      ) : (
        <button
          aria-label="删除"
          onClick={() => {
            setConfirming(true)
            setTimeout(() => setConfirming(false), 3000)
          }}
          className="hit-target -mr-2 shrink-0 text-neutral-300 dark:text-neutral-600"
        >
          ✕
        </button>
      )}
    </li>
  )
}

function LocationManager({ locations }: { locations: ShoppingLocation[] }) {
  const [name, setName] = useState('')
  const [type, setType] = useState<'physical' | 'online'>('physical')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  return (
    <div className="location-manager list-card mt-2 overflow-hidden rounded-2xl bg-white dark:bg-neutral-800">
      <ul>
        {locations.map((loc) => (
          <li
            key={loc.id}
            className="flex items-center gap-2.5 border-b border-black/5 px-4 py-2.5
              dark:border-white/10"
          >
            <span aria-hidden className="text-[13px]">
              {loc.type === 'online' ? '🌐' : '🏬'}
            </span>
            {editingId === loc.id ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                  setEditingId(null)
                  if (draft.trim()) void renameLocation(loc.id, draft)
                }}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                className="min-h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none"
              />
            ) : (
              <button
                onClick={() => {
                  setEditingId(loc.id)
                  setDraft(loc.name)
                }}
                className="min-h-11 min-w-0 flex-1 truncate text-left text-[15px]"
              >
                {loc.name}
              </button>
            )}
            {confirmId === loc.id ? (
              <button
                onClick={() => {
                  setConfirmId(null)
                  void softDeleteLocation(loc.id)
                }}
                className="min-h-11 shrink-0 rounded-xl bg-red-500 px-2 text-[12px]
                  font-medium text-white"
              >
                确认删除
              </button>
            ) : (
              <button
                aria-label={`删除地点 ${loc.name}`}
                onClick={() => {
                  setConfirmId(loc.id)
                  setTimeout(() => setConfirmId(null), 3000)
                }}
                className="hit-target -mr-2 shrink-0 text-neutral-300 dark:text-neutral-600"
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 px-4 py-2.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="新建地点（超市 / 便利店 / 网站…）"
          className="min-h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none
            placeholder:text-neutral-400"
        />
        <select
          aria-label="地点类型"
          value={type}
          onChange={(e) => setType(e.target.value as 'physical' | 'online')}
          className="min-h-11 rounded-xl bg-neutral-100 px-2 text-[13px] dark:bg-neutral-700"
        >
          <option value="physical">实体</option>
          <option value="online">网站</option>
        </select>
        <button
          onClick={() => {
            void addLocation(name, type)
            setName('')
          }}
          disabled={!name.trim()}
          className="min-h-11 px-1 text-[15px] font-medium text-[#2f765f] disabled:opacity-40"
        >
          添加
        </button>
      </div>
    </div>
  )
}

export default function Shopping() {
  const [name, setName] = useState('')
  const [qty, setQty] = useState('')
  const [locationId, setLocationId] = useState('')
  const [manualLocation, setManualLocation] = useState(false)
  const [grouped, setGrouped] = useState(
    () => localStorage.getItem('shoppingGrouped') !== 'flat',
  )
  const [showHistory, setShowHistory] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)

  const items = useLiveQuery(
    () => db.shoppingItems.where('lifecycleStatus').equals('active').sortBy('rank'),
    [],
  )
  const locations = useLiveQuery(
    () =>
      db.shoppingLocations.where('lifecycleStatus').equals('active').sortBy('rank'),
    [],
  )
  const allLocations = useLiveQuery(() => db.shoppingLocations.toArray(), [])
  const locName = (id?: string, snapshot?: string) => {
    if (!id) return snapshot
    return (
      allLocations?.find((l) => l.id === id)?.name ?? snapshot ?? '（已删地点）'
    )
  }

  const pending = (items ?? []).filter((i) => i.purchaseStatus === 'pending')
  const purchased = (items ?? [])
    .filter((i) => i.purchaseStatus === 'purchased')
    .sort((a, b) => (b.purchasedAt ?? '').localeCompare(a.purchasedAt ?? ''))

  // 频次建议：输入同名商品时按已购历史自动预选地点（手动选择优先）
  useEffect(() => {
    if (manualLocation || !name.trim() || !items || !locations) return
    const suggestion = suggestLocationId(
      name,
      items.filter((i) => i.purchaseStatus === 'purchased'),
      new Set(locations.map((l) => l.id)),
    )
    if (suggestion) setLocationId(suggestion)
  }, [name, items, locations, manualLocation])

  async function submit() {
    if (submittingRef.current || !name.trim()) return
    submittingRef.current = true
    setSubmitting(true)
    setFeedback('')
    try {
      const count = await addItems({
        names: name,
        quantity: qty ? Number(qty) : undefined,
        locationId: locationId || undefined,
      })
      setName('')
      setQty('')
      setManualLocation(false)
      setLocationId('')
      setFeedback(count > 1 ? `已添加 ${count} 件商品` : '商品已添加')
      window.setTimeout(() => setFeedback(''), 2200)
    } catch (reason) {
      console.error('添加商品失败', reason)
      setFeedback(reason instanceof Error ? reason.message : '添加失败，请重试')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  function switchGrouped(g: boolean) {
    setGrouped(g)
    localStorage.setItem('shoppingGrouped', g ? 'grouped' : 'flat')
  }

  // 按地点分组：实体在前、网站在后、无地点最后（v4.2 需求 §3）
  const groups: { label: string; icon: string; items: ShoppingItem[] }[] = []
  if (grouped && locations) {
    for (const loc of [...locations].sort((a, b) =>
      a.type === b.type ? a.rank.localeCompare(b.rank) : a.type === 'physical' ? -1 : 1,
    )) {
      const list = pending.filter((i) => i.locationId === loc.id)
      if (list.length > 0)
        groups.push({
          label: loc.name,
          icon: loc.type === 'online' ? '🌐' : '🏬',
          items: list,
        })
    }
    const known = new Set(locations.map((l) => l.id))
    const unassigned = pending.filter((i) => !i.locationId || !known.has(i.locationId))
    if (unassigned.length > 0)
      groups.push({ label: '未指定地点', icon: '·', items: unassigned })
  }

  return (
    <section className="app-page">
      <PageHeader
        title="购物"
        eyebrow={`${pending.length} 件待购`}
        actions={<div
          role="tablist"
          aria-label="清单视图"
          className="segmented-control flex rounded-lg bg-black/5 p-0.5 text-[13px] dark:bg-white/10"
        >
          <button
            role="tab"
            aria-selected={grouped}
            onClick={() => switchGrouped(true)}
            className={`min-h-11 rounded-md px-3 py-1 transition ${
              grouped ? 'is-active bg-white shadow-sm dark:bg-neutral-700' : 'text-neutral-500'
            }`}
          >
            按地点
          </button>
          <button
            role="tab"
            aria-selected={!grouped}
            onClick={() => switchGrouped(false)}
            className={`min-h-11 rounded-md px-3 py-1 transition ${
              !grouped ? 'is-active bg-white shadow-sm dark:bg-neutral-700' : 'text-neutral-500'
            }`}
          >
            平铺
          </button>
        </div>}
      />

      <div className="quick-card mt-4 rounded-2xl bg-white/70 p-2 shadow-sm
        ring-1 ring-black/5 dark:bg-neutral-800/70 dark:ring-white/5">
        <div className="shopping-composer-row flex items-center gap-2">
          <textarea
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit()
            }
          }}
          rows={1}
          placeholder="添加商品；多项可换行粘贴…"
          enterKeyHint="done"
          className="min-h-11 min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5
            text-[16px] leading-6 outline-none placeholder:text-neutral-400"
          />
          <input
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="数量"
          aria-label="数量"
          className="w-16 rounded-xl bg-neutral-100 px-2 py-2.5 text-center text-[15px]
            outline-none placeholder:text-neutral-400 dark:bg-neutral-800"
          />
          <button
          onClick={() => void submit()}
          disabled={!name.trim() || submitting}
          aria-label="添加"
          className="primary-action h-11 w-11 shrink-0 rounded-xl bg-[#2f765f] text-xl
            text-white transition active:scale-95 disabled:opacity-40"
          >
            +
          </button>
        </div>
        {(locations?.length ?? 0) > 0 && (
          <div className="shopping-meta-row mt-1 flex items-center gap-2 px-1 pb-1">
            <span className="shrink-0 text-[12px] font-medium text-neutral-500">购买地点</span>
            <select
              aria-label="购买地点"
              value={locationId}
              onChange={(e) => {
                setLocationId(e.target.value)
                setManualLocation(true)
              }}
              className="min-h-10 min-w-0 flex-1 truncate rounded-xl bg-black/[0.035]
                px-2.5 text-[13px] text-neutral-600 dark:bg-white/[0.07] dark:text-neutral-300"
            >
              <option value="">不指定</option>
              {locations!.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.type === 'online' ? '线上 · ' : '实体 · '}
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <p role="status" className="min-h-5 px-2 pt-1 text-[12px] text-neutral-500">
        {feedback}
      </p>
      <details className="location-management mt-1">
        <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1 px-1
          text-[13px] font-medium text-neutral-500">
          管理购买地点 <span className="tabular text-neutral-400">· {locations?.length ?? 0}</span>
        </summary>
        <LocationManager locations={locations ?? []} />
      </details>

      {pending.length === 0 ? (
        <div
          className="mt-6 rounded-2xl border border-dashed border-neutral-300 p-8
            text-center text-neutral-400 dark:border-neutral-700"
        >
          清单是空的
        </div>
      ) : grouped ? (
        groups.map((g) => (
          <div key={g.label} className="mt-5">
            <p className="px-1 text-[13px] font-medium text-neutral-400">
              {g.icon} {g.label} · {g.items.length}
            </p>
            <ul className="list-card mt-1.5 rounded-2xl bg-white px-3 dark:bg-neutral-800">
              {g.items.map((i) => (
                <ItemRow key={i.id} item={i} />
              ))}
            </ul>
          </div>
        ))
      ) : (
        <ul className="list-card mt-4 rounded-2xl bg-white px-3 dark:bg-neutral-800">
          {pending.map((i) => (
            <ItemRow key={i.id} item={i} locationLabel={locName(i.locationId)} />
          ))}
        </ul>
      )}

      {purchased.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowHistory((s) => !s)}
            className="px-1 text-[13px] font-medium text-neutral-400"
          >
            {showHistory ? '▾' : '▸'} 已购历史 · {purchased.length}
          </button>
          {showHistory && (
            <ul className="list-card mt-2 rounded-2xl bg-white px-3 dark:bg-neutral-800">
              {purchased.slice(0, 30).map((i) => (
                <ItemRow
                  key={i.id}
                  item={i}
                  locationLabel={locName(i.locationId, i.locationNameSnapshot)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
