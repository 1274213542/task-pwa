import { useEffect, useMemo, useRef, useState } from 'react'
import type { Task, TaskScheduleType } from '../lib/db'
import { parseTimedBatchEntries } from '../lib/batch'
import { todayLocalISO } from '../lib/dates'
import { addTaskBatch } from '../lib/tasks'
import {
  civilDateOf,
  effectiveTaskSchedule,
} from '../lib/taskSchedule'
import AppIcon from './AppIcon'

export default function InlinePlanChildComposer({
  parent,
  tasks,
  date,
  scheduleType,
  onCancel,
  onSaved,
}: {
  parent: Task
  tasks: Task[]
  date?: string
  scheduleType?: TaskScheduleType
  onCancel: () => void
  onSaved: (created: number) => void
}) {
  const [value, setValue] = useState('')
  const [feedback, setFeedback] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const entries = useMemo(() => parseTimedBatchEntries(value), [value])
  const invalid = entries.some((entry) => Boolean(entry.error))

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function submit() {
    if (saving || !value.trim() || invalid) return
    setSaving(true)
    setFeedback('')
    try {
      const inherited = effectiveTaskSchedule(parent, tasks)
      const targetDate =
        date ??
        civilDateOf(inherited.startAt) ??
        parent.startDate ??
        todayLocalISO()
      const result = await addTaskBatch({
        value,
        planId: parent.id,
        categoryId: parent.categoryId,
        startDate: targetDate,
        taskScope: parent.taskScope ?? 'daily',
        schedule: {
          scheduleType: scheduleType ?? inherited.type,
          startAt: targetDate,
          dueAt: inherited.dueAt,
          showBeforeStart: inherited.showBeforeStart,
          surfaceDaysBeforeDue: inherited.surfaceDaysBeforeDue,
        },
      })
      if (result.failures.length > 0) {
        setFeedback(result.failures[0]?.reason ?? '子项保存失败')
        return
      }
      setValue('')
      onSaved(result.created)
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : '子项保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="task-inline-child-composer"
      aria-label={`向 ${parent.title} 添加子项`}
      onClick={(event) => event.stopPropagation()}
    >
      <div>
        <strong>添加子项</strong>
        <button type="button" aria-label="取消添加子项" onClick={onCancel}>
          <AppIcon name="close" size={15} />
        </button>
      </div>
      <textarea
        ref={inputRef}
        rows={2}
        value={value}
        placeholder="输入子项；多项可换行，行首可写 08:30"
        aria-invalid={invalid || undefined}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void submit()
          }
        }}
      />
      {entries.some((entry) => entry.time || entry.error) && (
        <div className="task-inline-child-preview" aria-live="polite">
          {entries.map((entry) => (
            <span key={`${entry.line}:${entry.value}`} data-error={entry.error || undefined}>
              <time>{entry.time ?? '—'}</time>
              <b>{entry.title || entry.value}</b>
            </span>
          ))}
        </div>
      )}
      <div className="task-inline-child-actions">
        <span role={feedback ? 'alert' : 'status'}>
          {feedback || (entries.length > 0 ? `准备添加 ${entries.length} 项` : '')}
        </span>
        <button
          type="button"
          disabled={saving || !value.trim() || invalid}
          onClick={() => void submit()}
        >
          {saving ? '保存中…' : '保存子项'}
        </button>
      </div>
    </div>
  )
}
