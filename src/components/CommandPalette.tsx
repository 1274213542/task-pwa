import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'

const PAGES = [
  { label: '今天', to: '/today' },
  { label: '计划', to: '/plan' },
  { label: '购物', to: '/shopping' },
  { label: '浏览', to: '/browse' },
  { label: '设置', to: '/settings' },
]

/** ⌘K 命令面板（MS7 精简版）：页面跳转 + 任务搜索 */
export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)

  const tasks = useLiveQuery(
    () => db.tasks.where('lifecycleStatus').equals('active').toArray(),
    [],
  )

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pages = PAGES.filter((p) => !q || p.label.includes(q)).map((p) => ({
      kind: 'page' as const,
      label: p.label,
      to: p.to,
    }))
    const taskHits = q
      ? (tasks ?? [])
          .filter((t) => t.title.toLowerCase().includes(q))
          .slice(0, 8)
          .map((t) => ({ kind: 'task' as const, label: t.title, to: '/today' }))
      : []
    return [...pages, ...taskHits]
  }, [query, tasks])

  useEffect(() => setCursor(0), [query])
  useEffect(() => inputRef.current?.focus(), [])

  function run(index: number) {
    const r = results[index]
    if (!r) return
    navigate(r.to)
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-label="命令面板"
      onClick={onClose}
      className="fixed inset-0 z-30 flex items-start justify-center bg-black/30 pt-[15vh]
        backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="pop-in w-full max-w-md overflow-hidden rounded-2xl bg-white
          shadow-2xl dark:bg-neutral-800"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setCursor((c) => Math.min(c + 1, results.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setCursor((c) => Math.max(c - 1, 0))
            } else if (e.key === 'Enter') run(cursor)
          }}
          placeholder="搜索页面或任务…"
          className="w-full border-b border-black/5 bg-transparent px-4 py-3 text-[16px]
            outline-none placeholder:text-neutral-400 dark:border-white/10"
        />
        <ul className="max-h-72 overflow-y-auto p-1.5">
          {results.map((r, i) => (
            <li key={`${r.kind}:${r.label}:${i}`}>
              <button
                onClick={() => run(i)}
                onMouseEnter={() => setCursor(i)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2
                  text-left text-[15px] ${
                    i === cursor ? 'bg-[#007aff]/10 text-[#007aff]' : ''
                  }`}
              >
                <span aria-hidden className="text-[12px] text-neutral-400">
                  {r.kind === 'page' ? '→' : '☐'}
                </span>
                <span className="truncate">{r.label}</span>
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="px-3 py-4 text-center text-[14px] text-neutral-400">
              没有匹配结果
            </li>
          )}
        </ul>
        <p
          className="border-t border-black/5 px-4 py-2 text-[11px] text-neutral-400
            dark:border-white/10"
        >
          ↑↓ 选择 · ↵ 前往 · esc 关闭
        </p>
      </div>
    </div>
  )
}
