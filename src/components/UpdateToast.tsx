import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * SW 更新策略（v4.2 §4）：提示用户、确认后刷新，不强制。
 * 数据全在 IndexedDB，SW 切换不触及数据；表单草稿由本地兜底（MS1 起）。
 */
export default function UpdateToast() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>()
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_swUrl, nextRegistration) {
      setRegistration(nextRegistration)
    },
  })

  useEffect(() => {
    if (!registration) return
    const check = () => void registration.update().catch(() => undefined)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') check()
    }
    const timer = window.setInterval(check, 60 * 60 * 1000)
    window.addEventListener('online', check)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', check)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [registration])

  if (!needRefresh) return null

  return (
    <div
      role="status"
      className="safe-bottom fixed inset-x-4 bottom-20 z-20 mx-auto
        flex max-w-md items-center justify-between gap-3 rounded-2xl
        bg-neutral-900 px-4 py-3 text-white shadow-lg lg:bottom-6"
    >
      <span className="text-[14px]">有新版本可用</span>
      <div className="flex gap-2">
        <button
          onClick={() => setNeedRefresh(false)}
          className="rounded-lg px-3 py-1.5 text-[14px] text-neutral-300"
        >
          稍后
        </button>
        <button
          onClick={() => void updateServiceWorker(true)}
          className="rounded-lg bg-white px-3 py-1.5 text-[14px] font-medium
            text-neutral-900"
        >
          立即更新
        </button>
      </div>
    </div>
  )
}
