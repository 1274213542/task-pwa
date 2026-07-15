import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { addTask } from '../lib/tasks'
import TaskRow from '../components/TaskRow'

export default function Today() {
  const [title, setTitle] = useState('')

  // 本地优先：liveQuery 直接驱动视图，无需状态库（v4.2 §10）
  const tasks = useLiveQuery(
    () => db.tasks.where('lifecycleStatus').equals('active').sortBy('rank'),
    [],
  )
  const records = useLiveQuery(() => db.completionRecords.toArray(), [])

  const completedIds = new Set(
    (records ?? [])
      .filter((r) => r.occurrenceKey === 'single' && r.resolution === 'completed')
      .map((r) => r.taskId),
  )

  const dateLabel = new Date().toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })

  async function submit() {
    await addTask(title)
    setTitle('')
  }

  return (
    <section>
      <p className="text-[13px] font-medium text-neutral-500 dark:text-neutral-400">
        {dateLabel}
      </p>
      <h1 className="mt-0.5 text-3xl font-bold tracking-tight">今天</h1>

      <div className="mt-5 flex items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          placeholder="添加任务…"
          enterKeyHint="done"
          className="min-w-0 flex-1 rounded-xl bg-white px-4 py-2.5 text-[16px]
            outline-none placeholder:text-neutral-400 dark:bg-neutral-800"
        />
        <button
          onClick={() => void submit()}
          disabled={!title.trim()}
          aria-label="添加"
          className="h-[42px] w-[42px] shrink-0 rounded-xl bg-[#007aff] text-xl
            text-white transition active:scale-95 disabled:opacity-40"
        >
          +
        </button>
      </div>

      {tasks === undefined ? null : tasks.length === 0 ? (
        <div
          className="mt-8 rounded-2xl border border-dashed border-neutral-300 p-8
            text-center text-neutral-400 dark:border-neutral-700"
        >
          还没有任务，添加一个吧
        </div>
      ) : (
        <ul className="mt-4 rounded-2xl bg-white px-3 dark:bg-neutral-800">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              completed={completedIds.has(task.id)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
