import { useRef, useState } from 'react'
import type { CalItem } from '../lib/calendar'
import type { Category, TaskScope } from '../lib/db'
import { softDeleteTask, updateTask } from '../lib/tasks'
import { taskScopeOf } from '../lib/taskPeriods'

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
  const [status, setStatus] = useState<EditableTaskStatus>(originalStatus)
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState('')
  const savingRef = useRef(false)

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
      })
      if (status !== originalStatus) await onStatusChange(status)
      onClose()
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
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除失败，请重试')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <div
      className="modal-backdrop fixed inset-0 z-40 flex items-end justify-center bg-black/25
        px-3 pt-8 backdrop-blur-[2px] lg:items-center"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-editor-title"
        className="safe-bottom editor-sheet w-full max-w-lg rounded-t-[26px] bg-white px-5
          pb-5 pt-4 shadow-2xl lg:rounded-[24px] dark:bg-neutral-800"
      >
        <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-neutral-300 lg:hidden dark:bg-neutral-600" />
        <div className="flex items-center justify-between">
          <button onClick={onClose} className="hit-target text-[15px] text-neutral-500">
            取消
          </button>
          <h2 id="task-editor-title" className="text-[17px] font-semibold">
            编辑任务
          </h2>
          <button
            onClick={() => void save()}
            disabled={saving || !title.trim()}
            className="hit-target text-[15px] font-semibold text-[#007aff] disabled:opacity-40"
          >
            {saving ? '保存中' : '保存'}
          </button>
        </div>

        <div className="mt-3 space-y-3">
          <label className="block text-[12px] font-medium text-neutral-500">
            标题
            <input
              autoFocus
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
      </section>
    </div>
  )
}
