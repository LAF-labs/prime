import type { ThemeMode } from '@/types'

const THEME_KEY = 'kirodex-theme'

/** Resolve 'system' to the actual dark/light value based on OS preference. */
export const getResolvedTheme = (mode: ThemeMode): 'dark' | 'light' => {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

/** Read the persisted theme from localStorage (falls back to 'dark'). */
export const readPersistedTheme = (): ThemeMode => {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'dark' || stored === 'light' || stored === 'system') return stored
  } catch { /* ignore */ }
  return 'dark'
}

/** Persist theme choice to localStorage for instant access before React boots. */
export const persistTheme = (mode: ThemeMode): void => {
  try { localStorage.setItem(THEME_KEY, mode) } catch { /* ignore */ }
}

/**
 * Apply the theme to the document. Adds/removes the `dark` class on <html>,
 * sets color-scheme, and updates the body background for the splash screen.
 * Suppresses transitions briefly to avoid a flash.
 */
export const applyTheme = (mode: ThemeMode): void => {
  const resolved = getResolvedTheme(mode)
  const root = document.documentElement

  // Suppress transitions during theme switch
  root.classList.add('no-transitions')

  if (resolved === 'dark') {
    root.classList.add('dark')
    document.body.style.backgroundColor = '#0a0a0a'
  } else {
    root.classList.remove('dark')
    document.body.style.backgroundColor = '#ffffff'
  }

  // Re-enable transitions after a frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove('no-transitions')
    })
  })
}

/** Subscribe to OS theme changes. Returns an unsubscribe function. */
export const listenSystemTheme = (onChange: () => void): (() => void) => {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
