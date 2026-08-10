import React from 'react'
import { LocaleBoundary } from '@/components/LocaleBoundary'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import '../tailwind.css'

// Apply persisted theme immediately to prevent flash
import { readPersistedTheme, applyTheme, getResolvedTheme } from './lib/theme'
import { ipc } from '@/lib/ipc'
applyTheme(readPersistedTheme())

function showError(err: unknown) {
  console.error('[LAF Agent crash]', err)
}

// Errors that are transient (HMR, StrictMode) and should auto-recover, not crash
const RECOVERABLE_ERRORS = [
  'hook.getSnapshot',       // Zustand/React store not yet initialized during HMR
  'hook?.getSnapshot',      // same, alternate message
  'useSyncExternalStore',   // same root cause
]

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null; showRecovery: boolean }
> {
  state: { error: Error | null; showRecovery: boolean } = { error: null, showRecovery: false }
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  static getDerivedStateFromError(error: Error) { return { error } }

  componentDidCatch(error: Error) {
    const msg = error.message ?? ''
    // Auto-recover from transient HMR/store-init errors
    if (RECOVERABLE_ERRORS.some((r) => msg.includes(r))) {
      console.warn('[ErrorBoundary] Recoverable error, retrying:', msg)
      this.retryTimer = setTimeout(() => this.setState({ error: null }), 100)
      return
    }
    showError(error)
  }

  componentWillUnmount() {
    if (this.retryTimer) clearTimeout(this.retryTimer)
  }

  private handleResetAppData = async () => {
    try {
      await ipc.resetAppData()
      window.location.reload()
    } catch (err) {
      console.error('[ErrorBoundary] Reset failed:', err)
      // Last resort: reload anyway
      window.location.reload()
    }
  }

  render() {
    if (!this.state.error) return this.props.children

    // The crash screen renders before/without the app CSS, so it uses inline
    // styles — but it must still honor the persisted theme with the documented
    // token hex pairs instead of a hardcoded dark palette.
    const isDark = getResolvedTheme(readPersistedTheme()) === 'dark'
    const c = isDark
      ? { bg: '#262626', fg: '#ececec', muted: '#a1a1a1', faint: '#7a7a7a', border: '#3a3a3a', danger: '#f87171' }
      : { bg: '#fafafa', fg: '#1f1f1f', muted: '#6e6e6e', faint: '#9a9a9a', border: '#e6e6e6', danger: '#dc2626' }

    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100vh', gap: '16px', padding: '24px', textAlign: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
        color: c.fg, background: c.bg,
      }}>
        <div style={{ fontSize: '32px', marginBottom: '4px' }}>⚠️</div>
        <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>{t('LAF Agent failed to start')}</h2>
        <p style={{ fontSize: '13px', color: c.muted, maxWidth: '360px', margin: 0, lineHeight: 1.5 }}>
          {t('This usually happens when app data gets corrupted. You can reset it to start fresh, or try reloading.')}
        </p>
        <p style={{ fontSize: '11px', color: c.faint, maxWidth: '400px', margin: 0, fontFamily: 'monospace', wordBreak: 'break-all' }}>
          {this.state.error.message}
        </p>
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 16px', fontSize: '13px', fontWeight: 500, borderRadius: '8px',
              border: `1px solid ${c.border}`, background: 'transparent', color: c.fg, cursor: 'pointer',
            }}
          >
            {t('Reload')}
          </button>
          {!this.state.showRecovery ? (
            <button
              onClick={() => this.setState({ showRecovery: true })}
              style={{
                padding: '8px 16px', fontSize: '13px', fontWeight: 500, borderRadius: '8px',
                border: `1px solid ${c.danger}`, background: 'transparent', color: c.danger, cursor: 'pointer',
              }}
            >
              {t('Reset app data')}
            </button>
          ) : (
            <button
              onClick={this.handleResetAppData}
              style={{
                padding: '8px 16px', fontSize: '13px', fontWeight: 500, borderRadius: '8px',
                border: 'none', background: '#dc2626', color: '#fff', cursor: 'pointer',
              }}
            >
              {t('Confirm reset — delete all history')}
            </button>
          )}
        </div>
      </div>
    )
  }
}

// Errors that are safe to ignore — they don't indicate a real crash
const IGNORED_ERRORS = [
  'ResizeObserver loop',           // benign: layout shift during observation
  'ResizeObserver loop completed', // same, different wording across browsers
  'listeners[eventId]',            // Tauri listener cleanup race during HMR/StrictMode
  'unregisterListener',            // same — stale listener map after hot reload
  'hook.getSnapshot',              // Zustand store not ready during HMR
  'hook?.getSnapshot',             // same
]

window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason instanceof Error ? e.reason.message : String(e.reason ?? '')
  if (IGNORED_ERRORS.some((i) => msg.includes(i))) return
  showError(e.reason)
})
window.addEventListener('error', (e) => {
  const msg = e.message ?? (e.error instanceof Error ? e.error.message : '')
  if (IGNORED_ERRORS.some((i) => msg.includes(i))) return
  showError(e.error ?? e.message)
})

// ⌘R / Ctrl+R to reload
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
    e.preventDefault()
    window.location.reload()
  }
})

import { t } from '@/lib/i18n'

// Safety net: persist thread history before the window closes.
// We eagerly import the store module so the reference is available synchronously
// in the beforeunload handler (dynamic import() would be async and never complete).
let _persistHistory: (() => void) | null = null
// Dev-only: expose the stores so a plain-browser session (bun run dev:renderer,
// no Tauri IPC) can be steered for visual work — e.g. skipping onboarding.
if (import.meta.env.DEV) {
  import('./stores/settingsStore').then((m) => {
    (window as unknown as Record<string, unknown>).__settingsStore = m.useSettingsStore
  }).catch(() => {})
  import('./stores/taskStore').then((m) => {
    (window as unknown as Record<string, unknown>).__taskStore = m.useTaskStore
  }).catch(() => {})
}

import('./stores/taskStore').then((m) => {
  _persistHistory = () => m.useTaskStore.getState().persistHistory()
})
window.addEventListener('beforeunload', () => {
  try { _persistHistory?.() } catch { /* ignore */ }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <LocaleBoundary>
        <App />
      </LocaleBoundary>
    </ErrorBoundary>
  </React.StrictMode>,
)

// React mounted — cancel the crash-fallback timer and remove both overlays
if ((window as unknown as Record<string, unknown>).__crashTimer) {
  clearTimeout((window as unknown as Record<string, unknown>).__crashTimer as number)
}
document.getElementById('crash-fallback')?.remove()

const splash = document.getElementById('splash')
if (splash) {
  splash.style.opacity = '0'
  const handleRemove = () => splash.remove()
  splash.addEventListener('transitionend', handleRemove, { once: true })
  setTimeout(handleRemove, 500)
}

