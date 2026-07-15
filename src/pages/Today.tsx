export default function Today() {
  const today = new Date()
  const dateLabel = today.toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })

  return (
    <section>
      <p className="text-[13px] font-medium text-neutral-500 dark:text-neutral-400">
        {dateLabel}
      </p>
      <h1 className="mt-0.5 text-3xl font-bold tracking-tight">今天</h1>
      <div
        className="mt-8 rounded-2xl border border-dashed border-neutral-300 p-8 text-center
          text-neutral-400 dark:border-neutral-700"
      >
        MS1 起在这里显示今日任务
      </div>
    </section>
  )
}
