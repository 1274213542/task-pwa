import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { db } from './lib/db'
import {
  applyVisualPreferences,
  readStoredVisualPreferences,
  storeVisualPreferences,
} from './lib/visualPreferences'
import './index.css'
import './app-design.css'

applyVisualPreferences(readStoredVisualPreferences())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)

// 首屏不等待 IndexedDB；数据库就绪后只校正并镜像视觉偏好。
void db.open().then(async () => {
  const prefs = await db.syncedPreferences.get('#prefs')
  if (!prefs) return
  applyVisualPreferences(prefs)
  storeVisualPreferences(prefs)
}).catch(() => {
  // IndexedDB 错误不阻塞本地界面，沿用最近一次视觉偏好。
})
