import { motion, useReducedMotion } from 'motion/react'
import type { TaskScope } from '../lib/db'
import { MOTION } from '../lib/motion'
import { shouldSpinTaskSync } from '../lib/taskToolbarMotion'
import AppIcon from './AppIcon'

export default function TaskToolbar({
  scope,
  dailyCount,
  weeklyCount,
  activeSettingCount,
  syncing,
  stuck,
  onScopeChange,
  onOpenSettings,
  onSync,
}: {
  scope: TaskScope
  dailyCount: number
  weeklyCount: number
  activeSettingCount: number
  syncing: boolean
  stuck: boolean
  onScopeChange: (scope: TaskScope) => void
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

        <div className="task-scope-control" role="tablist" aria-label="任务周期">
          <motion.span
            aria-hidden
            className="task-scope-indicator"
            initial={false}
            animate={{ x: scope === 'daily' ? '0%' : '100%' }}
            transition={reduceMotion ? { duration: 0.01 } : MOTION.taskControl}
          />
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'daily'}
            onClick={() => onScopeChange('daily')}
          >
            <span>每日任务</span>
            <strong>{dailyCount}</strong>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'weekly'}
            onClick={() => onScopeChange('weekly')}
          >
            <span>每周任务</span>
            <strong>{weeklyCount}</strong>
          </button>
        </div>

        <button
          type="button"
          className="task-toolbar-action task-toolbar-action-sync"
          aria-label={scope === 'daily' ? '同步今日固定任务' : '同步本周固定任务'}
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
