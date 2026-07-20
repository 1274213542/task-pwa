import { useMemo, useRef, useState } from 'react'
import { Temporal } from 'temporal-polyfill'
import AppIcon from './AppIcon'
import GestureSheet, { type GestureSheetHandle } from './GestureSheet'
import type { DateTypeDefinition, DateTypeMarker } from '../lib/db'
import {
  applyDateTypeMarkers,
  clearDateTypeMarkers,
  saveDateTypeDefinition,
} from '../lib/dateTypeMarkers'

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']

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
          <button type="button" className="date-marker-clear" disabled={!selected.size || saving} onClick={() => void clear()}>清除所选日期的当前类型</button>
          {error && <p role="alert">{error}</p>}
        </div>
      </div>
    </GestureSheet>
  )
}
