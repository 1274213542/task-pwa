import { useRegisterSW } from 'virtual:pwa-register/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { MOTION } from '../lib/motion'

/**
 * SW 更新策略（v4.2 §4）：提示用户、确认后刷新，不强制。
 * 数据全在 IndexedDB，SW 切换不触及数据；表单草稿由本地兜底（MS1 起）。
 */
export default function UpdateToast() {
  const reduceMotion = useReducedMotion()
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      const check = () => void registration.update()
      const timer = window.setInterval(check, 60 * 60 * 1000)
      window.addEventListener('online', check)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
      window.addEventListener('pagehide', () => window.clearInterval(timer), {
        once: true,
      })
    },
  })

  return (
    <AnimatePresence initial={false}>
    {needRefresh && <motion.div
      key="update-toast"
      role="status"
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.98 }}
      transition={reduceMotion ? MOTION.reduced : MOTION.control}
      className="safe-bottom glass fixed inset-x-4 bottom-20 z-20 mx-auto
        flex max-w-md items-center justify-between gap-3 rounded-2xl
        bg-neutral-900/90 px-4 py-3 text-white shadow-lg backdrop-blur lg:bottom-6"
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
    </motion.div>}
    </AnimatePresence>
  )
}
