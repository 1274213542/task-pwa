import { Link } from 'react-router-dom'

export default function Browse() {
  return (
    <section>
      <div className="flex items-start justify-between">
        <h1 className="text-3xl font-bold tracking-tight">浏览</h1>
        <Link
          to="/settings"
          aria-label="设置"
          className="rounded-full p-2 text-xl text-neutral-500 dark:text-neutral-400"
        >
          ⚙︎
        </Link>
      </div>
      <div
        className="mt-8 rounded-2xl border border-dashed border-neutral-300 p-8 text-center
          text-neutral-400 dark:border-neutral-700"
      >
        MS4：分类、已完成记录与搜索
      </div>
    </section>
  )
}
