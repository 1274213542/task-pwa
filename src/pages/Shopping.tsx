import { useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { db, type ShoppingItem, type ShoppingLocation } from '../lib/db'
import {
  addItemsDetailed,
  addLocation,
  markPurchased,
  moveShoppingItem,
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
import { FOCUS_QUICK_ADD_EVENT } from '../lib/appEvents'
import { MOTION } from '../lib/motion'

const SHOPPING_TONES: ColorToken[] = ['green', 'blue', 'purple', 'orange', 'pink']

function ItemRow({
  item,
  locationLabel,
  tone = 'green',
  locations = [],
  menuOpen = false,
  onMenuToggle,
  onMove,
  liRef,
  liStyle,
  dragProps,
  dragging = false,
}: {
  item: ShoppingItem
  locationLabel?: string
  tone?: ColorToken
  locations?: ShoppingLocation[]
  menuOpen?: boolean
  onMenuToggle?: () => void
  onMove?: (locationId?: string) => void
  liRef?: (node: HTMLLIElement | null) => void
  liStyle?: CSSProperties
  dragProps?: ButtonHTMLAttributes<HTMLButtonElement>
  dragging?: boolean
}) {
  const reduceMotion = useReducedMotion()
  const [confirming, setConfirming] = useState(false)
  const purchased = item.purchaseStatus === 'purchased'

  return (
    <motion.li
      ref={liRef}
      style={liStyle}
      layout="position"
      initial={false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
      transition={reduceMotion ? MOTION.reduced : MOTION.list}
      data-color-token={tone}
      data-completed={purchased || undefined}
      data-menu-open={menuOpen || undefined}
      className="shopping-card row-in relative flex items-center gap-3"
      data-dragging={dragging || undefined}
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

      {!purchased && (
        <div className="shopping-item-actions">
          <button
            type="button"
            aria-label={`移动或整理 ${item.name}`}
            aria-expanded={menuOpen}
            onClick={onMenuToggle}
            className="shopping-item-more hit-target"
          >
            <AppIcon name="more" size={19} />
          </button>
          {menuOpen && (
            <div className="shopping-move-menu" role="menu">
              <p>移动到…</p>
              <button role="menuitem" onClick={() => onMove?.(undefined)}>未指定地点</button>
              {locations.map((location) => (
                <button
                  key={location.id}
                  role="menuitem"
                  onClick={() => onMove?.(location.id)}
                >
                  {location.name}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            aria-label={`长按拖动 ${item.name}`}
            className="shopping-drag-handle hit-target"
            {...dragProps}
          >
            <AppIcon name="drag" size={18} />
          </button>
        </div>
      )}

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
    </motion.li>
  )
}

function SortableShoppingRow(props: Omit<Parameters<typeof ItemRow>[0], 'liRef' | 'liStyle' | 'dragProps' | 'dragging'>) {
  const sortable = useSortable({ id: props.item.id })
  return (
    <ItemRow
      {...props}
      liRef={sortable.setNodeRef}
      liStyle={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        opacity: sortable.isDragging ? 0.2 : 1,
      }}
      dragProps={{ ...sortable.attributes, ...sortable.listeners }}
      dragging={sortable.isDragging}
    />
  )
}

function ShoppingDropGroup({
  id,
  children,
}: {
  id: string
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `shopping-group:${id}` })
  return (
    <div ref={setNodeRef} className="shopping-drop-group" data-over={isOver || undefined}>
      {children}
    </div>
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
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [moveMenuId, setMoveMenuId] = useState<string | null>(null)
  const nameRef = useRef<HTMLTextAreaElement>(null)
  const submittingRef = useRef(false)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 260, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

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
      const result = await addItemsDetailed({
        names: name,
        quantity: qty ? Number(qty) : undefined,
        locationId: locationId || undefined,
      })
      if (result.created > 0) {
        setName('')
        setQty('')
        setComposerOpen(false)
        nameRef.current?.blur()
        setManualLocation(false)
        setLocationId('')
      }
      const failureText = result.failures.length
        ? `；失败 ${result.failures.map((item) => `第 ${item.line} 行「${item.value.slice(0, 18)}」：${item.reason}`).join('、')}`
        : ''
      setFeedback(`已添加 ${result.created} 件商品${failureText}`)
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
    setMoveMenuId(null)
    setGrouped(g)
    localStorage.setItem('shoppingGrouped', g ? 'grouped' : 'flat')
  }

  // 按地点分组：实体在前、网站在后、无地点最后（v4.2 需求 §3）
  const groups: {
    id: string
    locationId?: string
    label: string
    type: 'physical' | 'online' | 'unassigned'
    items: ShoppingItem[]
    purchasedCount: number
  }[] = []
  if (grouped && locations) {
    for (const loc of [...locations].sort((a, b) =>
      a.type === b.type ? a.rank.localeCompare(b.rank) : a.type === 'physical' ? -1 : 1,
    )) {
      const list = pending.filter((i) => i.locationId === loc.id)
      groups.push({
        id: loc.id,
        locationId: loc.id,
        label: loc.name,
        type: loc.type,
        items: list,
        purchasedCount: purchased.filter((item) => item.locationId === loc.id).length,
      })
    }
    const known = new Set(locations.map((l) => l.id))
    const unassigned = pending.filter((i) => !i.locationId || !known.has(i.locationId))
    if (unassigned.length > 0)
      groups.push({
        id: 'unassigned',
        label: '未指定地点',
        type: 'unassigned',
        items: unassigned,
        purchasedCount: purchased.filter((item) => !item.locationId || !known.has(item.locationId)).length,
      })
  }

  async function moveTo(item: ShoppingItem, nextLocationId?: string) {
    const targetItems = pending
      .filter((candidate) => candidate.id !== item.id && candidate.locationId === nextLocationId)
      .sort((a, b) => a.rank.localeCompare(b.rank))
    await moveShoppingItem(
      item.id,
      nextLocationId,
      targetItems.at(-1)?.rank ?? null,
      null,
      [...targetItems.map((candidate) => candidate.id), item.id],
    )
    setMoveMenuId(null)
  }

  function onDragStart(event: DragStartEvent) {
    setMoveMenuId(null)
    setActiveItemId(String(event.active.id))
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveItemId(null)
    if (!event.over) return
    const active = pending.find((item) => item.id === String(event.active.id))
    if (!active) return
    const overId = String(event.over.id)
    const overItem = pending.find((item) => item.id === overId)
    const locationId = overId.startsWith('shopping-group:')
      ? overId.slice('shopping-group:'.length) || undefined
      : overItem?.locationId
    const normalizedLocationId = grouped
      ? locationId === 'unassigned' ? undefined : locationId
      : active.locationId
    const targetItems = pending
      .filter((item) =>
        item.id !== active.id && (!grouped || item.locationId === normalizedLocationId),
      )
      .sort((a, b) => a.rank.localeCompare(b.rank))

    let insertIndex = targetItems.length
    if (overItem) {
      const overIndex = targetItems.findIndex((item) => item.id === overItem.id)
      const activeTop = event.active.rect.current.translated?.top ?? 0
      const after = activeTop > event.over.rect.top + event.over.rect.height / 2
      insertIndex = Math.max(0, overIndex + (after ? 1 : 0))
    }
    const beforeRank = targetItems[insertIndex - 1]?.rank ?? null
    const afterRank = targetItems[insertIndex]?.rank ?? null
    const orderedIds = targetItems.map((item) => item.id)
    orderedIds.splice(insertIndex, 0, active.id)
    void moveShoppingItem(
      active.id,
      normalizedLocationId,
      beforeRank,
      afterRank,
      orderedIds,
    )
  }

  const activeItem = pending.find((item) => item.id === activeItemId)

  return (
    <section className="app-page page-shopping">
      <MobilePageHeader
        title="购物清单"
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
        title="购物清单"
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
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void submit()
            }
          }}
          rows={3}
          placeholder="每行一件商品；Enter 换行…"
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
        <p className="batch-input-hint">Enter 换行 · ⌘/Ctrl + Enter 添加全部</p>
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

      <LayoutGroup id="shopping-layout">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragCancel={() => setActiveItemId(null)}
        onDragEnd={onDragEnd}
        autoScroll
      >
        {pending.length === 0 ? (
          <div className="shopping-empty-state mt-6">
            <MarkerIcon symbol="flower" color="green" size={52} />
            <strong>清单是空的</strong>
            <span>添加商品后会按地点和状态清楚归类</span>
          </div>
        ) : grouped ? (
          <div className="shopping-group-stack">
          {groups.map((g) => (
            <ShoppingDropGroup key={g.id} id={g.id}>
              <section className="shopping-group-section">
                <header className="shopping-group-title">
                  <AppIcon
                    name={g.type === 'online' ? 'browse' : g.type === 'physical' ? 'shopping' : 'category'}
                    size={17}
                  />
                  <span>{g.label}</span>
                  <span className="shopping-group-count">
                    待购 {g.items.length} · 已购 {g.purchasedCount}
                  </span>
                </header>
                <SortableContext
                  items={g.items.map((item) => item.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="shopping-card-list">
                    <AnimatePresence initial={false} mode="popLayout">
                    {g.items.map((item, index) => (
                      <SortableShoppingRow
                        key={item.id}
                        item={item}
                        locations={locations ?? []}
                        menuOpen={moveMenuId === item.id}
                        onMenuToggle={() => setMoveMenuId((current) => current === item.id ? null : item.id)}
                        onMove={(nextLocationId) => void moveTo(item, nextLocationId)}
                        tone={SHOPPING_TONES[index % SHOPPING_TONES.length]}
                      />
                    ))}
                    </AnimatePresence>
                  </ul>
                </SortableContext>
                {g.items.length === 0 && <div className="shopping-group-empty">拖动商品到这里</div>}
              </section>
            </ShoppingDropGroup>
          ))}
          </div>
        ) : (
          <SortableContext
            items={pending.map((item) => item.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="shopping-card-list mt-4">
              <AnimatePresence initial={false} mode="popLayout">
              {pending.map((item, index) => (
                <SortableShoppingRow
                  key={item.id}
                  item={item}
                  locationLabel={locName(item.locationId)}
                  locations={locations ?? []}
                  menuOpen={moveMenuId === item.id}
                  onMenuToggle={() => setMoveMenuId((current) => current === item.id ? null : item.id)}
                  onMove={(nextLocationId) => void moveTo(item, nextLocationId)}
                  tone={SHOPPING_TONES[index % SHOPPING_TONES.length]}
                />
              ))}
              </AnimatePresence>
            </ul>
          </SortableContext>
        )}
        <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(.22,.78,.2,1)' }}>
          {activeItem ? (
            <div className="shopping-drag-overlay">
              <AppIcon name="shopping" size={20} />
              <strong>{activeItem.name}</strong>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

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
              <AnimatePresence initial={false} mode="popLayout">
              {purchased.slice(0, 30).map((i, index) => (
                <ItemRow
                  key={i.id}
                  item={i}
                  locationLabel={locName(i.locationId, i.locationNameSnapshot)}
                  tone={SHOPPING_TONES[index % SHOPPING_TONES.length]}
                />
              ))}
              </AnimatePresence>
            </ul>
          )}
        </div>
      )}
      </LayoutGroup>
    </section>
  )
}
