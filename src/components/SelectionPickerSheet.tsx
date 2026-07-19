import { useMemo, useRef, useState, type ReactNode } from 'react'
import AppIcon from './AppIcon'
import GestureSheet, { type GestureSheetHandle } from './GestureSheet'

export interface SelectionPickerItem {
  id: string
  title: string
  subtitle?: string
  leading?: ReactNode
}

export default function SelectionPickerSheet({
  id,
  title,
  eyebrow,
  items,
  selectedId,
  searchPlaceholder = '搜索',
  emptyLabel = '没有匹配项目',
  createPlaceholder,
  createLabel = '添加并选中',
  onCreate,
  footerActionLabel,
  onFooterAction,
  onSelect,
  onClose,
}: {
  id: string
  title: string
  eyebrow?: string
  items: SelectionPickerItem[]
  selectedId?: string
  searchPlaceholder?: string
  emptyLabel?: string
  createPlaceholder?: string
  createLabel?: string
  onCreate?: (name: string) => Promise<string>
  footerActionLabel?: string
  onFooterAction?: () => void
  onSelect: (id: string) => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const sheetRef = useRef<GestureSheetHandle>(null)
  const pendingSelectionRef = useRef<string | undefined>(undefined)
  const pendingFooterActionRef = useRef(false)
  const [search, setSearch] = useState('')
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [feedback, setFeedback] = useState('')
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const filteredItems = useMemo(
    () => items.filter((item) =>
      !normalizedSearch || `${item.title} ${item.subtitle ?? ''}`.toLocaleLowerCase().includes(normalizedSearch),
    ),
    [items, normalizedSearch],
  )

  async function create() {
    if (!onCreate || creating || !newName.trim()) return
    setCreating(true)
    setFeedback('')
    try {
      const nextId = await onCreate(newName.trim())
      pendingSelectionRef.current = nextId
      sheetRef.current?.close()
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '添加失败')
    } finally {
      setCreating(false)
    }
  }

  return (
    <GestureSheet
      ref={sheetRef}
      dialogRef={dialogRef}
      labelledBy={`${id}-title`}
      className="editor-sheet selection-picker-sheet"
      onClose={() => {
        const pendingSelection = pendingSelectionRef.current
        if (pendingSelection !== undefined) onSelect(pendingSelection)
        if (pendingFooterActionRef.current) onFooterAction?.()
        onClose()
      }}
    >
      <div className="selection-picker-layout">
        <header>
          <button type="button" aria-label="关闭" onClick={() => sheetRef.current?.close()}>
            <AppIcon name="close" size={20} />
          </button>
          <div>
            {eyebrow && <span>{eyebrow}</span>}
            <h2 id={`${id}-title`}>{title}</h2>
          </div>
          <span className="selection-picker-header-spacer" aria-hidden />
        </header>
        <label className="selection-picker-search">
          <AppIcon name="search" size={18} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={searchPlaceholder}
          />
        </label>
        <div className="selection-picker-list" role="listbox" aria-label={title}>
          {filteredItems.map((item) => (
            <button
              key={item.id || '__empty'}
              type="button"
              role="option"
              aria-selected={selectedId === item.id}
              onClick={() => {
                pendingSelectionRef.current = item.id
                sheetRef.current?.close()
              }}
            >
              {item.leading && <span className="selection-picker-leading">{item.leading}</span>}
              <span className="selection-picker-copy">
                <strong>{item.title}</strong>
                {item.subtitle && <small>{item.subtitle}</small>}
              </span>
              {selectedId === item.id && <AppIcon name="check" size={18} />}
            </button>
          ))}
          {!filteredItems.length && <p>{emptyLabel}</p>}
        </div>
        {onCreate && createPlaceholder && (
          <div className="selection-picker-create">
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void create()
                }
              }}
              placeholder={createPlaceholder}
            />
            <button type="button" disabled={creating || !newName.trim()} onClick={() => void create()}>
              {creating ? '添加中…' : createLabel}
            </button>
          </div>
        )}
        {(footerActionLabel || feedback) && (
          <footer>
            <span role="status">{feedback}</span>
            {footerActionLabel && <button type="button" onClick={() => {
              pendingFooterActionRef.current = true
              sheetRef.current?.close()
            }}>{footerActionLabel}</button>}
          </footer>
        )}
      </div>
    </GestureSheet>
  )
}
