import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion, useReducedMotion } from 'motion/react'
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import UpdateToast from './components/UpdateToast'
import SyncStatus from './components/SyncStatus'
import CommandPalette from './components/CommandPalette'
import AppIcon, { type AppIconName } from './components/AppIcon'
import { ensurePersistentStorage } from './lib/persistence'
import { db } from './lib/db'
import MarkerIcon from './components/MarkerIcon'
import DesktopSidebarExtras from './components/DesktopSidebarExtras'
import { MOTION } from './lib/motion'
import { FOCUS_QUICK_ADD_EVENT } from './lib/appEvents'
import { applyVisualPreferences, storeVisualPreferences } from './lib/visualPreferences'
import Overview from './pages/Overview'
import Today from './pages/Today'
import Plan from './pages/Plan'
import Shopping from './pages/Shopping'
import Browse from './pages/Browse'
import Settings from './pages/Settings'

const TABS = [
  { to: '/overview', label: '总览', icon: 'dashboard', tone: 'overview' },
  { to: '/today', label: '任务', icon: 'tasks', tone: 'task' },
  { to: '/plan', label: '计划', icon: 'calendar', tone: 'plan' },
  { to: '/shopping', label: '购物', icon: 'shopping', tone: 'shopping' },
] as const

const LAST_ROUTE_KEY = 'lastRoute'
const ROUTE_RANK: Record<string, number> = {
  '/overview': 0,
  '/today': 1,
  '/plan': 2,
  '/shopping': 3,
  '/browse': 4,
  '/settings': 5,
}

export default function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const mainRef = useRef<HTMLElement>(null)
  const reduceMotion = useReducedMotion()
  const prefs = useLiveQuery(() => db.syncedPreferences.get('#prefs'), [])
  const activeTabIndex = TABS.findIndex((tab) => location.pathname === tab.to)
  const currentRouteRank = ROUTE_RANK[location.pathname] ?? 0
  const previousRouteRank = useRef(currentRouteRank)
  const pageDirection = currentRouteRank >= previousRouteRank.current ? 1 : -1

  useEffect(() => {
    void ensurePersistentStorage()
  }, [])

  useEffect(() => {
    if (!prefs) return
    applyVisualPreferences(prefs)
    storeVisualPreferences(prefs)
  }, [prefs])

  useEffect(() => {
    localStorage.setItem(LAST_ROUTE_KEY, location.pathname)
    mainRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [location.pathname])

  useEffect(() => {
    previousRouteRank.current = currentRouteRank
  }, [currentRouteRank])

  // iOS 键盘出现时暂时收起底部栏，为输入区留下完整的可视高度。
  useEffect(() => {
    const viewport = window.visualViewport
    let baseline = viewport?.height ?? window.innerHeight
    let blurTimer = 0
    const isEditable = () =>
      document.activeElement?.matches('input, textarea, select, [contenteditable="true"]') ??
      false
    const update = () => {
      const height = viewport?.height ?? window.innerHeight
      document.documentElement.style.setProperty('--visual-viewport-height', `${height}px`)
      document.documentElement.style.setProperty(
        '--visual-viewport-offset-top',
        `${viewport?.offsetTop ?? 0}px`,
      )
      if (!isEditable()) {
        baseline = height
        setKeyboardOpen(false)
        return
      }
      setKeyboardOpen(
        window.innerWidth < 1024 && isEditable() && baseline - height > 110,
      )
    }
    const onFocus = () => {
      window.clearTimeout(blurTimer)
      baseline = Math.max(baseline, viewport?.height ?? window.innerHeight)
      window.setTimeout(update, 40)
    }
    const onBlur = () => {
      blurTimer = window.setTimeout(() => setKeyboardOpen(false), 120)
    }
    update()
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', onBlur)
    return () => {
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', onBlur)
      window.clearTimeout(blurTimer)
      document.documentElement.style.removeProperty('--visual-viewport-height')
      document.documentElement.style.removeProperty('--visual-viewport-offset-top')
    }
  }, [])

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

  function focusPrimaryAdd() {
    if (activeTabIndex <= 0) {
      navigate('/today')
      window.setTimeout(
        () => window.dispatchEvent(new CustomEvent(FOCUS_QUICK_ADD_EVENT)),
        60,
      )
      return
    }
    window.dispatchEvent(new CustomEvent(FOCUS_QUICK_ADD_EVENT))
  }

  const todayLabel = new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date())

  return (
    <div className="app-shell flex h-full flex-col lg:flex-row">
      {/* 桌面端侧栏 / 手机端底部 Tab，同一份导航数据 */}
      <nav
        data-tone={TABS[activeTabIndex]?.tone ?? 'neutral'}
        className={`mobile-nav fixed inset-x-0 bottom-0 z-10 lg:static lg:flex lg:w-56
          lg:flex-col lg:border-r ${
            keyboardOpen ? 'is-keyboard-open' : ''
          }`}
      >
        {/* A stable, floating material shell. The visual gap below it is page
            background; safe-area compensation is applied once to its position. */}
        <span className="mobile-nav-material" aria-hidden="true" />
        <div className="desktop-sidebar-brand hidden lg:block">
          <div className="desktop-brand-mark">
            <MarkerIcon symbol="flower" color="green" size={30} />
          </div>
          <p className="desktop-brand-name">Task Schedule</p>
          <p className="desktop-brand-date">{todayLabel}</p>
        </div>
        <ul className="mobile-nav-list relative grid lg:flex lg:flex-col lg:gap-2 lg:px-4">
          <span
            aria-hidden
            className={`nav-active-surface nav-active-index-${activeTabIndex}`}
          />
          {TABS.map((tab, i) => {
            return (
            <li key={tab.to} className={`mobile-nav-item mobile-nav-item-${i} lg:w-full`}>
              <NavLink
                to={tab.to}
                aria-label={tab.label}
                data-tone={tab.tone}
                data-active={location.pathname === tab.to}
                className={({ isActive }) =>
                  `mobile-tab-link relative flex flex-col items-center justify-center
                   gap-0.5 text-[11px] lg:min-h-12 lg:flex-row lg:justify-start
                   lg:gap-3 lg:px-3 lg:text-[15px] ${
                     isActive ? 'is-active' : 'text-neutral-500 dark:text-neutral-400'
                   }`
                }
              >
                <span className="mobile-tab-icon relative z-[1] flex items-center justify-center">
                  <AppIcon name={tab.icon as AppIconName} size={22} />
                </span>
                <span className="mobile-tab-label relative z-[1]">{tab.label}</span>
                <kbd
                  className="relative z-[1] ml-auto hidden text-[11px] text-neutral-300 lg:inline
                    dark:text-neutral-600"
                >
                  ⌘{i + 1}
                </kbd>
              </NavLink>
            </li>
            )
          })}
          <li className="mobile-primary-slot lg:hidden">
            <button
              type="button"
              aria-label="快速新增"
              onClick={focusPrimaryAdd}
              className="mobile-primary-add"
            >
              <AppIcon name="plus" size={28} />
            </button>
          </li>
        </ul>
        <DesktopSidebarExtras />
        {/* 桌面侧栏底部：设置 + 快捷键提示 */}
        <div className="mt-auto hidden px-4 pb-5 lg:block">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-[15px] ${
                isActive ? 'is-active settings-nav-link' : 'text-neutral-500 dark:text-neutral-400'
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

      <main
        ref={mainRef}
        data-keyboard-open={keyboardOpen}
        className={`safe-top flex-1 overflow-y-auto ${
          keyboardOpen ? 'pb-5' : 'pb-24'
        } lg:pb-8`}
      >
        <div className="safe-inline app-content mx-auto max-w-[1480px] pt-2 lg:pt-5">
          {/* 固定高度的非覆盖状态槽：同步状态永不压住导航或输入。 */}
          <div className="app-status-slot flex h-7 items-center justify-end" aria-live="polite">
            <SyncStatus />
          </div>
          <div className="motion-route-viewport">
            <motion.div
              key={location.pathname}
              initial={reduceMotion ? false : { x: pageDirection * 8 }}
              animate={{ x: 0 }}
              transition={reduceMotion ? MOTION.reduced : MOTION.route}
              className="motion-route-page"
            >
              <Routes location={location}>
                <Route path="/" element={<Navigate to="/overview" replace />} />
                <Route path="/overview" element={<Overview />} />
                <Route path="/today" element={<Today />} />
                <Route path="/plan" element={<Plan />} />
                <Route path="/shopping" element={<Shopping />} />
                <Route path="/browse" element={<Browse />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/overview" replace />} />
              </Routes>
            </motion.div>
          </div>
        </div>
      </main>

      <UpdateToast />
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  )
}
