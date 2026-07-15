import { useState } from 'react'

export interface RowActions {
  onToggle: () => void
  onSkip?: () => void
  onDelete: () => void
  onRename?: (title: string) => void
}

/** 通用任务行：普通任务与周期实例共用（投影渲染，v4.2 §8 投影类型） */
export default function TaskRow({
  title,
  subtitle,
  completed,
  overdue,
  actions,
}: {
  title: string
  subtitle?: string
  completed: boolean
  overdue?: boolean
  actions: RowActions
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)

  function commitRename() {
    setEditing(false)
    if (actions.onRename && draft.trim() && draft.trim() !== title) {
      actions.onRename(draft)
    } else {
      setDraft(title)
    }
  }

  return (
    <li
      className="group flex items-center gap-3 border-b border-black/5 px-1 py-3
        last:border-b-0 dark:border-white/10"
    >
      <button
        aria-label={completed ? '取消完成' : '完成'}
        onClick={actions.onToggle}
        className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center
          rounded-full border-[1.5px] transition active:scale-90 ${
            completed
              ? 'border-[#007aff] bg-[#007aff] text-white'
              : 'border-neutral-300 dark:border-neutral-600'
          }`}
      >
        {completed && (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path
              d="M2 6.5L4.5 9L10 3.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => e.key === 'Enter' && commitRename()}
            className="w-full bg-transparent text-[16px] outline-none"
          />
        ) : (
          <button
            onClick={() => actions.onRename && setEditing(true)}
            className={`block w-full truncate text-left text-[16px] transition ${
              completed
                ? 'text-neutral-400 line-through decoration-neutral-400'
                : ''
            }`}
          >
            {title}
          </button>
        )}
        {subtitle && (
          <p
            className={`truncate text-[12px] ${
              overdue && !completed ? 'text-red-500' : 'text-neutral-400'
            }`}
          >
            {subtitle}
          </p>
        )}
      </div>

      {actions.onSkip && !completed && (
        <button
          onClick={actions.onSkip}
          className="shrink-0 rounded-lg px-2 py-1 text-[12px] text-neutral-400
            opacity-60 transition group-hover:opacity-100"
        >
          跳过
        </button>
      )}

      <button
        aria-label="删除"
        onClick={actions.onDelete}
        className="shrink-0 rounded-full px-2 py-1 text-neutral-300 opacity-60
          transition group-hover:opacity-100 dark:text-neutral-600"
      >
        ✕
      </button>
    </li>
  )
}
