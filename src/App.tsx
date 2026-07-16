import { useEffect, useState } from 'react'
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import Today from './pages/Today'
import Plan from './pages/Plan'
import Shopping from './pages/Shopping'
import Browse from './pages/Browse'
import Settings from './pages/Settings'
import UpdateToast from './components/UpdateToast'
import SyncStatus from './components/SyncStatus'
import CommandPalette from './components/CommandPalette'
import AppIcon, { type AppIconName } from './components/AppIcon'
import { ensurePersistentStorage } from './lib/persistence'

const TABS = [
  { to: '/today', label: '任务', icon: 'today' },
  { to: '/plan', label: '计划', icon: 'calendar' },
  { to: '/shopping', label: '购物', icon: 'shopping' },
  { to: '/browse', label: '浏览', icon: 'browse' },
] as const

const LAST_ROUTE_KEY = 'lastRoute'

/** 通知当前页聚焦快速添加输入框（⌘N） */
export const FOCUS_QUICK_ADD_EVENT = 'focus-quick-add'

export default function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    void ensurePersistentStorage()
  }, [])

  useEffect(() => {
    localStorage.setItem(LAST_ROUTE_KEY, location.pathname)
  }, [location.pathname])

  // 桌面快捷键（v4.2 §10）：⌘K 面板、⌘1..4 切视图、⌘N 快速新增
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      } else if (e.key >= '1' && e.key <= '4') {
        e.preventDefault()
        navigate(TABS[Number(e.key) - 1].to)
      } else if (e.key === 'n') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent(FOCUS_QUICK_ADD_EVENT))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  return (
    <div className="flex h-full flex-col lg:flex-row">
      {/* 桌面端侧栏 / 手机端底部 Tab，同一份导航数据 */}
      <nav
        className="safe-bottom glass fixed inset-x-0 bottom-0 z-10 border-t
          border-black/10 bg-white/80 backdrop-blur-xl lg:static lg:flex lg:w-52
          lg:flex-col lg:border-t-0 lg:border-r lg:bg-transparent
          lg:backdrop-blur-none dark:border-white/10 dark:bg-black/40"
      >
        <ul className="flex justify-around lg:mt-16 lg:flex-col lg:gap-1 lg:px-3">
          {TABS.map((tab, i) => (
            <li key={tab.to} className="lg:w-full">
              <NavLink
                to={tab.to}
                className={({ isActive }) =>
                  `flex min-h-14 flex-col items-center justify-center gap-0.5 px-3 py-1.5
                   text-[11px] transition-colors lg:min-h-11 lg:flex-row lg:justify-start
                   lg:gap-2.5 lg:rounded-xl lg:px-3 lg:text-[15px] ${
                     isActive
                       ? 'text-[#007aff] lg:bg-[#007aff]/10'
                       : 'text-neutral-500 dark:text-neutral-400'
                   }`
                }
              >
                <AppIcon name={tab.icon as AppIconName} size={22} />
                {tab.label}
                <kbd
                  className="ml-auto hidden text-[11px] text-neutral-300 lg:inline
                    dark:text-neutral-600"
                >
                  ⌘{i + 1}
                </kbd>
              </NavLink>
            </li>
          ))}
        </ul>
        {/* 桌面侧栏底部：设置 + 快捷键提示 */}
        <div className="mt-auto hidden px-3 pb-4 lg:block">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-[15px] ${
                isActive
                  ? 'bg-[#007aff]/10 text-[#007aff]'
                  : 'text-neutral-500 dark:text-neutral-400'
              }`
            }
          >
            <AppIcon name="settings" size={19} /> 设置
          </NavLink>
          <button
            onClick={() => setPaletteOpen(true)}
            className="mt-1 flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3
              text-[13px] text-neutral-400"
          >
            <AppIcon name="search" size={17} />
            搜索 <kbd className="ml-auto text-[11px]">⌘K</kbd>
          </button>
        </div>
      </nav>

      <main className="safe-top flex-1 overflow-y-auto pb-24 lg:pb-8">
        <div className="safe-inline mx-auto max-w-2xl pt-2 lg:pt-4">
          {/* 固定高度的非覆盖状态槽：同步状态永不压住导航或输入。 */}
          <div className="flex h-7 items-center justify-end" aria-live="polite">
            <SyncStatus />
          </div>
          {/* key 换页触发轻淡入过渡（reduced-motion 下自动退化） */}
          <div key={location.pathname} className="page-in">
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
        </div>
      </main>

      <UpdateToast />
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  )
}

function initialRoute(): string {
  const last = localStorage.getItem(LAST_ROUTE_KEY)
  return last && last !== '/' ? last : '/today'
}
