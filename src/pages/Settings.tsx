import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ensurePersistentStorage, isStoragePersisted } from '../lib/persistence'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-center justify-between border-b border-black/5 px-4 py-3
        last:border-b-0 dark:border-white/10"
    >
      <span className="text-[15px]">{label}</span>
      <span className="text-[15px] text-neutral-500 dark:text-neutral-400">{value}</span>
    </div>
  )
}

export default function Settings() {
  const [persisted, setPersisted] = useState<boolean | null>(null)

  useEffect(() => {
    void isStoragePersisted().then(setPersisted)
  }, [])

  async function requestPersist() {
    setPersisted(await ensurePersistentStorage())
  }

  return (
    <section>
      <div className="flex items-center gap-3">
        <Link to="/browse" aria-label="返回" className="text-xl text-[#007aff]">
          ‹
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">设置</h1>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl bg-white dark:bg-neutral-800">
        <Row
          label="本地存储保护"
          value={persisted === null ? '…' : persisted ? '已启用' : '未启用'}
        />
        <Row label="最后云端同步时间" value="—（MS2 接入）" />
        <Row label="最后备份时间" value="—（MS8 接入）" />
        <Row label="版本" value={__APP_VERSION__} />
      </div>

      {persisted === false && (
        <button
          onClick={requestPersist}
          className="mt-4 w-full rounded-xl bg-[#007aff] py-2.5 text-[15px] font-medium
            text-white"
        >
          请求持久存储
        </button>
      )}

      <p className="mt-4 px-1 text-[13px] leading-relaxed text-neutral-400">
        未启用持久存储时 App 照常使用；系统存储紧张时本地数据有被清除的可能，请保持云端同步并定期备份。
      </p>
    </section>
  )
}
