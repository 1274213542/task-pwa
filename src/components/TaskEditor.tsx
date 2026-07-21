import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { CalItem } from '../lib/calendar'
import { db, type Category, type ColorToken, type MarkerSymbol, type TaskScheduleType } from '../lib/db'
import { softDeleteTask, updateTask } from '../lib/tasks'
import type { Recurrence } from '../lib/recurrence'
import VisualPicker from './VisualPicker'
import GestureSheet, { type GestureSheetHandle } from './GestureSheet'
import {
  civilDateOf,
  descendantTaskIds,
  effectiveTaskSchedule,
  taskDueStatus,
  taskNodeRoleOf,
  taskScheduleTypeOf,
} from '../lib/taskSchedule'
import { useCivilDate } from '../lib/useCivilDate'
import TaskIntentSelector from './TaskIntentSelector'
import RecurrencePicker from './RecurrencePicker'
import { effectiveRecurrence } from '../lib/taskViews'

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
  const isPlan = taskNodeRoleOf(task) === 'plan'
  const originalStatus: EditableTaskStatus = item.skipped
    ? 'skipped'
    : item.completed
      ? 'completed'
      : 'pending'
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes ?? '')
  const [endDate, setEndDate] = useState(task.endDate ?? '')
  const [categoryId, setCategoryId] = useState(task.categoryId ?? '')
  const initialRecurrence = effectiveRecurrence(task)
  const [scheduleType, setScheduleType] = useState<TaskScheduleType>(initialRecurrence ? 'longTerm' : taskScheduleTypeOf(task))
  const [scheduleStart, setScheduleStart] = useState(
    civilDateOf(task.startAt ?? task.startDate) ?? item.date,
  )
  const [scheduleTime, setScheduleTime] = useState(
    task.startAt?.includes('T') ? task.startAt.slice(11, 16) : '',
  )
  const [scheduleDueDate, setScheduleDueDate] = useState(civilDateOf(task.dueAt) ?? '')
  const [scheduleDueTime, setScheduleDueTime] = useState(
    task.dueAt?.includes('T') ? task.dueAt.slice(11, 16) : '',
  )
  const [recurrence, setRecurrence] = useState<Recurrence | undefined>(initialRecurrence)
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<GestureSheetHandle>(null)
  const allTasks = useLiveQuery(
    () => db.tasks.where('lifecycleStatus').equals('active').sortBy('rank'),
    [],
  ) ?? []
  const invalidParentIds = descendantTaskIds(task.id, allTasks)
  invalidParentIds.add(task.id)
  const parentCandidates = allTasks.filter((candidate) => !invalidParentIds.has(candidate.id))
  const planCandidates = parentCandidates.filter((candidate) => taskNodeRoleOf(candidate) === 'plan')
  const taskParentCandidates = parentCandidates.filter((candidate) => taskNodeRoleOf(candidate) === 'task')
  const selectedParent = allTasks.find((candidate) => candidate.id === parentTaskId)
  const selectedParentRole = selectedParent ? taskNodeRoleOf(selectedParent) : undefined
  const effective = effectiveTaskSchedule(task, allTasks)
  const dueStatus = item.completed
    ? { tone: 'completed' as const, label: '已完成', days: null }
    : taskDueStatus(task, todayISO, allTasks)

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.focus({ preventScroll: true })
      scrollRef.current?.scrollTo({ top: 0 })
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
        startDate: scheduleStart || task.startDate || item.date,
        endDate: recurrence ? endDate || undefined : undefined,
        taskScope: recurrence?.mode === 'fixed_schedule' && recurrence.frequency === 'weekly'
          ? 'weekly'
          : 'daily',
        recurrence: isPlan ? null : recurrence ?? null,
        visualToken,
        markerSymbol,
        scheduleType,
        startAt: scheduleType === 'unscheduled' || inheritsParentSchedule
          ? undefined
          : scheduleTime ? `${scheduleStart}T${scheduleTime}` : scheduleStart,
        dueAt: inheritsParentSchedule || !scheduleDueDate
          ? undefined
          : scheduleDueTime ? `${scheduleDueDate}T${scheduleDueTime}` : scheduleDueDate,
        showBeforeStart,
        surfaceDaysBeforeDue,
        parentTaskId: parentTaskId || undefined,
        inheritsParentSchedule: Boolean(parentTaskId) && inheritsParentSchedule,
        extendParentDue,
        nodeRole: task.nodeRole,
      })
      if (!isPlan && status !== originalStatus) await onStatusChange(status)
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

        <div ref={scrollRef} className="task-editor-scroll">
        <div className="task-editor-fields">
          <label className="task-editor-field">
            任务名称
            <input value={title} onChange={(event) => setTitle(event.target.value)} className="field" />
          </label>

          <section className="task-editor-core" aria-labelledby="task-belonging-title">
            <div className="task-editor-section-heading">
              <h3 id="task-belonging-title">任务归属</h3>
              {dueStatus.label && <strong data-due-tone={dueStatus.tone}>{dueStatus.label}</strong>}
            </div>
            {isPlan ? (
              <p className="task-editor-plan-note">计划用于组织任务，不产生完成记录或时间轴事项。</p>
            ) : <TaskIntentSelector
              value={inheritsParentSchedule ? effective.type : scheduleType}
              disabled={inheritsParentSchedule}
              compact
              onChange={(next) => {
                setScheduleType(next)
                if (next !== 'unscheduled' && !scheduleStart) setScheduleStart(todayISO)
                if (next === 'today') setRecurrence(undefined)
              }}
            />}
          </section>

          <section className="task-editor-core" aria-labelledby="task-schedule-title">
            <div className="task-editor-section-heading">
              <h3 id="task-schedule-title">时间与排期</h3>
            </div>
            <div className="task-editor-schedule-grid" aria-disabled={inheritsParentSchedule || undefined}>
              {(inheritsParentSchedule ? effective.type : scheduleType) !== 'unscheduled' && (
                <label className="task-editor-field">
                  {(inheritsParentSchedule ? effective.type : scheduleType) === 'today' ? '执行日期' : '开始日期'}
                  <input
                    type="date"
                    className="field"
                    disabled={inheritsParentSchedule}
                    value={inheritsParentSchedule ? civilDateOf(effective.startAt) ?? '' : scheduleStart}
                    onChange={(event) => {
                      const next = event.target.value
                      setScheduleStart(next)
                      if (endDate && endDate < next) setEndDate(next)
                    }}
                  />
                </label>
              )}
              {(inheritsParentSchedule ? effective.type : scheduleType) !== 'unscheduled' && (
                <label className="task-editor-field">
                  具体时间
                  <span className="task-editor-time-row">
                    <input
                      type="time"
                      className="field"
                      disabled={inheritsParentSchedule}
                      value={inheritsParentSchedule
                        ? effective.startAt?.includes('T') ? effective.startAt.slice(11, 16) : ''
                        : scheduleTime}
                      onChange={(event) => setScheduleTime(event.target.value)}
                    />
                    {!inheritsParentSchedule && scheduleTime && (
                      <button type="button" onClick={() => setScheduleTime('')}>清除时间</button>
                    )}
                  </span>
                  {!scheduleTime && !inheritsParentSchedule && <small>未排定时间</small>}
                </label>
              )}
              <div className="task-editor-due-grid">
                <label className="task-editor-field">
                  DDL 日期
                  <input
                    type="date"
                    className="field"
                    disabled={inheritsParentSchedule}
                    min={scheduleStart || undefined}
                    value={inheritsParentSchedule ? civilDateOf(effective.dueAt) ?? '' : scheduleDueDate}
                    onChange={(event) => setScheduleDueDate(event.target.value)}
                  />
                </label>
                <label className="task-editor-field">
                  DDL 时间
                  <span className="task-editor-time-row">
                    <input
                      type="time"
                      className="field"
                      disabled={inheritsParentSchedule || !scheduleDueDate}
                      value={inheritsParentSchedule && effective.dueAt?.includes('T')
                        ? effective.dueAt.slice(11, 16)
                        : scheduleDueTime}
                      onChange={(event) => setScheduleDueTime(event.target.value)}
                    />
                    {!inheritsParentSchedule && scheduleDueTime && (
                      <button type="button" onClick={() => setScheduleDueTime('')}>清除时间</button>
                    )}
                  </span>
                </label>
              </div>
            </div>

            {!isPlan && scheduleType === 'longTerm' && !inheritsParentSchedule && (
              <div className="task-editor-recurrence">
                <span>循环规则</span>
                <RecurrencePicker
                  value={recurrence}
                  onChange={(next) => {
                    setRecurrence(next)
                    if (next) setScheduleType('longTerm')
                  }}
                />
                {recurrence && (
                  <label className="task-editor-field">
                    系列结束日期
                    <input type="date" min={scheduleStart} value={endDate} onChange={(event) => setEndDate(event.target.value)} className="field" />
                  </label>
                )}
              </div>
            )}
          </section>

          {!isPlan && <section className="task-editor-core" aria-labelledby="task-relation-title">
            <div className="task-editor-section-heading"><h3 id="task-relation-title">任务关系</h3></div>
            <label className="task-editor-field">
              所属计划
              <select
                className="field"
                value={selectedParentRole === 'plan' ? parentTaskId : ''}
                onChange={(event) => {
                  if (event.target.value) {
                    setParentTaskId(event.target.value)
                    setInheritsParentSchedule(false)
                  } else if (selectedParentRole === 'plan') {
                    setParentTaskId('')
                  }
                }}
              >
                <option value="">不加入计划</option>
                {planCandidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>{candidate.title}</option>
                ))}
              </select>
            </label>
            <details className="task-parent-advanced">
              <summary>父任务高级设置</summary>
              <label className="task-editor-field">
                父任务
                <select
                  className="field"
                  value={selectedParentRole === 'task' ? parentTaskId : ''}
                  onChange={(event) => {
                    if (event.target.value) {
                      setParentTaskId(event.target.value)
                      setInheritsParentSchedule(false)
                    } else if (selectedParentRole === 'task') {
                      setParentTaskId('')
                    }
                  }}
                >
                  <option value="">无父任务</option>
                  {taskParentCandidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.title}</option>
                  ))}
                </select>
              </label>
              {selectedParentRole === 'task' && (
                <label className="task-editor-switch-row">
                  <input type="checkbox" checked={inheritsParentSchedule} onChange={(event) => setInheritsParentSchedule(event.target.checked)} />
                  <span>沿用父任务日期与 DDL</span>
                </label>
              )}
              {selectedParentRole === 'task' && !inheritsParentSchedule && (
                <label className="task-editor-switch-row">
                  <input type="checkbox" checked={extendParentDue} onChange={(event) => setExtendParentDue(event.target.checked)} />
                  <span>若子任务更晚，同步延长父任务 DDL</span>
                </label>
              )}
            </details>
          </section>}

          <details className="task-editor-more-settings">
            <summary>更多设置</summary>
            <div className="task-editor-more-grid">
              {scheduleType === 'longTerm' && !inheritsParentSchedule && (
                <div className="task-editor-display-rules">
                  <strong>显示规则</strong>
                  <label className="task-editor-switch-row">
                    <input type="checkbox" checked={showBeforeStart} onChange={(event) => setShowBeforeStart(event.target.checked)} />
                    <span>开始日期前仍显示</span>
                  </label>
                  <label>提前 <input type="number" min={0} max={90} value={surfaceDaysBeforeDue} onChange={(event) => setSurfaceDaysBeforeDue(Number(event.target.value) || 0)} /> 天进入近期</label>
                </div>
              )}
              <label className="task-editor-field">分类
                <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="field">
                  <option value="">无分类</option>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </label>
              {!isPlan && <label className="task-editor-field">状态
                <select
                  value={status}
                  disabled={item.occurrenceKey === 'template'}
                  onChange={(event) => setStatus(event.target.value as EditableTaskStatus)}
                  className="field"
                >
                  <option value="pending">{item.occurrenceKey === 'template' ? '长期模板' : '待完成'}</option>
                  {item.occurrenceKey !== 'template' && <option value="completed">已完成</option>}
                  {!['single', 'template'].includes(item.occurrenceKey) && <option value="skipped">已跳过</option>}
                </select>
              </label>}
              <label className="task-editor-field task-editor-notes">备注
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={2}
                  placeholder="补充说明"
                  className="field"
                />
              </label>
              <VisualPicker color={visualToken} marker={markerSymbol} onColorChange={setVisualToken} onMarkerChange={setMarkerSymbol} />
            </div>
          </details>
        </div>

        <div className="task-editor-danger-zone">
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
              ? isPlan
                ? '确认删除计划，保留计划内任务'
                : task.recurrence
                ? '确认删除整个系列'
                : '确认删除任务'
              : isPlan ? '删除计划' : '删除任务'}
          </button>
        </div>
        <p role="status" className="mt-2 min-h-5 text-[13px] text-red-500">
          {error}
        </p>
        </div>
    </GestureSheet>
  )
}
