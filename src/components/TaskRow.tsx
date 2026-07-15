import { useState } from 'react'
import type { Task } from '../lib/db'
import {
  completeTask,
  renameTask,
  softDeleteTask,
  uncompleteTask,
} from '../lib/tasks'

export default function TaskRow({
  task,
  completed,
}: {
  task: Task
  completed: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.title)

  async function commitRename() {
    setEditing(false)
    if (draft.trim() && draft.trim() !== task.title) {
      await renameTask(task.id, draft)
    } else {
      setDraft(task.title)
    }
  }

  return (
    <li
      className="group flex items-center gap-3 border-b border-black/5 px-1 py-3
        last:border-b-0 dark:border-white/10"
    >
      <button
        aria-label={completed ? '取消完成' : '完成'}
        onClick={() =>
          completed ? void uncompleteTask(task.id) : void completeTask(task)
        }
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

      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commitRename()}
          onKeyDown={(e) => e.key === 'Enter' && void commitRename()}
          className="min-w-0 flex-1 bg-transparent text-[16px] outline-none"
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className={`min-w-0 flex-1 truncate text-left text-[16px] transition ${
            completed
              ? 'text-neutral-400 line-through decoration-neutral-400'
              : ''
          }`}
        >
          {task.title}
        </button>
      )}

      <button
        aria-label="删除"
        onClick={() => void softDeleteTask(task.id)}
        className="shrink-0 rounded-full px-2 py-1 text-neutral-300 opacity-60
          transition group-hover:opacity-100 dark:text-neutral-600"
      >
        ✕
      </button>
    </li>
  )
}
