import { useEffect, useRef, useState } from 'react'

export interface RowActions {
  onToggle: () => void
  onSkip?: () => void
  onDelete: () => void // 删除（周期任务=整个系列）
  onDeleteOnce?: () => void // 仅删除本次（周期任务，语义=跳过本期，决策表 #10）
  onRename?: (title: string) => void
}

/**
 * 通用任务行（投影渲染）。
 * 删除永不一次点击直达（v4.2 §10）：第一次点 ✕ 进入确认态，
 * 周期任务确认态给出「仅本次 / 删除系列」，3 秒无操作自动还原。
 */
export default function TaskRow({
  title,
  subtitle,
  dot,
  completed,
  overdue,
  actions,
  liRef,
  liStyle,
  dragProps,
  selected,
  onMetaClick,
}: {
  title: string
  subtitle?: string
  dot?: string
  completed: boolean
  overdue?: boolean
  actions: RowActions
  liRef?: (el: HTMLLIElement | null) => void // dnd-kit sortable
  liStyle?: React.CSSProperties
  dragProps?: Record<string, unknown>
  selected?: boolean // 桌面 ⌘click 多选态
  onMetaClick?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const [confirming, setConfirming] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  function armDelete() {
    setConfirming(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setConfirming(false), 3000)
  }

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
      ref={liRef}
      style={liStyle}
      {...dragProps}
      onClick={(e) => {
        if ((e.metaKey || e.ctrlKey) && onMetaClick) {
          e.preventDefault()
          onMetaClick()
        }
      }}
      className={`group row-in flex items-center gap-3 border-b border-black/5 px-1
        py-3 last:border-b-0 dark:border-white/10 ${
          selected ? 'rounded-lg bg-[#007aff]/10 ring-1 ring-[#007aff]/40' : ''
        }`}
    >
      <button
        aria-label={completed ? '取消完成' : '完成'}
        onClick={actions.onToggle}
        className="hit-target -ml-2.5 shrink-0 transition active:scale-95"
      >
        <span
          className={`flex h-[24px] w-[24px] items-center justify-center rounded-full
            border-[1.5px] ${
              completed
                ? 'border-[#007aff] bg-[#007aff] text-white'
                : 'border-neutral-300 dark:border-neutral-600'
            }`}
        >
          {completed && (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path
                className="check-path"
                d="M2 6.5L4.5 9L10 3.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
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
            className="min-h-11 w-full truncate py-2 text-left text-[16px]"
          >
            <span
              className={`strike ${completed ? 'text-neutral-400' : ''}`}
              data-done={completed}
            >
              {title}
            </span>
          </button>
        )}
        {subtitle && (
          <p
            className={`flex items-center gap-1 truncate text-[12px] ${
              overdue && !completed ? 'text-red-500' : 'text-neutral-400'
            }`}
          >
            {dot && (
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: dot }}
              />
            )}
            {subtitle}
          </p>
        )}
      </div>

      {confirming ? (
        <span className="flex shrink-0 items-center gap-1.5">
          {actions.onDeleteOnce && (
            <button
              onClick={() => {
                setConfirming(false)
                actions.onDeleteOnce!()
              }}
              className="min-h-11 rounded-xl bg-neutral-500/10 px-2 text-[12px]
                text-neutral-500"
            >
              仅本次
            </button>
          )}
          <button
            onClick={() => {
              setConfirming(false)
              actions.onDelete()
            }}
            className="min-h-11 rounded-xl bg-red-500 px-2 text-[12px] font-medium
              text-white"
          >
            {actions.onDeleteOnce ? '删除系列' : '确认删除'}
          </button>
        </span>
      ) : (
        <>
          {actions.onSkip && !completed && (
            <button
              onClick={actions.onSkip}
              className="min-h-11 shrink-0 rounded-xl px-2 text-[12px] text-neutral-400
                opacity-60 transition group-hover:opacity-100"
            >
              跳过
            </button>
          )}
          <button
            aria-label="删除"
            onClick={armDelete}
            className="hit-target -mr-2 shrink-0 rounded-full text-neutral-300 opacity-60
              transition group-hover:opacity-100 dark:text-neutral-600"
          >
            ✕
          </button>
        </>
      )}
    </li>
  )
}
