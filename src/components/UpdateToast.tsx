import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

const BUILD_ID = __APP_VERSION__.split(' · ')[0]
const RELOAD_KEY = `task-pwa:controller-reload:${BUILD_ID}`

function reloadIntoCurrentBuild() {
  try {
    if (window.sessionStorage.getItem(RELOAD_KEY)) return
    window.sessionStorage.setItem(RELOAD_KEY, '1')
  } catch {
    // Some standalone/private Safari sessions can deny sessionStorage. The
    // versioned URL below still prevents a stale GitHub Pages navigation hit.
  }

  const url = new URL(window.location.href)
  url.searchParams.set('app-version', BUILD_ID)
  window.location.replace(url.toString())
}

/**
 * SW 更新策略：构建产物自动接管；保留此提示作为不支持自动接管浏览器
 * 的安全回退。数据全在 IndexedDB，SW 切换不触及用户数据。
 */
export default function UpdateToast() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>()
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onNeedReload: reloadIntoCurrentBuild,
    onRegisteredSW(_swUrl, nextRegistration) {
      setRegistration(nextRegistration)
      void nextRegistration?.update().catch(() => undefined)
    },
  })

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    let hadController = Boolean(navigator.serviceWorker.controller)
    const onControllerChange = () => {
      if (hadController) reloadIntoCurrentBuild()
      hadController = true
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
  }, [])

  useEffect(() => {
    if (!registration) return
    const check = () => void registration.update().catch(() => undefined)
    check()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') check()
    }
    const timer = window.setInterval(check, 5 * 60 * 1000)
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
