import { useMemo, useRef, useState } from 'react'
import { Temporal } from 'temporal-polyfill'
import AppIcon from './AppIcon'
import GestureSheet, { type GestureSheetHandle } from './GestureSheet'
import type { ColorToken, DateTypeDefinition, DateTypeMarker } from '../lib/db'
import {
  applyDateTypeMarkers,
  clearDateTypeMarkers,
  deleteDateTypeDefinition,
  saveDateTypeDefinition,
} from '../lib/dateTypeMarkers'

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']
const TYPE_COLORS: ColorToken[] = ['gray', 'blue', 'green', 'orange', 'pink', 'purple']

function monthDates(month: Temporal.PlainDate) {
  const first = month.with({ day: 1 })
  const leading = first.dayOfWeek - 1
  const start = first.subtract({ days: leading })
  return Array.from({ length: 42 }, (_, index) => start.add({ days: index }).toString())
}

export default function DateMarkerSheet({
  month,
  definitions,
  markers,
  onClose,
  onFeedback,
}: {
  month: Temporal.PlainDate
  definitions: DateTypeDefinition[]
  markers: DateTypeMarker[]
  onClose: () => void
  onFeedback: (value: string) => void
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const sheetRef = useRef<GestureSheetHandle>(null)
  const dates = useMemo(() => monthDates(month), [month])
  const monthKey = month.toString().slice(0, 7)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [typeId, setTypeId] = useState(definitions[0]?.id ?? '')
  const [customName, setCustomName] = useState('')
  const [manageOpen, setManageOpen] = useState(false)
  const [managedName, setManagedName] = useState('')
  const [managedColor, setManagedColor] = useState<ColorToken>('orange')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const markerTypeByDate = useMemo(() => {
    const result = new Map<string, Set<string>>()
    for (const marker of markers) {
      if (marker.lifecycleStatus !== 'active') continue
      const set = result.get(marker.date) ?? new Set<string>()
      set.add(marker.typeId)
      result.set(marker.date, set)
    }
    return result
  }, [markers])

  function toggleDate(date: string) {
    if (!date.startsWith(monthKey)) return
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  async function apply() {
    if (!selected.size || !typeId || saving) return
    setSaving(true)
    setError('')
    try {
      await applyDateTypeMarkers([...selected], typeId)
      const label = definitions.find((item) => item.id === typeId)?.name ?? '日期类型'
      onFeedback(`已为 ${selected.size} 天标记“${label}”`)
      sheetRef.current?.close()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function clear() {
    if (!selected.size || saving) return
    setSaving(true)
    setError('')
    try {
      await clearDateTypeMarkers([...selected], typeId || undefined)
      onFeedback(`已清除 ${selected.size} 天的日期标记`)
      sheetRef.current?.close()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '清除失败')
    } finally {
      setSaving(false)
    }
  }

  async function addCustomType() {
    if (!customName.trim()) return
    try {
      const id = await saveDateTypeDefinition({ name: customName, colorToken: 'orange' })
      setTypeId(id)
      setCustomName('')
      onFeedback('日期类型已添加')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '新增类型失败')
    }
  }

  function beginManage() {
    const current = definitions.find((definition) => definition.id === typeId)
    if (!current) return
    setManagedName(current.name)
    setManagedColor(current.colorToken)
    setManageOpen(true)
  }

  async function saveManagedType() {
    if (!typeId || !managedName.trim() || saving) return
    setSaving(true)
    setError('')
    try {
      await saveDateTypeDefinition({ id: typeId, name: managedName, colorToken: managedColor })
      setManageOpen(false)
      onFeedback('日期类型已更新')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '更新类型失败')
    } finally {
      setSaving(false)
    }
  }

  async function removeManagedType() {
    if (!typeId || saving) return
    const current = definitions.find((definition) => definition.id === typeId)
    if (!current || !window.confirm(`删除“${current.name}”及其全部日期标记？`)) return
    setSaving(true)
    setError('')
    try {
      await deleteDateTypeDefinition(typeId)
      setTypeId(definitions.find((definition) => definition.id !== typeId)?.id ?? '')
      setManageOpen(false)
      onFeedback('日期类型及其标记已删除')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除类型失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <GestureSheet
      ref={sheetRef}
      dialogRef={dialogRef}
      labelledBy="date-marker-title"
      className="editor-sheet date-marker-sheet"
      onClose={onClose}
    >
      <div className="date-marker-sheet-layout">
        <header className="date-marker-sheet-header" data-sheet-drag-handle>
          <button type="button" onClick={() => sheetRef.current?.close()}>取消</button>
          <h2 id="date-marker-title">批量标记日期</h2>
          <button type="button" className="primary" disabled={!selected.size || !typeId || saving} onClick={() => void apply()}>
            {saving ? '保存中' : '完成'}
          </button>
        </header>
        <div className="date-marker-sheet-body">
          <div className="date-marker-type-tabs" role="radiogroup" aria-label="日期类型">
            {definitions.map((definition) => (
              <button
                type="button"
                role="radio"
                aria-checked={typeId === definition.id}
                data-color-token={definition.colorToken}
                key={definition.id}
                onClick={() => setTypeId(definition.id)}
              >
                <span aria-hidden />{definition.name}
              </button>
            ))}
          </div>
          <div className="date-marker-month-label">{month.year} 年 {month.month} 月 · 已选 {selected.size} 天</div>
          <div className="date-marker-week-labels">{WEEK_LABELS.map((label) => <span key={label}>{label}</span>)}</div>
          <div className="date-marker-grid">
            {dates.map((date) => {
              const inMonth = date.startsWith(monthKey)
              const active = selected.has(date)
              const existingTypes = markerTypeByDate.get(date) ?? new Set<string>()
              return (
                <button
                  type="button"
                  key={date}
                  disabled={!inMonth}
                  aria-pressed={active}
                  onClick={() => toggleDate(date)}
                >
                  <span>{Number(date.slice(8))}</span>
                  <i aria-hidden>{definitions.slice(0, 3).map((definition) => existingTypes.has(definition.id) ? <b key={definition.id} data-color-token={definition.colorToken} /> : null)}</i>
                </button>
              )
            })}
          </div>
          <div className="date-marker-custom-type">
            <input value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder="新增其他类型" />
            <button type="button" disabled={!customName.trim()} onClick={() => void addCustomType()}><AppIcon name="plus" size={17} /> 添加</button>
          </div>
          {typeId && (
            <section className="date-marker-type-management" aria-label="管理日期类型">
              <button type="button" className="date-marker-manage-trigger" aria-expanded={manageOpen} onClick={beginManage}>
                <span>管理当前类型</span>
                <AppIcon name="chevronDown" size={16} />
              </button>
              {manageOpen && (
                <div className="date-marker-manage-fields">
                  <input value={managedName} onChange={(event) => setManagedName(event.target.value)} aria-label="类型名称" />
                  <div className="date-marker-color-options" role="radiogroup" aria-label="类型颜色">
                    {TYPE_COLORS.map((color) => (
                      <button
                        type="button"
                        key={color}
                        data-color-token={color}
                        role="radio"
                        aria-checked={managedColor === color}
                        onClick={() => setManagedColor(color)}
                      ><span aria-hidden /></button>
                    ))}
                  </div>
                  <div className="date-marker-manage-actions">
                    <button type="button" disabled={!managedName.trim() || saving} onClick={() => void saveManagedType()}>保存修改</button>
                    <button type="button" className="danger" disabled={saving} onClick={() => void removeManagedType()}>删除类型</button>
                  </div>
                </div>
              )}
            </section>
          )}
          <button type="button" className="date-marker-clear" disabled={!selected.size || saving} onClick={() => void clear()}>清除所选日期的当前类型</button>
          {error && <p role="alert">{error}</p>}
        </div>
      </div>
    </GestureSheet>
  )
}
