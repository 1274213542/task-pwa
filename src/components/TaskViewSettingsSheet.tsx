import { useEffect, useRef } from 'react'
import {
  DEFAULT_TASK_VIEW_SETTINGS,
  type TaskListDensity,
  type TaskPropertyFilter,
  type TaskSortMode,
  type TaskStatusFilter,
  type TaskViewSettings,
} from '../lib/taskViewSettings'
import GestureSheet, { type GestureSheetHandle } from './GestureSheet'

const STATUS: Array<[TaskStatusFilter, string]> = [
  ['all', '全部任务'],
  ['pending', '未完成'],
  ['completed', '已完成'],
]
const PROPERTY: Array<[TaskPropertyFilter, string]> = [
  ['all', '全部'],
  ['single', '普通任务'],
  ['recurring', '固定任务'],
]
const SORT: Array<[TaskSortMode, string]> = [
  ['manual', '手动排序'],
  ['updated', '最近更新'],
  ['created', '创建时间'],
  ['unfinished', '未完成优先'],
]
const DENSITY: Array<[TaskListDensity, string]> = [
  ['standard', '标准列表'],
  ['compact', '紧凑列表'],
]

function OptionGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: Array<[T, string]>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <fieldset className="task-view-setting-group">
      <legend>{label}</legend>
      <div role="group" aria-label={label}>
        {options.map(([id, text]) => (
          <button
            key={id}
            type="button"
            aria-pressed={value === id}
            onClick={() => onChange(id)}
          >
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

export default function TaskViewSettingsSheet({
  settings,
  onChange,
  onClose,
}: {
  settings: TaskViewSettings
  onChange: (settings: TaskViewSettings) => void
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
      labelledBy="task-view-settings-title"
      className="editor-sheet task-view-settings-sheet"
      onClose={onClose}
    >
      <header className="task-view-settings-header">
        <button type="button" onClick={() => onChange(DEFAULT_TASK_VIEW_SETTINGS)}>
          重置
        </button>
        <div>
          <span>筛选、排序与显示</span>
          <h2 id="task-view-settings-title">任务视图设置</h2>
        </div>
        <button type="button" className="primary" onClick={() => sheetRef.current?.close()}>
          完成
        </button>
      </header>

      <div className="task-view-settings-body">
        <OptionGroup
          label="状态筛选"
          options={STATUS}
          value={settings.status}
          onChange={(status) => onChange({ ...settings, status })}
        />
        <OptionGroup
          label="任务属性"
          options={PROPERTY}
          value={settings.property}
          onChange={(property) => onChange({ ...settings, property })}
        />
        <OptionGroup
          label="排序方式"
          options={SORT}
          value={settings.sort}
          onChange={(sort) => onChange({ ...settings, sort })}
        />
        <div className="task-view-setting-group">
          <span className="task-view-setting-label">显示设置</span>
          <button
            type="button"
            role="switch"
            aria-checked={settings.showCompleted}
            className="task-view-toggle"
            onClick={() => onChange({ ...settings, showCompleted: !settings.showCompleted })}
          >
            <span>显示已完成任务</span>
            <i aria-hidden />
          </button>
          <OptionGroup
            label="列表密度"
            options={DENSITY}
            value={settings.density}
            onChange={(density) => onChange({ ...settings, density })}
          />
        </div>
      </div>
    </GestureSheet>
  )
}
