import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery, useObservable } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { cloudEnabled } from '../config'
import { ensurePersistentStorage, isStoragePersisted } from '../lib/persistence'
import { exportBackup, importBackup } from '../lib/backup'
import PageHeader from '../components/PageHeader'
import AppIcon from '../components/AppIcon'
import { UI_THEMES } from '../lib/themes'
import type { UIThemeId } from '../lib/db'
import { COLOR_TOKEN_ORDER } from '../lib/themes'

function downloadJson(json: string, filename: string) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-center justify-between border-b border-black/5 px-4 py-3
        last:border-b-0 dark:border-white/10"
    >
      <span className="text-[15px]">{label}</span>
      <span className="text-[15px] text-neutral-500 dark:text-neutral-400">{value}</span>
    </div>
  )
}

export default function Settings() {
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [request, setRequest] = useState<'idle' | 'pending' | 'denied'>('idle')
  const [lastBackupAt, setLastBackupAt] = useState(
    () => localStorage.getItem('lastBackupAt') ?? '',
  )
  const [importState, setImportState] = useState<
    { phase: 'idle' } | { phase: 'confirm'; json: string; name: string } | { phase: 'done' } | { phase: 'error'; msg: string }
  >({ phase: 'idle' })
  const fileRef = useRef<HTMLInputElement>(null)

  async function doExport() {
    const json = await exportBackup(db, __APP_VERSION__)
    downloadJson(json, `task-pwa-backup-${stamp()}.json`)
    const t = new Date().toISOString()
    localStorage.setItem('lastBackupAt', t)
    setLastBackupAt(t)
  }

  async function onFilePicked(f: File | undefined) {
    if (!f) return
    const json = await f.text()
    setImportState({ phase: 'confirm', json, name: f.name })
  }

  async function doImport() {
    if (importState.phase !== 'confirm') return
    try {
      // 导入前自动回滚备份（v4.2 §9）：先把当前库快照下载到本地
      downloadJson(
        await exportBackup(db, __APP_VERSION__),
        `task-pwa-rollback-${stamp()}.json`,
      )
      await importBackup(db, importState.json)
      setImportState({ phase: 'done' })
    } catch (e) {
      setImportState({ phase: 'error', msg: e instanceof Error ? e.message : String(e) })
    }
  }

  const user = useObservable(db.cloud.currentUser)
  const persistedSync = useObservable(db.cloud.persistedSyncState)
  const prefs = useLiveQuery(() => db.syncedPreferences.get('#prefs'), [])
  const lastSync = !cloudEnabled
    ? '未配置'
    : persistedSync?.timestamp
      ? new Date(persistedSync.timestamp).toLocaleString('zh-CN', {
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '尚未同步'

  useEffect(() => {
    void isStoragePersisted().then(setPersisted)
  }, [])

  async function requestPersist() {
    setRequest('pending')
    const granted = await ensurePersistentStorage()
    setPersisted(granted)
    setRequest(granted ? 'idle' : 'denied')
  }

  return (
    <section className="app-page page-settings">
      <PageHeader
        title="设置"
        eyebrow="数据与偏好"
        leading={<Link to="/browse" aria-label="返回" className="settings-back hit-target -ml-3 text-2xl">
          <AppIcon name="chevronLeft" size={22} />
        </Link>}
      />

      <section className="settings-theme-section" aria-labelledby="theme-heading">
        <div className="settings-section-heading">
          <div>
            <p className="section-kicker">外观</p>
            <h2 id="theme-heading">主题风格</h2>
          </div>
          <AppIcon name="palette" size={22} />
        </div>
        <div className="theme-choice-grid">
          {UI_THEMES.map((theme) => (
            <button
              key={theme.id}
              type="button"
              aria-pressed={(prefs?.uiTheme ?? 'violet-lime') === theme.id}
              className="theme-choice"
              onClick={() =>
                void db.syncedPreferences.update('#prefs', {
                  uiTheme: theme.id as UIThemeId,
                  updatedAt: new Date().toISOString(),
                })
              }
            >
              <span className="theme-swatches" aria-hidden>
                {theme.swatches.map((color) => (
                  <span key={color} style={{ background: color }} />
                ))}
              </span>
              <span className="theme-choice-copy">
                <strong>{theme.name}</strong>
                <small>{theme.description}</small>
              </span>
              {(prefs?.uiTheme ?? 'violet-lime') === theme.id && (
                <span className="theme-selected-icon">
                  <AppIcon name="check" size={16} />
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="appearance-control" role="group" aria-label="明暗模式">
          {(['system', 'light', 'dark'] as const).map((appearance) => (
            <button
              key={appearance}
              type="button"
              aria-pressed={(prefs?.theme ?? 'system') === appearance}
              onClick={() =>
                void db.syncedPreferences.update('#prefs', {
                  theme: appearance,
                  updatedAt: new Date().toISOString(),
                })
              }
            >
              {appearance === 'system' ? '跟随系统' : appearance === 'light' ? '浅色' : '深色'}
            </button>
          ))}
        </div>
        <div className="action-color-control">
          <div>
            <strong>主操作按钮</strong>
            <span>使用主题深色，或从协调色板选择</span>
          </div>
          <div className="action-color-options" role="group" aria-label="主操作按钮颜色">
            <button
              type="button"
              className="action-color-default"
              aria-label="使用主题默认按钮颜色"
              aria-pressed={!prefs?.actionColor}
              onClick={() =>
                void db.syncedPreferences.update('#prefs', {
                  actionColor: undefined,
                  updatedAt: new Date().toISOString(),
                })
              }
            />
            {COLOR_TOKEN_ORDER.map((token) => (
              <button
                key={token}
                type="button"
                data-color-token={token}
                aria-label={`使用 ${token} 按钮颜色`}
                aria-pressed={prefs?.actionColor === token}
                onClick={() =>
                  void db.syncedPreferences.update('#prefs', {
                    actionColor: token,
                    updatedAt: new Date().toISOString(),
                  })
                }
              />
            ))}
          </div>
        </div>
      </section>

      <div className="list-card settings-data-card mt-6 overflow-hidden rounded-xl bg-white dark:bg-neutral-800">
        {cloudEnabled && (
          <div
            className="flex items-center justify-between border-b border-black/5 px-4
              py-3 dark:border-white/10"
          >
            <span className="text-[15px]">同步账号</span>
            {user?.isLoggedIn ? (
              <span className="text-[15px] text-neutral-500 dark:text-neutral-400">
                {user.email ?? user.userId}
              </span>
            ) : (
              <button
                onClick={() => void db.cloud.login()}
                className="settings-login min-h-9 rounded-full px-3 text-[14px]
                  active:opacity-80"
              >
                登录以同步
              </button>
            )}
          </div>
        )}
        <div
          className="flex items-center justify-between border-b border-black/5 px-4
            py-3 dark:border-white/10"
        >
          <span className="text-[15px]">完成后的任务</span>
          <select
            aria-label="完成后的任务展示方式"
            value={prefs?.defaultCompletedDisplay ?? 'keep'}
            onChange={(e) =>
              void db.syncedPreferences.update('#prefs', {
                defaultCompletedDisplay: e.target.value as
                  | 'keep'
                  | 'collapse'
                  | 'hide',
                updatedAt: new Date().toISOString(),
              })
            }
            className="rounded-lg bg-neutral-100 px-2 py-1 text-[14px]
              dark:bg-neutral-700"
          >
            <option value="keep">保留在列表</option>
            <option value="collapse">折叠</option>
            <option value="hide">隐藏（记录页可查）</option>
          </select>
        </div>
        <Row
          label="本地存储保护"
          value={persisted === null ? '…' : persisted ? '已启用' : '未启用'}
        />
        <Row label="最后云端同步时间" value={lastSync} />
        <Row
          label="最后备份时间"
          value={
            lastBackupAt
              ? new Date(lastBackupAt).toLocaleString('zh-CN', {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '还没备份过'
          }
        />
        <Row label="版本" value={__APP_VERSION__} />
      </div>

      {persisted === false && (
        <button
          onClick={requestPersist}
          disabled={request === 'pending'}
          className="primary-action mt-4 w-full rounded-xl py-2.5 text-[15px] font-medium
            transition active:scale-[0.98] active:opacity-80
            disabled:opacity-50"
        >
          {request === 'pending' ? '请求中…' : '请求持久存储'}
        </button>
      )}

      {request === 'denied' && (
        <p
          className="mt-3 rounded-xl bg-amber-500/10 px-4 py-3 text-[13px] leading-relaxed
            text-amber-600 dark:text-amber-400"
        >
          Safari 本次未授予。iOS 不弹授权窗口，而是按你对这个 App
          的使用频率自动决定——日常使用几天后通常会自动升级为持久存储，期间云同步与备份照常兜底，无需处理。
        </p>
      )}

      <p className="mt-4 px-1 text-[13px] leading-relaxed text-neutral-400">
        未启用持久存储时 App 照常使用；系统存储紧张时本地数据有被清除的可能，请保持云端同步并定期备份。
      </p>

      <h2 className="section-label mt-8">数据备份</h2>
      <div className="list-card mt-2 overflow-hidden rounded-xl bg-white dark:bg-neutral-800">
        <button
          onClick={() => void doExport()}
          className="settings-data-action w-full border-b border-black/5 px-4 py-3 text-left text-[15px]
            dark:border-white/10"
        >
          导出全部数据（JSON）
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="settings-data-action w-full px-4 py-3 text-left text-[15px]"
        >
          从备份导入…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          aria-label="选择备份文件"
          className="hidden"
          onChange={(e) => {
            void onFilePicked(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>

      {importState.phase === 'confirm' && (
        <div
          className="mt-3 rounded-xl bg-amber-500/10 px-4 py-3 text-[13px] leading-relaxed
            text-amber-600 dark:text-amber-400"
        >
          <p>
            将用「{importState.name}」<strong>覆盖当前全部数据</strong>
            。导入前会自动下载一份当前数据的回滚备份；导入失败不会改动现有数据。
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => void doImport()}
              className="rounded-lg bg-red-500 px-3 py-1.5 text-[13px] font-medium text-white"
            >
              确认导入
            </button>
            <button
              onClick={() => setImportState({ phase: 'idle' })}
              className="rounded-lg px-3 py-1.5 text-[13px]"
            >
              取消
            </button>
          </div>
        </div>
      )}
      {importState.phase === 'done' && (
        <p className="mt-3 rounded-xl bg-emerald-500/10 px-4 py-3 text-[13px] text-emerald-600">
          导入完成，数据已恢复。
        </p>
      )}
      {importState.phase === 'error' && (
        <p className="mt-3 rounded-xl bg-red-500/10 px-4 py-3 text-[13px] text-red-500">
          导入失败：{importState.msg}（现有数据未被改动）
        </p>
      )}
    </section>
  )
}
