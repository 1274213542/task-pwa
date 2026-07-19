import AppIcon, { type AppIconName } from './AppIcon'
import type { TaskScheduleType } from '../lib/db'

const TASK_INTENTS: Array<{
  id: TaskScheduleType
  title: string
  description: string
  icon: AppIconName
}> = [
  {
    id: 'today',
    title: '今天完成',
    description: '今天必须处理',
    icon: 'today',
  },
  {
    id: 'longTerm',
    title: '一段时间',
    description: '设置开始与 DDL',
    icon: 'calendar',
  },
  {
    id: 'unscheduled',
    title: '暂不排期',
    description: '先记下，稍后安排',
    icon: 'list',
  },
]

export default function TaskIntentSelector({
  value,
  onChange,
  disabled = false,
  compact = false,
}: {
  value: TaskScheduleType
  onChange: (value: TaskScheduleType) => void
  disabled?: boolean
  compact?: boolean
}) {
  return (
    <div
      className="task-intent-picker"
      data-compact={compact || undefined}
      role="radiogroup"
      aria-label="任务时间意图"
      aria-disabled={disabled || undefined}
    >
      {TASK_INTENTS.map((intent) => (
        <button
          key={intent.id}
          type="button"
          role="radio"
          aria-checked={value === intent.id}
          disabled={disabled}
          onClick={() => onChange(intent.id)}
        >
          <AppIcon name={intent.icon} size={18} weight={value === intent.id ? 'fill' : 'regular'} />
          <span>
            <strong>{intent.title}</strong>
            <small>{intent.description}</small>
          </span>
          <i aria-hidden />
        </button>
      ))}
    </div>
  )
}
