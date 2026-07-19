import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { CalItem } from '../lib/calendar'
import { db, type Category, type ColorToken, type MarkerSymbol, type TaskScheduleType, type TaskScope } from '../lib/db'
import { softDeleteTask, updateTask } from '../lib/tasks'
import { taskScopeOf } from '../lib/taskPeriods'
import VisualPicker from './VisualPicker'
import GestureSheet, { type GestureSheetHandle } from './GestureSheet'
import { civilDateOf, effectiveTaskSchedule, taskDueStatus, taskScheduleTypeOf } from '../lib/taskSchedule'
import { useCivilDate } from '../lib/useCivilDate'

export type EditableTaskStatus = 'pending' | 'completed' | 'skipped'

type TaskCalendarItem = Extract<CalItem, { kind: 'task' }>

export default function TaskEditor({
  item,
  categories,
  onStatusChange,
  onClose,
}: {
  item: TaskCalendarItem
  categories: Category[]
  onStatusChange: (status: EditableTaskStatus) => Promise<void>
  onClose: () => void
}) {
  const todayISO = useCivilDate()
  const { task } = item
  const originalStatus: EditableTaskStatus = item.skipped
    ? 'skipped'
    : item.completed
      ? 'completed'
      : 'pending'
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes ?? '')
  const [date, setDate] = useState(task.startDate ?? item.date)
  const [endDate, setEndDate] = useState(task.endDate ?? '')
  const [categoryId, setCategoryId] = useState(task.categoryId ?? '')
  const [scope, setScope] = useState<TaskScope>(taskScopeOf(task))
  const [scheduleType, setScheduleType] = useState<TaskScheduleType>(taskScheduleTypeOf(task))
  const [scheduleStart, setScheduleStart] = useState(
    civilDateOf(task.startAt ?? task.startDate) ?? item.date,
  )
  const [scheduleDue, setScheduleDue] = useState(() => {
    if (!task.dueAt) return ''
    return task.dueAt.includes('T') ? task.dueAt.slice(0, 16) : `${task.dueAt}T23:59`
  })
  const [showBeforeStart, setShowBeforeStart] = useState(task.showBeforeStart ?? false)
  const [surfaceDaysBeforeDue, setSurfaceDaysBeforeDue] = useState(task.surfaceDaysBeforeDue ?? 3)
  const [parentTaskId, setParentTaskId] = useState(task.parentTaskId ?? '')
  const [inheritsParentSchedule, setInheritsParentSchedule] = useState(task.inheritsParentSchedule ?? Boolean(task.parentTaskId))
  const [extendParentDue, setExtendParentDue] = useState(false)
  const [visualToken, setVisualToken] = useState<ColorToken | undefined>(task.visualToken)
  const [markerSymbol, setMarkerSymbol] = useState<MarkerSymbol | undefined>(task.markerSymbol)
  const [status, setStatus] = useState<EditableTaskStatus>(originalStatus)
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState('')
  const savingRef = useRef(false)
  const dialogRef = useRef<HTMLElement>(null)
  const sheetRef = useRef<GestureSheetHandle>(null)
  const allTasks = useLiveQuery(
    () => db.tasks.where('lifecycleStatus').equals('active').sortBy('rank'),
    [],
  ) ?? []
  const effective = effectiveTaskSchedule(task, allTasks)
  const dueStatus = item.completed
    ? { tone: 'completed' as const, label: '已完成', days: null }
    : taskDueStatus(task, todayISO, allTasks)

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
      await updateTask(task.id, {
        title,
        notes,
        categoryId: categoryId || undefined,
        startDate: date,
        endDate: task.recurrence ? endDate || undefined : undefined,
        taskScope: scope,
        visualToken,
        markerSymbol,
        scheduleType,
        startAt: scheduleType === 'unscheduled' || inheritsParentSchedule ? undefined : scheduleStart,
        dueAt: scheduleType === 'unscheduled' || inheritsParentSchedule ? undefined : scheduleDue || undefined,
        showBeforeStart,
        surfaceDaysBeforeDue,
        parentTaskId: parentTaskId || undefined,
        inheritsParentSchedule: Boolean(parentTaskId) && inheritsParentSchedule,
        extendParentDue,
      })
      if (status !== originalStatus) await onStatusChange(status)
      sheetRef.current?.close()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败，请重试')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  async function remove() {
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      await softDeleteTask(task.id)
      sheetRef.current?.close()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除失败，请重试')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <GestureSheet
      ref={sheetRef}
      dialogRef={dialogRef}
      labelledBy="task-editor-title"
      onClose={onClose}
      className="safe-bottom editor-sheet editor-sheet-task w-full max-w-lg rounded-t-[26px] bg-white px-5
        pb-5 pt-1 shadow-2xl outline-none lg:rounded-[24px] lg:pt-4 dark:bg-neutral-800"
    >
        <div className="editor-sheet-header flex items-center justify-between">
          <button onClick={() => sheetRef.current?.close()} className="hit-target text-[15px] text-neutral-500">
            取消
          </button>
          <h2 id="task-editor-title" className="text-[17px] font-semibold">
            编辑任务
          </h2>
          <button
            onClick={() => void save()}
            disabled={saving || !title.trim()}
            className="editor-save hit-target text-[15px] font-semibold disabled:opacity-40"
          >
            {saving ? '保存中' : '保存'}
          </button>
        </div>

        <div className="mt-3 space-y-3">
          <label className="block text-[12px] font-medium text-neutral-500">
            标题
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="field mt-1"
            />
          </label>
          <label className="block text-[12px] font-medium text-neutral-500">
            备注
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              placeholder="补充说明（可选）"
              className="field mt-1 resize-none"
            />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-[12px] font-medium text-neutral-500">
              {task.recurrence ? '系列开始日期' : '任务日期'}
              <input
                type="date"
                value={date}
                onChange={(event) => {
                  const next = event.target.value
                  setDate(next)
                  if (endDate && endDate < next) setEndDate(next)
                }}
                className="field mt-1"
              />
            </label>
            {task.recurrence && (
              <label className="text-[12px] font-medium text-neutral-500">
                系列结束日期
                <input
                  type="date"
                  min={date}
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="field mt-1"
                />
              </label>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="text-[12px] font-medium text-neutral-500">
              状态
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as EditableTaskStatus)}
                className="field mt-1"
              >
                <option value="pending">待完成</option>
                <option value="completed">已完成</option>
                {item.occurrenceKey !== 'single' && <option value="skipped">已跳过</option>}
              </select>
            </label>
            <label className="text-[12px] font-medium text-neutral-500">
              分类
              <select
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
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
            <label className="text-[12px] font-medium text-neutral-500">
              范围
              <select
                value={scope}
                disabled={Boolean(task.recurrence)}
                onChange={(event) => setScope(event.target.value as TaskScope)}
                className="field mt-1 disabled:opacity-60"
              >
                <option value="daily">每日</option>
                <option value="weekly">每周</option>
              </select>
            </label>
          </div>
          <section className="task-editor-schedule" aria-labelledby="task-schedule-title">
            <div className="task-editor-section-heading">
              <div>
                <span>时间关系</span>
                <h3 id="task-schedule-title">排期与 DDL</h3>
              </div>
              {dueStatus.label && <strong data-due-tone={dueStatus.tone}>{dueStatus.label}</strong>}
            </div>
            <label>
              父任务
              <select
                className="field mt-1"
                value={parentTaskId}
                onChange={(event) => {
                  setParentTaskId(event.target.value)
                  setInheritsParentSchedule(Boolean(event.target.value))
                }}
              >
                <option value="">无父任务</option>
                {allTasks.filter((candidate) => candidate.id !== task.id).map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>{candidate.title}</option>
                ))}
              </select>
            </label>
            {parentTaskId && (
              <label className="task-editor-switch-row">
                <input
                  type="checkbox"
                  checked={inheritsParentSchedule}
                  onChange={(event) => setInheritsParentSchedule(event.target.checked)}
                />
                <span>继承父任务的开始日期与 DDL</span>
              </label>
            )}
            <div className="task-editor-schedule-grid" aria-disabled={inheritsParentSchedule || undefined}>
              <label>
                时间类型
                <select
                  className="field mt-1"
                  value={inheritsParentSchedule ? effective.type : scheduleType}
                  disabled={inheritsParentSchedule}
                  onChange={(event) => setScheduleType(event.target.value as TaskScheduleType)}
                >
                  <option value="today">今日必须完成</option>
                  <option value="longTerm">长期任务</option>
                  <option value="unscheduled">未排期</option>
                </select>
              </label>
              {(inheritsParentSchedule ? effective.type : scheduleType) !== 'unscheduled' && (
                <label>
                  开始日期
                  <input
                    type="date"
                    className="field mt-1"
                    disabled={inheritsParentSchedule}
                    value={inheritsParentSchedule ? civilDateOf(effective.startAt) ?? '' : scheduleStart}
                    onChange={(event) => setScheduleStart(event.target.value)}
                  />
                </label>
              )}
              {(inheritsParentSchedule ? effective.type : scheduleType) !== 'unscheduled' && (
                <label>
                  DDL（可选时间）
                  <input
                    type="datetime-local"
                    className="field mt-1"
                    disabled={inheritsParentSchedule}
                    min={scheduleStart ? `${scheduleStart}T00:00` : undefined}
                    value={inheritsParentSchedule
                      ? effective.dueAt?.includes('T')
                        ? effective.dueAt.slice(0, 16)
                        : effective.dueAt ? `${effective.dueAt}T23:59` : ''
                      : scheduleDue}
                    onChange={(event) => setScheduleDue(event.target.value)}
                  />
                </label>
              )}
            </div>
            {scheduleType === 'longTerm' && !inheritsParentSchedule && (
              <div className="task-editor-schedule-options">
                <label className="task-editor-switch-row">
                  <input type="checkbox" checked={showBeforeStart} onChange={(event) => setShowBeforeStart(event.target.checked)} />
                  <span>开始日期前仍显示</span>
                </label>
                <label>
                  提前 <input type="number" min={0} max={90} value={surfaceDaysBeforeDue} onChange={(event) => setSurfaceDaysBeforeDue(Number(event.target.value) || 0)} /> 天进入近期
                </label>
              </div>
            )}
            {parentTaskId && !inheritsParentSchedule && (
              <label className="task-editor-switch-row">
                <input type="checkbox" checked={extendParentDue} onChange={(event) => setExtendParentDue(event.target.checked)} />
                <span>若子任务更晚，同步延长父任务 DDL</span>
              </label>
            )}
          </section>
          <VisualPicker
            color={visualToken}
            marker={markerSymbol}
            onColorChange={setVisualToken}
            onMarkerChange={setMarkerSymbol}
          />
          {task.recurrence && (
            <p className="text-[12px] leading-5 text-neutral-400">
              当前编辑会更新整个固定任务系列；本期完成状态仍独立保存。
            </p>
          )}
        </div>

        <div className="mt-3 border-t border-black/5 pt-3 dark:border-white/10">
          <button
            onClick={() => void remove()}
            disabled={saving}
            className={`min-h-11 w-full rounded-xl text-[14px] font-medium transition-colors ${
              confirmingDelete
                ? 'bg-red-500 text-white'
                : 'bg-red-500/10 text-red-500'
            }`}
          >
            {confirmingDelete
              ? task.recurrence
                ? '确认删除整个系列'
                : '确认删除任务'
              : '删除任务'}
          </button>
        </div>
        <p role="status" className="mt-2 min-h-5 text-[13px] text-red-500">
          {error}
        </p>
    </GestureSheet>
  )
}
