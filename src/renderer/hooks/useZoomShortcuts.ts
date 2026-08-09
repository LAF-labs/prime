import { useEffect } from 'react'
import { getCurrentWebview } from '@tauri-apps/api/webview'

/**
 * Deliberate zoom: ⌘+ / ⌘- / ⌘0.
 *
 * An earlier version also scaled on ctrl+wheel, which is how macOS delivers a
 * trackpad pinch — so the whole UI grew and shrank on accidental two-finger
 * gestures while scrolling. That handler is gone on purpose; only the explicit
 * keyboard shortcuts remain, and they scale the webview uniformly rather than
 * rewriting font-size settings (typography is fixed, see docs/design-system.md).
 */

const ZOOM_MIN = 0.5
const ZOOM_MAX = 2.0
const ZOOM_DEFAULT = 1.0
const ZOOM_STEP = 0.1
const ZOOM_STORAGE_KEY = 'laf-agent-zoom-level'

const clampZoom = (value: number): number =>
  Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value)) * 100) / 100

// localStorage throws in private browsing and on quota errors — a failure to
// remember the zoom level must not break zooming itself.
const readStoredZoom = (): number => {
  try {
    const raw = localStorage.getItem(ZOOM_STORAGE_KEY)
    const parsed = raw ? parseFloat(raw) : NaN
    return Number.isFinite(parsed) ? clampZoom(parsed) : ZOOM_DEFAULT
  } catch {
    return ZOOM_DEFAULT
  }
}

const writeStoredZoom = (value: number): void => {
  try {
    localStorage.setItem(ZOOM_STORAGE_KEY, String(value))
  } catch (e) {
    console.warn('[zoom] could not persist zoom level', e)
  }
}

export const useZoomShortcuts = (): void => {
  useEffect(() => {
    // `getCurrentWebview()` reaches into Tauri's injected globals and throws
    // synchronously when they are absent (a plain browser, a preview server).
    // An unguarded throw here takes the whole App subtree down with it.
    const setZoom = (value: number): void => {
      try {
        void getCurrentWebview().setZoom(value).catch(() => {})
      } catch {
        /* not running inside a webview — zoom is a no-op */
      }
    }

    let zoom = readStoredZoom()
    if (zoom !== ZOOM_DEFAULT) setZoom(zoom)

    const apply = (next: number): void => {
      const clamped = clampZoom(next)
      if (clamped === zoom) return
      zoom = clamped
      setZoom(clamped)
      writeStoredZoom(clamped)
    }

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (!e.metaKey && !e.ctrlKey) return
      if (e.altKey) return
      // `e.key` is layout-dependent for these; `e.code` is not, and the numpad
      // variants only ever arrive as codes.
      const isPlus = e.key === '=' || e.key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd'
      const isMinus = e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract'
      const isReset = e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0'

      if (isPlus) {
        e.preventDefault()
        apply(zoom + ZOOM_STEP)
      } else if (isMinus) {
        e.preventDefault()
        apply(zoom - ZOOM_STEP)
      } else if (isReset) {
        e.preventDefault()
        apply(ZOOM_DEFAULT)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
