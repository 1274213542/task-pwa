import { createPortal } from 'react-dom'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
} from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
} from 'motion/react'
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
  type DragOverEvent,
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
  restoreShoppingItemPlacement,
  restoreDeletedItem,
  unmarkPurchased,
} from '../lib/shopping'
import PageHeader from '../components/PageHeader'
import AppIcon from '../components/AppIcon'
import MarkerIcon from '../components/MarkerIcon'
import type { ColorToken } from '../lib/db'
import MobilePageHeader from '../components/MobilePageHeader'
import { FOCUS_QUICK_ADD_EVENT } from '../lib/appEvents'
import { MOTION } from '../lib/motion'
import { compareRanks } from '../lib/rank'
import SegmentedIndicator from '../components/SegmentedIndicator'
import SwipeActionRow from '../components/SwipeActionRow'

const SHOPPING_TONES: ColorToken[] = ['green', 'blue', 'purple', 'orange', 'pink']

type ShoppingRowDragProps = Pick<
  HTMLAttributes<HTMLLIElement>,
  'onMouseDown' | 'onTouchStart'
>

type ShoppingDragHandleProps = ButtonHTMLAttributes<HTMLButtonElement>

const MOVE_UNDO_TIMEOUT_MS = 7_000

function stopDragActivation(event: { stopPropagation: () => void }) {
  event.stopPropagation()
}

function ItemRow({
  item,
  locationLabel,
  tone = 'green',
  locations = [],
  menuOpen = false,
  onMenuToggle,
  onMove,
  onDelete,
  liRef,
  liStyle,
  rowDragProps,
  dragHandleProps,
  dragging = false,
  divider = false,
}: {
  item: ShoppingItem
  locationLabel?: string
  tone?: ColorToken
  locations?: ShoppingLocation[]
  menuOpen?: boolean
  onMenuToggle?: () => void
  onMove?: (locationId?: string) => void
  onDelete?: () => void
  liRef?: (node: HTMLLIElement | null) => void
  liStyle?: CSSProperties
  rowDragProps?: ShoppingRowDragProps
  dragHandleProps?: ShoppingDragHandleProps
  dragging?: boolean
  divider?: boolean
}) {
  const reduceMotion = useReducedMotion()
  const [confirming, setConfirming] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPosition, setMenuPosition] = useState<CSSProperties | null>(null)
  const purchased = item.purchaseStatus === 'purchased'
  useLayoutEffect(() => {
    if (!menuOpen || !triggerRef.current) {
      setMenuPosition(null)
      return
    }

    const updatePosition = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const visualViewport = window.visualViewport
      const viewportWidth = visualViewport?.width ?? window.innerWidth
      const viewportHeight = visualViewport?.height ?? window.innerHeight
      const viewportTop = visualViewport?.offsetTop ?? 0
      const navRect = document.querySelector('.mobile-nav')?.getBoundingClientRect()
      const safeBottom = navRect && navRect.top > viewportTop
        ? navRect.top - 8
        : viewportTop + viewportHeight - 12
      const menuWidth = Math.min(210, viewportWidth - 24)
      const estimatedHeight = Math.min(260, 48 + (locations.length + 2) * 42)
      const shouldOpenUp = rect.bottom + 8 + estimatedHeight > safeBottom
      const availableHeight = shouldOpenUp
        ? Math.max(120, rect.top - viewportTop - 16)
        : Math.max(120, safeBottom - rect.bottom - 16)
      const top = shouldOpenUp
        ? Math.max(viewportTop + 8, rect.top - Math.min(estimatedHeight, availableHeight) - 8)
        : rect.bottom + 8
      const left = Math.max(
        8,
        Math.min(rect.right - menuWidth, viewportWidth - menuWidth - 8),
      )

      setMenuPosition({
        top,
        left,
        width: menuWidth,
        maxHeight: Math.min(260, availableHeight),
        transformOrigin: shouldOpenUp ? 'right bottom' : 'right top',
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.visualViewport?.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.visualViewport?.removeEventListener('resize', updatePosition)
    }
  }, [confirming, locations.length, menuOpen])

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
      data-shopping-swipe-id={item.id}
      className="shopping-swipe-row row-in"
      data-dragging={dragging || undefined}
      data-drag-enabled={rowDragProps ? true : undefined}
      {...rowDragProps}
    >
      <SwipeActionRow
        as="div"
        id={`shopping:${item.id}`}
        label={item.name}
        className="shopping-row-swipe"
        contentClassName="shopping-card shopping-swipe-foreground relative flex min-w-0 items-center gap-3"
        resetKey={`${item.locationId ?? 'unassigned'}:${dragging ? 'dragging' : 'idle'}`}
        divider={divider}
        fullSwipe={!purchased}
        actions={purchased ? [] : [
          {
            label: '更多',
            icon: 'more',
            tone: 'neutral',
            onSelect: () => onMenuToggle?.(),
          },
          {
            label: '删除',
            icon: 'trash',
            tone: 'danger',
            onSelect: () => onDelete?.(),
          },
        ]}
      >
      <button
        aria-label={purchased ? '恢复待购' : '已购买'}
        onClick={() =>
          purchased ? void unmarkPurchased(item.id) : void markPurchased(item)
        }
        onPointerDown={stopDragActivation}
        onMouseDown={stopDragActivation}
        onTouchStart={stopDragActivation}
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

      <div className="min-w-0 flex-1">
        <p
          className={`shopping-item-title strike truncate text-[15px] ${
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
          <p className="shopping-item-meta truncate text-[12px] text-neutral-400">
            {[locationLabel, item.note].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>

      {!purchased && <button
        type="button"
        ref={triggerRef}
        aria-label={`更多操作：${item.name}`}
        aria-expanded={menuOpen}
        onClick={onMenuToggle}
        onPointerDown={stopDragActivation}
        data-no-row-swipe
        className="shopping-item-more-sr"
      >
        更多操作
      </button>}
      {menuOpen && menuPosition && createPortal(
            <motion.div
              ref={menuRef}
              className="shopping-move-menu"
              role="menu"
              aria-label={`${item.name} 的操作菜单`}
              style={menuPosition}
              initial={reduceMotion ? false : { opacity: 0, scale: 0.97, y: 3 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={reduceMotion ? MOTION.reduced : MOTION.control}
            >
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
              {dragHandleProps && (
                <button
                  type="button"
                  {...dragHandleProps}
                  role="menuitem"
                  className="shopping-menu-drag"
                  aria-label={`拖动排序 ${item.name}`}
                >
                  <AppIcon name="drag" size={17} /> 长按或按空格拖动
                </button>
              )}
              {confirming ? (
                <button
                  type="button"
                  role="menuitem"
                  className="shopping-menu-delete is-confirming"
                  onClick={onDelete}
                >
                  确认删除
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className="shopping-menu-delete"
                  onClick={() => {
                    setConfirming(true)
                    setTimeout(() => setConfirming(false), 3000)
                  }}
                >
                  <AppIcon name="trash" size={17} /> 删除商品
                </button>
              )}
            </motion.div>,
            document.body,
          )}
      </SwipeActionRow>
    </motion.li>
  )
}

function SortableShoppingRow(props: Omit<Parameters<typeof ItemRow>[0], 'liRef' | 'liStyle' | 'rowDragProps' | 'dragHandleProps' | 'dragging'>) {
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
      rowDragProps={{
        onMouseDown: sortable.listeners?.onMouseDown,
        onTouchStart: sortable.listeners?.onTouchStart,
      } as ShoppingRowDragProps}
      dragHandleProps={{
        ...sortable.attributes,
        ...sortable.listeners,
      } as ShoppingDragHandleProps}
      dragging={sortable.isDragging}
    />
  )
}

function ShoppingDropGroup({
  id,
  children,
  dragging,
  highlighted,
}: {
  id: string
  children: React.ReactNode
  dragging: boolean
  highlighted: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `shopping-group:${id}` })
  return (
    <div
      ref={setNodeRef}
      className="shopping-drop-group"
      data-over={isOver || highlighted || undefined}
      data-drag-active={dragging || undefined}
    >
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
      <ul className="location-manager-list">
        {locations.map((loc) => (
          <li
            key={loc.id}
            className="location-manager-row flex items-center gap-2.5 px-4 py-2.5"
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
      <div className="location-manager-composer flex items-center gap-2 px-4 py-2.5">
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
  const [lastMove, setLastMove] = useState<{
    itemId: string
    locationId?: string
    rank: string
    expectedUpdatedAt: string
  } | null>(null)
  const [lastDeleted, setLastDeleted] = useState<{
    item: ShoppingItem
    expectedDeletedAt: string
  } | null>(null)
  const [dragTargetGroupId, setDragTargetGroupId] = useState<string | null>(null)
  const nameRef = useRef<HTMLTextAreaElement>(null)
  const submittingRef = useRef(false)
  const undoTimerRef = useRef<number | null>(null)
  const deleteUndoTimerRef = useRef<number | null>(null)
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

  useEffect(() => () => {
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current)
    if (deleteUndoTimerRef.current !== null) window.clearTimeout(deleteUndoTimerRef.current)
  }, [])

  useEffect(() => {
    if (!moveMenuId) return
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (
        target?.closest('.shopping-move-menu') ||
        target?.closest('[data-shopping-menu-trigger]')
      ) return
      setMoveMenuId(null)
    }
    const closeOnScroll = () => setMoveMenuId(null)
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoveMenuId(null)
    }
    const closeWhenHidden = () => {
      if (document.visibilityState !== 'visible') setMoveMenuId(null)
    }
    document.addEventListener('pointerdown', closeOutside, true)
    window.addEventListener('scroll', closeOnScroll, true)
    window.addEventListener('keydown', closeOnKey)
    document.addEventListener('visibilitychange', closeWhenHidden)
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true)
      window.removeEventListener('scroll', closeOnScroll, true)
      window.removeEventListener('keydown', closeOnKey)
      document.removeEventListener('visibilitychange', closeWhenHidden)
    }
  }, [moveMenuId])

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

  function offerMoveUndo(
    item: ShoppingItem,
    expectedUpdatedAt: string,
    message: string,
  ) {
    if (deleteUndoTimerRef.current !== null) window.clearTimeout(deleteUndoTimerRef.current)
    deleteUndoTimerRef.current = null
    setLastDeleted(null)
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current)
    setLastMove({
      itemId: item.id,
      locationId: item.locationId,
      rank: item.rank,
      expectedUpdatedAt,
    })
    setFeedback(message)
    undoTimerRef.current = window.setTimeout(() => {
      setLastMove((current) =>
        current?.expectedUpdatedAt === expectedUpdatedAt ? null : current,
      )
      setFeedback((current) => current === message ? '' : current)
      undoTimerRef.current = null
    }, MOVE_UNDO_TIMEOUT_MS)
  }

  async function moveTo(item: ShoppingItem, nextLocationId?: string) {
    setMoveMenuId(null)
    try {
      const targetItems = pending
        .filter((candidate) => candidate.id !== item.id && candidate.locationId === nextLocationId)
        .sort((a, b) => compareRanks(a.rank, b.rank))
      const expectedUpdatedAt = await moveShoppingItem(
        item.id,
        nextLocationId,
        targetItems.at(-1)?.rank ?? null,
        null,
        [...targetItems.map((candidate) => candidate.id), item.id],
      )
      const targetName = locations?.find((location) => location.id === nextLocationId)?.name ?? '未指定地点'
      offerMoveUndo(item, expectedUpdatedAt, `已移动到 ${targetName}`)
    } catch (reason) {
      console.error('移动商品失败', reason)
      setLastMove(null)
      setFeedback(reason instanceof Error ? `移动失败：${reason.message}` : '移动失败，商品仍在原位置')
    }
  }

  async function undoLastMove() {
    if (!lastMove) return
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current)
    undoTimerRef.current = null
    try {
      const restored = await restoreShoppingItemPlacement(
        lastMove.itemId,
        lastMove.locationId,
        lastMove.rank,
        lastMove.expectedUpdatedAt,
      )
      setLastMove(null)
      setFeedback(restored ? '已撤销移动' : '商品已发生新变化，无法撤销')
    } catch (reason) {
      console.error('撤销商品移动失败', reason)
      setLastMove(null)
      setFeedback(reason instanceof Error ? `撤销失败：${reason.message}` : '撤销失败，请重试')
    }
  }

  async function deleteItem(item: ShoppingItem) {
    setMoveMenuId(null)
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current)
    undoTimerRef.current = null
    setLastMove(null)
    try {
      const expectedDeletedAt = await softDeleteItem(item.id)
      setLastDeleted({ item, expectedDeletedAt })
      setFeedback(`已删除「${item.name}」`)
      if (deleteUndoTimerRef.current !== null) window.clearTimeout(deleteUndoTimerRef.current)
      deleteUndoTimerRef.current = window.setTimeout(() => {
        setLastDeleted((current) =>
          current?.expectedDeletedAt === expectedDeletedAt ? null : current,
        )
        setFeedback((current) => current === `已删除「${item.name}」` ? '' : current)
        deleteUndoTimerRef.current = null
      }, MOVE_UNDO_TIMEOUT_MS)
    } catch (reason) {
      console.error('删除商品失败', reason)
      setFeedback(reason instanceof Error ? `删除失败：${reason.message}` : '删除失败，请重试')
    }
  }

  async function undoLastDelete() {
    if (!lastDeleted) return
    if (deleteUndoTimerRef.current !== null) window.clearTimeout(deleteUndoTimerRef.current)
    deleteUndoTimerRef.current = null
    try {
      const restored = await restoreDeletedItem(
        lastDeleted.item.id,
        lastDeleted.expectedDeletedAt,
      )
      setLastDeleted(null)
      setFeedback(restored ? `已恢复「${lastDeleted.item.name}」` : '商品已发生新变化，无法撤销')
    } catch (reason) {
      console.error('撤销删除商品失败', reason)
      setLastDeleted(null)
      setFeedback(reason instanceof Error ? `撤销失败：${reason.message}` : '撤销失败，请重试')
    }
  }

  function onDragStart(event: DragStartEvent) {
    setMoveMenuId(null)
    setActiveItemId(String(event.active.id))
    setDragTargetGroupId(null)
  }

  function onDragOver(event: DragOverEvent) {
    if (!grouped || !event.over) {
      setDragTargetGroupId(null)
      return
    }
    const overId = String(event.over.id)
    const overItem = pending.find((item) => item.id === overId)
    const targetLocationId = overId.startsWith('shopping-group:')
      ? overId.slice('shopping-group:'.length)
      : overItem?.locationId
    setDragTargetGroupId(targetLocationId || 'unassigned')
  }

  async function onDragEnd(event: DragEndEvent) {
    setActiveItemId(null)
    setDragTargetGroupId(null)
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
      .sort((a, b) => compareRanks(a.rank, b.rank))

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
    try {
      const expectedUpdatedAt = await moveShoppingItem(
        active.id,
        normalizedLocationId,
        beforeRank,
        afterRank,
        orderedIds,
      )
      const targetName = locations?.find((location) => location.id === normalizedLocationId)?.name ?? '未指定地点'
      offerMoveUndo(active, expectedUpdatedAt, `已移动到 ${targetName}`)
    } catch (reason) {
      console.error('拖动商品失败', reason)
      setLastMove(null)
      setFeedback(reason instanceof Error ? `移动失败：${reason.message}` : '移动失败，商品仍在原位置')
    }
  }

  const activeItem = pending.find((item) => item.id === activeItemId)

  return (
    <section
      className="app-page page-shopping"
      data-shopping-view={grouped ? 'grouped' : 'flat'}
    >
      <div className="page-top-chrome page-top-chrome-shopping">
        <MobilePageHeader
          title="购物清单"
          eyebrow={`${pending.length} 件待购`}
          onPrimary={() => setComposerOpen((open) => !open)}
          primaryLabel={composerOpen ? '收起新增商品' : '新增商品'}
          primaryIcon={composerOpen ? 'chevronUp' : 'plus'}
        />
        <div className="mobile-shopping-view-switch" data-shared-indicator role="tablist" aria-label="清单视图">
          <SegmentedIndicator
            className="shopping-view-indicator"
            count={2}
            index={grouped ? 0 : 1}
          />
          <button role="tab" aria-selected={grouped} onClick={() => switchGrouped(true)}>
            <AppIcon name="category" size={18} />
            按地点
          </button>
          <button role="tab" aria-selected={!grouped} onClick={() => switchGrouped(false)}>
            <AppIcon name="list" size={18} />
            平铺
          </button>
        </div>
      </div>
      <PageHeader
        title="购物清单"
        eyebrow={`${pending.length} 件待购`}
        actions={<div
          role="tablist"
          aria-label="清单视图"
          data-shared-indicator
          className="segmented-control flex rounded-lg bg-black/5 p-0.5 text-[13px] dark:bg-white/10"
        >
          <SegmentedIndicator
            className="shopping-view-indicator"
            count={2}
            index={grouped ? 0 : 1}
          />
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
        <p className="batch-input-hint">
          <span className="mobile-composer-hint">每行一件商品</span>
          <span className="desktop-composer-hint">Enter 换行 · ⌘/Ctrl + Enter 添加全部</span>
        </p>
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
      <div role="status" className="shopping-feedback min-h-5 px-2 pt-1 text-[12px] text-neutral-500">
        <span>{feedback}</span>
        {lastMove && <button type="button" onClick={() => void undoLastMove()}>撤销</button>}
        {lastDeleted && <button type="button" onClick={() => void undoLastDelete()}>撤销</button>}
      </div>
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
        onDragOver={onDragOver}
        onDragCancel={() => {
          setActiveItemId(null)
          setDragTargetGroupId(null)
        }}
        onDragEnd={onDragEnd}
        autoScroll
      >
        {pending.length === 0 ? (
          <div className="shopping-empty-state mt-6">
            <MarkerIcon symbol="flower" color="green" size={52} />
            <strong>清单是空的</strong>
          </div>
        ) : grouped ? (
          <div className="shopping-group-stack">
          {groups.map((g) => (
            <ShoppingDropGroup
              key={g.id}
              id={g.id}
              dragging={Boolean(activeItemId)}
              highlighted={dragTargetGroupId === g.id}
            >
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
                        onMenuToggle={() => {
                          setMoveMenuId((current) => current === item.id ? null : item.id)
                        }}
                        onMove={(nextLocationId) => void moveTo(item, nextLocationId)}
                        onDelete={() => void deleteItem(item)}
                        tone={SHOPPING_TONES[index % SHOPPING_TONES.length]}
                        divider={index > 0}
                      />
                    ))}
                    </AnimatePresence>
                  </ul>
                </SortableContext>
                {activeItem && dragTargetGroupId === g.id && (
                  (activeItem.locationId ?? 'unassigned') !== g.id
                ) && g.items.length > 0 && (
                  <div className="shopping-drop-placeholder" role="status">
                    松手移动到 {g.label}
                  </div>
                )}
                {g.items.length === 0 && (activeItemId ? (
                  <div className="shopping-group-empty">拖动商品到这里</div>
                ) : (
                  <button
                    type="button"
                    className="shopping-group-empty-action"
                    onClick={() => {
                      setLocationId(g.locationId ?? '')
                      setManualLocation(Boolean(g.locationId))
                      setComposerOpen(true)
                    }}
                  >
                    <span>暂无商品</span>
                    <strong>＋ 添加</strong>
                  </button>
                ))}
              </section>
            </ShoppingDropGroup>
          ))}
          </div>
        ) : (
          <SortableContext
            items={pending.map((item) => item.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="shopping-card-list shopping-flat-list mt-4">
              <AnimatePresence initial={false} mode="popLayout">
              {pending.map((item, index) => (
                <SortableShoppingRow
                  key={item.id}
                  item={item}
                  locationLabel={locName(item.locationId)}
                  locations={locations ?? []}
                  menuOpen={moveMenuId === item.id}
                  onMenuToggle={() => {
                    setMoveMenuId((current) => current === item.id ? null : item.id)
                  }}
                  onMove={(nextLocationId) => void moveTo(item, nextLocationId)}
                  onDelete={() => void deleteItem(item)}
                  tone={SHOPPING_TONES[index % SHOPPING_TONES.length]}
                  divider={index > 0}
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
                  divider={index > 0}
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
