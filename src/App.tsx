import { useEffect } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import Today from './pages/Today'
import Plan from './pages/Plan'
import Shopping from './pages/Shopping'
import Browse from './pages/Browse'
import Settings from './pages/Settings'
import UpdateToast from './components/UpdateToast'
import { ensurePersistentStorage } from './lib/persistence'

const TABS = [
  { to: '/today', label: '今天', icon: '☀︎' },
  { to: '/plan', label: '计划', icon: '▤' },
  { to: '/shopping', label: '购物', icon: '⊞' },
  { to: '/browse', label: '浏览', icon: '◱' },
] as const

const LAST_ROUTE_KEY = 'lastRoute'

export default function App() {
  const location = useLocation()

  // 首次启动即请求持久存储（不阻塞渲染，结果在设置页可见）
  useEffect(() => {
    void ensurePersistentStorage()
  }, [])

  useEffect(() => {
    localStorage.setItem(LAST_ROUTE_KEY, location.pathname)
  }, [location.pathname])

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* 桌面端侧栏 / 手机端底部 Tab，同一份导航数据 */}
      <nav
        className="safe-bottom fixed inset-x-0 bottom-0 z-10 border-t border-black/10
          bg-white/80 backdrop-blur-xl md:static md:w-52 md:border-t-0 md:border-r
          md:bg-transparent md:backdrop-blur-none dark:border-white/10 dark:bg-black/40"
      >
        <ul className="flex justify-around md:mt-16 md:flex-col md:gap-1 md:px-3">
          {TABS.map((tab) => (
            <li key={tab.to} className="md:w-full">
              <NavLink
                to={tab.to}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-0.5 px-3 py-2 text-[11px] md:flex-row
                   md:gap-2.5 md:rounded-lg md:px-3 md:py-1.5 md:text-[15px] ${
                     isActive
                       ? 'text-[#007aff] md:bg-[#007aff]/10'
                       : 'text-neutral-500 dark:text-neutral-400'
                   }`
                }
              >
                <span aria-hidden className="text-lg md:text-base">
                  {tab.icon}
                </span>
                {tab.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <main className="safe-top flex-1 overflow-y-auto pb-24 md:pb-8">
        <div className="mx-auto max-w-2xl px-5 pt-4">
          <Routes>
            <Route path="/" element={<Navigate to={initialRoute()} replace />} />
            <Route path="/today" element={<Today />} />
            <Route path="/plan" element={<Plan />} />
            <Route path="/shopping" element={<Shopping />} />
            <Route path="/browse" element={<Browse />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/today" replace />} />
          </Routes>
        </div>
      </main>

      <UpdateToast />
    </div>
  )
}

function initialRoute(): string {
  const last = localStorage.getItem(LAST_ROUTE_KEY)
  return last && last !== '/' ? last : '/today'
}
