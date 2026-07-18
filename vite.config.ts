import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages 子路径部署：仓库改名时只需改 PAGES_BASE（Actions 中自动取仓库名）
const base = process.env.PAGES_BASE ?? '/task-pwa/'
const version =
  (process.env.GITHUB_SHA?.slice(0, 7) ?? 'dev') +
  ' · ' +
  new Date().toISOString().slice(0, 10)

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Shell 资源可安全自动接管；任务、购物和日历数据在 IndexedDB，
      // 不由 Service Worker 清理。这样安装版 PWA 不会长期停留在旧 hash。
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: '任务计划',
        short_name: '计划',
        description: '离线优先的个人任务、备忘与计划表',
        lang: 'zh-CN',
        start_url: './',
        scope: './',
        display: 'standalone',
        theme_color: '#f7f6f2',
        background_color: '#f7f6f2',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // 预缓存完整 App Shell；数据接口（Dexie Cloud，MS2 接入）不经 SW 缓存
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
