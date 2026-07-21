import { useReducedMotion } from 'motion/react'
import type { TaskView } from '../lib/taskViews'
import { MOTION } from '../lib/motion'
import { shouldSpinTaskSync } from '../lib/taskToolbarMotion'
import AppIcon from './AppIcon'
import SegmentedIndicator from './SegmentedIndicator'

export default function TaskToolbar({
  scope,
  todayCount,
  longTermCount,
  activeSettingCount,
  syncing,
  stuck,
  onScopeChange,
  onOpenSettings,
  onSync,
}: {
  scope: TaskView
  todayCount: number
  longTermCount: number
  activeSettingCount: number
  syncing: boolean
  stuck: boolean
  onScopeChange: (scope: TaskView) => void
  onOpenSettings: () => void
  onSync: () => void
}) {
  const reduceMotion = useReducedMotion()
  return (
    <div className="task-toolbar-sticky" data-stuck={stuck || undefined}>
      <div className="task-toolbar" aria-label="任务工具栏">
        <button
          type="button"
          className="task-toolbar-action task-toolbar-action-filter"
          aria-label={activeSettingCount > 0
            ? `任务视图设置，已启用 ${activeSettingCount} 项`
            : '任务视图设置'}
          onClick={onOpenSettings}
        >
          <span className="task-toolbar-icon-frame">
            <AppIcon name="filter" size={21} />
          </span>
          {activeSettingCount > 0 && (
            <span className="task-toolbar-filter-count" aria-hidden>
              {activeSettingCount}
            </span>
          )}
        </button>

        <div className="task-scope-control" data-shared-indicator role="tablist" aria-label="任务视图">
          <SegmentedIndicator
            className="task-scope-indicator"
            count={2}
            index={scope === 'today' ? 0 : 1}
            transition={MOTION.taskControl}
          />
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'today'}
            onClick={() => onScopeChange('today')}
          >
            <span>今日任务</span>
            <strong>{todayCount}</strong>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'longTerm'}
            onClick={() => onScopeChange('longTerm')}
          >
            <span>长期任务</span>
            <strong>{longTermCount}</strong>
          </button>
        </div>

        <button
          type="button"
          className="task-toolbar-action task-toolbar-action-sync"
          aria-label="同步今日周期任务"
          aria-busy={syncing}
          disabled={syncing}
          onClick={onSync}
        >
          <span
            className="task-toolbar-icon-frame"
            data-spinning={shouldSpinTaskSync(syncing, reduceMotion) || undefined}
          >
            <AppIcon name="sync" size={21} />
          </span>
        </button>
      </div>
    </div>
  )
}
