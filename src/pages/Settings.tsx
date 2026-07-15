import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useObservable } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { cloudEnabled } from '../config'
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
  const [request, setRequest] = useState<'idle' | 'pending' | 'denied'>('idle')

  const persistedSync = useObservable(db.cloud.persistedSyncState)
  const lastSync = !cloudEnabled
    ? '未配置'
    : persistedSync?.timestamp
      ? new Date(persistedSync.timestamp).toLocaleString('zh-CN', {
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '尚未同步'

  useEffect(() => {
    void isStoragePersisted().then(setPersisted)
  }, [])

  async function requestPersist() {
    setRequest('pending')
    const granted = await ensurePersistentStorage()
    setPersisted(granted)
    setRequest(granted ? 'idle' : 'denied')
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
        <Row label="最后云端同步时间" value={lastSync} />
        <Row label="最后备份时间" value="—（MS8 接入）" />
        <Row label="版本" value={__APP_VERSION__} />
      </div>

      {persisted === false && (
        <button
          onClick={requestPersist}
          disabled={request === 'pending'}
          className="mt-4 w-full rounded-xl bg-[#007aff] py-2.5 text-[15px] font-medium
            text-white transition active:scale-[0.98] active:opacity-80
            disabled:opacity-50"
        >
          {request === 'pending' ? '请求中…' : '请求持久存储'}
        </button>
      )}

      {request === 'denied' && (
        <p
          className="mt-3 rounded-xl bg-amber-500/10 px-4 py-3 text-[13px] leading-relaxed
            text-amber-600 dark:text-amber-400"
        >
          Safari 本次未授予。iOS 不弹授权窗口，而是按你对这个 App
          的使用频率自动决定——日常使用几天后通常会自动升级为持久存储，期间云同步与备份照常兜底，无需处理。
        </p>
      )}

      <p className="mt-4 px-1 text-[13px] leading-relaxed text-neutral-400">
        未启用持久存储时 App 照常使用；系统存储紧张时本地数据有被清除的可能，请保持云端同步并定期备份。
      </p>
    </section>
  )
}
