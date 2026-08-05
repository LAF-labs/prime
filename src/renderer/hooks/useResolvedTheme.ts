import { useSyncExternalStore } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import { getResolvedTheme } from '@/lib/theme'

/**
 * Subscribe to the *resolved* theme (`'dark'` | `'light'`).
 *
 * - When the user picks `'dark'` or `'light'` explicitly we return that.
 * - When the user picks `'system'` we read `prefers-color-scheme` and
 *   re-render whenever the OS preference flips.
 *
 * Used by code-block highlighting so dark/light switches re-tokenize without
 * a reload, and so the cache key correctly partitions per-theme HTML.
 */
function subscribeSystemMedia(callback: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {}
  }
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', callback)
  return () => mq.removeEventListener('change', callback)
}

function getSystemSnapshot(): 'dark' | 'light' {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'dark'
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useResolvedTheme(): 'dark' | 'light' {
  const mode = useSettingsStore((s) => s.settings.theme ?? 'dark')
  // Always subscribe to the system media query — cheap, and means we don't
  // miss a flip when the user toggles back to `system` later in the session.
  const systemTheme = useSyncExternalStore(
    subscribeSystemMedia,
    getSystemSnapshot,
    () => 'dark' as const,
  )
  if (mode === 'system') return systemTheme
  return getResolvedTheme(mode)
}
