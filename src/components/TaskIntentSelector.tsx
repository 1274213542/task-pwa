import AppIcon, { type AppIconName } from './AppIcon'
import type { TaskScheduleType } from '../lib/db'
import SegmentedIndicator from './SegmentedIndicator'

const TASK_INTENTS: Array<{
  id: TaskScheduleType
  title: string
  description: string
  icon: AppIconName
}> = [
  {
    id: 'today',
    title: '今日任务',
    description: '安排到今天',
    icon: 'today',
  },
  {
    id: 'longTerm',
    title: '长期任务',
    description: '持续或面向未来',
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
  const activeIndex = Math.max(0, TASK_INTENTS.findIndex((intent) => intent.id === value))
  return (
    <div
      className="task-intent-picker"
      data-compact={compact || undefined}
      data-shared-indicator="true"
      role="radiogroup"
      aria-label="任务时间意图"
      aria-disabled={disabled || undefined}
    >
      <SegmentedIndicator
        index={activeIndex}
        count={TASK_INTENTS.length}
        className="task-intent-indicator"
      />
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
        </button>
      ))}
    </div>
  )
}
