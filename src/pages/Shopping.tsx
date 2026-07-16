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
import AppIcon from '../components/AppIcon'
import MarkerIcon from '../components/MarkerIcon'
import type { ColorToken } from '../lib/db'
import MobilePageHeader from '../components/MobilePageHeader'
import { FOCUS_QUICK_ADD_EVENT } from '../App'

const SHOPPING_TONES: ColorToken[] = ['green', 'blue', 'purple', 'orange', 'pink']

function ItemRow({
  item,
  locationLabel,
  tone = 'green',
}: {
  item: ShoppingItem
  locationLabel?: string
  tone?: ColorToken
}) {
  const [confirming, setConfirming] = useState(false)
  const purchased = item.purchaseStatus === 'purchased'

  return (
    <li
      data-color-token={tone}
      data-completed={purchased || undefined}
      className="shopping-card row-in flex items-center gap-3"
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
                ? 'shopping-check is-complete text-white'
                : 'border-neutral-300 dark:border-neutral-600'
            }`}
        >
          {purchased && (
            <AppIcon name="check" size={13} weight="bold" />
          )}
        </span>
      </button>

      <span className="shopping-marker" aria-hidden>
        <MarkerIcon symbol="squircle" color={tone} size={27} />
      </span>

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
          <AppIcon name="close" size={19} />
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
            <span aria-hidden className="location-type-icon">
              <AppIcon name={loc.type === 'online' ? 'browse' : 'shopping'} size={17} />
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
                <AppIcon name="close" size={18} />
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
          className="shopping-secondary-action min-h-11 px-1 text-[15px] font-medium disabled:opacity-40"
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
  const [composerOpen, setComposerOpen] = useState(false)
  const nameRef = useRef<HTMLTextAreaElement>(null)
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

  useEffect(() => {
    const openComposer = () => {
      setComposerOpen(true)
      window.requestAnimationFrame(() => nameRef.current?.focus())
    }
    window.addEventListener(FOCUS_QUICK_ADD_EVENT, openComposer)
    return () => window.removeEventListener(FOCUS_QUICK_ADD_EVENT, openComposer)
  }, [])

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
      setComposerOpen(false)
      nameRef.current?.blur()
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
  const groups: {
    label: string
    type: 'physical' | 'online' | 'unassigned'
    items: ShoppingItem[]
  }[] = []
  if (grouped && locations) {
    for (const loc of [...locations].sort((a, b) =>
      a.type === b.type ? a.rank.localeCompare(b.rank) : a.type === 'physical' ? -1 : 1,
    )) {
      const list = pending.filter((i) => i.locationId === loc.id)
      if (list.length > 0)
        groups.push({
          label: loc.name,
          type: loc.type,
          items: list,
        })
    }
    const known = new Set(locations.map((l) => l.id))
    const unassigned = pending.filter((i) => !i.locationId || !known.has(i.locationId))
    if (unassigned.length > 0)
      groups.push({ label: '未指定地点', type: 'unassigned', items: unassigned })
  }

  return (
    <section className="app-page page-shopping">
      <MobilePageHeader
        title="Shopping List"
        eyebrow={`${pending.length} 件待购`}
        onPrimary={() => setComposerOpen((open) => !open)}
        primaryLabel={composerOpen ? '收起新增商品' : '新增商品'}
        primaryIcon={composerOpen ? 'close' : 'plus'}
      />
      <div className="mobile-shopping-view-switch" role="tablist" aria-label="清单视图">
        <button role="tab" aria-selected={grouped} onClick={() => switchGrouped(true)}>
          <AppIcon name="category" size={18} />
          按地点
        </button>
        <button role="tab" aria-selected={!grouped} onClick={() => switchGrouped(false)}>
          <AppIcon name="list" size={18} />
          平铺
        </button>
      </div>
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

      {composerOpen && <div className="quick-card shopping-composer-card mt-4 rounded-2xl bg-white/70 p-2 shadow-sm
        ring-1 ring-black/5 dark:bg-neutral-800/70 dark:ring-white/5">
        <div className="shopping-composer-row flex items-center gap-2">
          <textarea
          ref={nameRef}
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
          className="primary-action h-11 w-11 shrink-0 rounded-xl text-xl
            text-white transition active:scale-95 disabled:opacity-40"
          >
            <AppIcon name="plus" size={23} />
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
      </div>}
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
          className="shopping-empty-state mt-6"
        >
          <MarkerIcon symbol="flower" color="green" size={52} />
          <strong>清单是空的</strong>
          <span>添加商品后会按地点和状态清楚归类</span>
        </div>
      ) : grouped ? (
        groups.map((g) => (
          <div key={g.label} className="mt-5">
            <p className="shopping-group-title">
              <AppIcon
                name={g.type === 'online' ? 'browse' : g.type === 'physical' ? 'shopping' : 'category'}
                size={17}
              />
              <span>{g.label}</span>
              <span className="shopping-group-count">{g.items.length}</span>
            </p>
            <ul className="shopping-card-list mt-1.5">
              {g.items.map((i, index) => (
                <ItemRow key={i.id} item={i} tone={SHOPPING_TONES[index % SHOPPING_TONES.length]} />
              ))}
            </ul>
          </div>
        ))
      ) : (
        <ul className="shopping-card-list mt-4">
          {pending.map((i, index) => (
            <ItemRow
              key={i.id}
              item={i}
              locationLabel={locName(i.locationId)}
              tone={SHOPPING_TONES[index % SHOPPING_TONES.length]}
            />
          ))}
        </ul>
      )}

      {purchased.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowHistory((s) => !s)}
            className="px-1 text-[13px] font-medium text-neutral-400"
          >
            <AppIcon name={showHistory ? 'chevronDown' : 'chevronRight'} size={16} />
            已购历史 · {purchased.length}
          </button>
          {showHistory && (
            <ul className="shopping-card-list is-history mt-2">
              {purchased.slice(0, 30).map((i, index) => (
                <ItemRow
                  key={i.id}
                  item={i}
                  locationLabel={locName(i.locationId, i.locationNameSnapshot)}
                  tone={SHOPPING_TONES[index % SHOPPING_TONES.length]}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
