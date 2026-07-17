import type { ColorToken, SyncedPreferences, UIThemeId } from './db'

const VISUAL_PREFS_KEY = 'task-pwa-visual-preferences'

export interface VisualPreferences {
  uiTheme: UIThemeId
  theme: SyncedPreferences['theme']
  actionColor?: ColorToken
}

const defaults: VisualPreferences = {
  uiTheme: 'violet-lime',
  theme: 'system',
}

export function readStoredVisualPreferences(): VisualPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(VISUAL_PREFS_KEY) ?? '{}') as
      Partial<VisualPreferences> & { actionColor?: ColorToken | null }
    return {
      uiTheme: stored.uiTheme ?? defaults.uiTheme,
      theme: stored.theme ?? defaults.theme,
      actionColor: stored.actionColor ?? undefined,
    }
  } catch {
    return defaults
  }
}

export function applyVisualPreferences(prefs: Partial<VisualPreferences>) {
  const root = document.documentElement
  root.dataset.uiTheme = prefs.uiTheme ?? defaults.uiTheme
  root.dataset.appearance = prefs.theme ?? defaults.theme
  if (prefs.actionColor) root.dataset.actionColor = prefs.actionColor
  else delete root.dataset.actionColor
}

export function storeVisualPreferences(prefs: Partial<VisualPreferences>) {
  localStorage.setItem(
    VISUAL_PREFS_KEY,
    JSON.stringify({
      uiTheme: prefs.uiTheme ?? defaults.uiTheme,
      theme: prefs.theme ?? defaults.theme,
      actionColor: prefs.actionColor ?? null,
    }),
  )
}

export function previewVisualPreferences(patch: Partial<VisualPreferences>) {
  const next = { ...readStoredVisualPreferences(), ...patch }
  applyVisualPreferences(next)
  storeVisualPreferences(next)
}
