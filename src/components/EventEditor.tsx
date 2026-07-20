import { useEffect, useRef, useState } from 'react'
import { Temporal } from 'temporal-polyfill'
import type {
  CalendarEvent,
  Category,
  ColorToken,
  MarkerSymbol,
} from '../lib/db'
import { updateEvent } from '../lib/events'
import VisualPicker from './VisualPicker'
import GestureSheet, { type GestureSheetHandle } from './GestureSheet'

function localTime(event: CalendarEvent): string {
  if (!event.startAt) return ''
  return Temporal.Instant.from(event.startAt)
    .toZonedDateTimeISO(event.timezone ?? Temporal.Now.timeZoneId())
    .toPlainTime()
    .toString({ smallestUnit: 'minute' })
}

function localEndTime(event: CalendarEvent): string {
  if (!event.endAt) return ''
  return Temporal.Instant.from(event.endAt)
    .toZonedDateTimeISO(event.timezone ?? Temporal.Now.timeZoneId())
    .toPlainTime()
    .toString({ smallestUnit: 'minute' })
}

export default function EventEditor({
  event,
  categories,
  onClose,
}: {
  event: CalendarEvent
  categories: Category[]
  onClose: () => void
}) {
  const [title, setTitle] = useState(event.title)
  const [notes, setNotes] = useState(event.notes ?? '')
  const [date, setDate] = useState(event.startDate)
  const [endDate, setEndDate] = useState(event.endDate)
  const [time, setTime] = useState(localTime(event))
  const [endTime, setEndTime] = useState(localEndTime(event))
  const [categoryId, setCategoryId] = useState(event.categoryId ?? '')
  const [visualToken, setVisualToken] = useState<ColorToken | undefined>(event.visualToken)
  const [markerSymbol, setMarkerSymbol] = useState<MarkerSymbol | undefined>(event.markerSymbol)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const savingRef = useRef(false)
  const dialogRef = useRef<HTMLElement>(null)
  const sheetRef = useRef<GestureSheetHandle>(null)

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.focus({ preventScroll: true })
    })
    return () => {
      window.cancelAnimationFrame(frame)
      previous?.focus({ preventScroll: true })
    }
  }, [])

  async function save() {
    if (savingRef.current) return
    if (!title.trim()) {
      setError('请输入标题')
      return
    }
    savingRef.current = true
    setSaving(true)
    setError('')
    try {
      await updateEvent(event.id, {
        title,
        notes,
        date,
        endDate,
        time: time || undefined,
        endTime: time && endTime ? endTime : undefined,
        categoryId: categoryId || undefined,
        visualToken,
        markerSymbol,
        timezone: event.timezone,
      })
      sheetRef.current?.close()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败，请重试')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <GestureSheet
      ref={sheetRef}
      dialogRef={dialogRef}
      labelledBy="event-editor-title"
      onClose={onClose}
      className="safe-bottom editor-sheet editor-sheet-event w-full max-w-lg rounded-t-[26px] bg-white px-5 pb-5
        pt-1 shadow-2xl outline-none lg:rounded-[24px] lg:pt-4 dark:bg-neutral-800"
    >
        <div className="editor-sheet-header event-editor-header flex items-center justify-between" data-sheet-drag-handle>
          <button onClick={() => sheetRef.current?.close()} className="hit-target text-[15px] text-neutral-500">
            取消
          </button>
          <h2 id="event-editor-title" className="text-[17px] font-semibold">
            编辑计划
          </h2>
          <button
            onClick={() => void save()}
            disabled={saving || !title.trim()}
            className="editor-save hit-target text-[15px] font-semibold disabled:opacity-40"
          >
            {saving ? '保存中' : '保存'}
          </button>
        </div>

        <div className="event-editor-scroll">
        <div className="event-editor-fields space-y-3">
          <label className="block text-[12px] font-medium text-neutral-500">
            标题
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="field mt-1"
            />
          </label>
          <label className="block text-[12px] font-medium text-neutral-500">
            内容
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="备注（可选）"
              className="field mt-1 resize-none"
            />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-[12px] font-medium text-neutral-500">
              开始日期
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  const next = e.target.value
                  setDate(next)
                  if (endDate < next) setEndDate(next)
                }}
                className="field mt-1"
              />
            </label>
            <label className="text-[12px] font-medium text-neutral-500">
              结束日期
              <input
                type="date"
                min={date}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="field mt-1"
              />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-[12px] font-medium text-neutral-500">
              开始时间（可选）
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="field mt-1"
              />
            </label>
            <label className="text-[12px] font-medium text-neutral-500">
              结束时间（可选）
              <input
                type="time"
                value={endTime}
                disabled={!time}
                onChange={(e) => setEndTime(e.target.value)}
                className="field mt-1"
              />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-[12px] font-medium text-neutral-500">
              分类
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="field mt-1"
              >
                <option value="">无分类</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <VisualPicker
            color={visualToken}
            marker={markerSymbol}
            onColorChange={setVisualToken}
            onMarkerChange={setMarkerSymbol}
          />
        </div>
        <p role="status" className="event-editor-error mt-2 min-h-5 text-[13px] text-red-500">
          {error}
        </p>
        </div>
    </GestureSheet>
  )
}
