import { useEffect, useRef } from 'react'
import type { Category, TaskScheduleType } from '../lib/db'
import type { Recurrence } from '../lib/recurrence'
import GestureSheet, { type GestureSheetHandle } from './GestureSheet'
import RecurrencePicker from './RecurrencePicker'
import SegmentedIndicator from './SegmentedIndicator'
import TaskIntentSelector from './TaskIntentSelector'
import CategoryPickerControl from './CategoryPickerControl'

export default function BatchTaskSettingsSheet({
  fixed,
  recurrence,
  categories,
  categoryId,
  scheduleType,
  scheduleStart,
  scheduleDue,
  showBeforeStart,
  surfaceDaysBeforeDue,
  onTaskTypeChange,
  onRecurrenceChange,
  onCategoryChange,
  onScheduleTypeChange,
  onScheduleDueChange,
  onShowBeforeStartChange,
  onSurfaceDaysBeforeDueChange,
  onManageCategories,
  onClose,
}: {
  fixed: boolean
  recurrence: Recurrence | undefined
  categories: Category[]
  categoryId: string
  scheduleType: TaskScheduleType
  scheduleStart: string
  scheduleDue: string
  showBeforeStart: boolean
  surfaceDaysBeforeDue: number
  onTaskTypeChange: (fixed: boolean) => void
  onRecurrenceChange: (recurrence: Recurrence | undefined) => void
  onCategoryChange: (categoryId: string) => void
  onScheduleTypeChange: (scheduleType: TaskScheduleType) => void
  onScheduleDueChange: (scheduleDue: string) => void
  onShowBeforeStartChange: (show: boolean) => void
  onSurfaceDaysBeforeDueChange: (days: number) => void
  onManageCategories?: () => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const sheetRef = useRef<GestureSheetHandle>(null)

  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    <GestureSheet
      ref={sheetRef}
      dialogRef={dialogRef}
      labelledBy="batch-task-settings-title"
      className="editor-sheet task-batch-settings-sheet"
      onClose={onClose}
    >
      <div className="task-batch-settings-layout">
        <header className="task-batch-settings-header" data-sheet-drag-handle>
          <button type="button" onClick={() => sheetRef.current?.close()}>关闭</button>
          <h2 id="batch-task-settings-title">批量设置</h2>
          <button type="button" className="primary" onClick={() => sheetRef.current?.close()}>
            完成
          </button>
        </header>

        <div className="task-batch-settings-body">
          <section className="task-batch-settings-section" aria-labelledby="batch-task-type-title">
            <h3 id="batch-task-type-title">任务类型</h3>
            <div className="task-batch-type-control" role="radiogroup" aria-label="任务类型">
              <SegmentedIndicator index={fixed ? 1 : 0} count={2} className="task-batch-type-indicator" />
              <button type="button" role="radio" aria-checked={!fixed} onClick={() => onTaskTypeChange(false)}>
                普通任务
              </button>
              <button type="button" role="radio" aria-checked={fixed} onClick={() => onTaskTypeChange(true)}>
                固定任务
              </button>
            </div>
          </section>

          {fixed ? (
            <section className="task-batch-settings-section" aria-labelledby="batch-recurrence-title">
              <h3 id="batch-recurrence-title">循环规则</h3>
              <RecurrencePicker
                value={recurrence}
                onChange={(next) => {
                  if (!next) onTaskTypeChange(false)
                  else onRecurrenceChange(next)
                }}
              />
            </section>
          ) : (
            <section className="task-batch-settings-section" aria-labelledby="batch-schedule-title">
              <h3 id="batch-schedule-title">任务归属</h3>
              <TaskIntentSelector value={scheduleType} onChange={onScheduleTypeChange} compact />
              {scheduleType !== 'unscheduled' && (
                <label className="task-batch-setting-field">
                  <span>DDL</span>
                  <span className="task-batch-setting-input-row">
                    <input
                      type="datetime-local"
                      min={scheduleStart ? `${scheduleStart}T00:00` : undefined}
                      value={scheduleDue}
                      onChange={(event) => onScheduleDueChange(event.target.value)}
                    />
                    {scheduleDue && (
                      <button type="button" onClick={() => onScheduleDueChange('')}>清除</button>
                    )}
                  </span>
                </label>
              )}
            </section>
          )}

          <section className="task-batch-settings-section" aria-labelledby="batch-category-title">
            <h3 id="batch-category-title">分类</h3>
            <CategoryPickerControl
              categories={categories}
              value={categoryId}
              onChange={onCategoryChange}
              onManage={onManageCategories}
            />
          </section>

          {!fixed && scheduleType === 'longTerm' && (
            <section className="task-batch-settings-section" aria-labelledby="batch-display-title">
              <h3 id="batch-display-title">显示时机</h3>
              <button
                type="button"
                role="switch"
                aria-checked={showBeforeStart}
                className="task-batch-setting-toggle"
                onClick={() => onShowBeforeStartChange(!showBeforeStart)}
              >
                <span>开始日期前仍显示</span>
                <i aria-hidden />
              </button>
              <label className="task-batch-surface-days">
                <span>提前进入近期</span>
                <span>
                  <input
                    type="number"
                    min={0}
                    max={90}
                    value={surfaceDaysBeforeDue}
                    onChange={(event) => onSurfaceDaysBeforeDueChange(
                      Math.min(90, Math.max(0, Number(event.target.value) || 0)),
                    )}
                  />
                  天
                </span>
              </label>
            </section>
          )}
        </div>
      </div>
    </GestureSheet>
  )
}
