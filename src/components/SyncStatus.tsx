import { useObservable } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { cloudEnabled } from '../config'

/**
 * 同步状态条（v4.2 §3）：已同步 / 正在同步 / 离线使用中 / 同步失败。
 * 轻量展示，永不打断操作；纯本地模式（未配置云）不渲染。
 */
export default function SyncStatus() {
  const syncState = useObservable(db.cloud.syncState)
  const user = useObservable(db.cloud.currentUser)

  // 未登录 = 纯本地使用，不显示同步状态（避免"已同步"误导）；登录入口在设置页
  if (!cloudEnabled || !syncState || !user?.isLoggedIn) return null

  const { phase } = syncState
  let label: string
  let tone: 'success' | 'progress' | 'offline' | 'error'
  switch (phase) {
    case 'in-sync':
      label = '已同步'
      tone = 'success'
      break
    case 'pulling':
    case 'pushing':
      label = '正在同步'
      tone = 'progress'
      break
    case 'offline':
      label = '离线使用中'
      tone = 'offline'
      break
    case 'error':
      label = '同步失败，稍后重试'
      tone = 'error'
      break
    default:
      return null // initial / not-in-sync 的短暂中间态不打扰
  }

  return (
    <div
      role="status"
      aria-label={label}
      data-state={tone}
      className="sync-status pointer-events-none flex h-6 items-center gap-1.5 rounded-full
        bg-white/75 px-2.5 text-[11px] font-medium text-neutral-500 shadow-sm
        ring-1 ring-black/5 backdrop-blur-md dark:bg-neutral-800/75
        dark:text-neutral-300 dark:ring-white/10"
    >
      <span className="sync-dot h-1.5 w-1.5 rounded-full" aria-hidden />
      <span>{label}</span>
    </div>
  )
}
