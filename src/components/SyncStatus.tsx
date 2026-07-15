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
  let dot: string
  switch (phase) {
    case 'in-sync':
      label = '已同步'
      dot = 'bg-emerald-500'
      break
    case 'pulling':
    case 'pushing':
      label = '正在同步'
      dot = 'bg-[#007aff] animate-pulse'
      break
    case 'offline':
      label = '离线使用中'
      dot = 'bg-neutral-400'
      break
    case 'error':
      label = '同步失败，稍后重试'
      dot = 'bg-amber-500'
      break
    default:
      return null // initial / not-in-sync 的短暂中间态不打扰
  }

  return (
    <div
      className="pointer-events-none fixed top-2 right-3 z-20 flex items-center gap-1.5
        rounded-full bg-white/80 px-2.5 py-1 text-[11px] text-neutral-500
        backdrop-blur dark:bg-black/50 dark:text-neutral-400"
      style={{ top: 'calc(env(safe-area-inset-top) + 8px)' }}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {label}
    </div>
  )
}
