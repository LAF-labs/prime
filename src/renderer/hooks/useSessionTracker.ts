import { useEffect, useRef } from 'react'
import { record } from '@/lib/analytics-collector'
import { useSettingsStore } from '@/stores/settingsStore'

/** Tracks window focus/blur to record coding session durations. */
export const useSessionTracker = (): void => {
  const focusedAt = useRef<number | null>(null)

  useEffect(() => {
    const markFocus = (): void => {
      focusedAt.current = Date.now()
    }
    const markBlur = (): void => {
      if (!focusedAt.current) return
      const seconds = Math.round((Date.now() - focusedAt.current) / 1000)
      focusedAt.current = null
      if (seconds < 2) return // ignore sub-2s focus blips
      const ws = useSettingsStore.getState().activeWorkspace
      const proj = ws ? ws.replace(/\\/g, '/').split('/').pop() : undefined
      record('session', { project: proj, value: seconds })
    }
    const handleVisibility = (): void => {
      if (document.visibilityState === 'visible') markFocus()
      else markBlur()
    }
    // Start tracking if already focused
    if (document.hasFocus()) markFocus()
    window.addEventListener('focus', markFocus)
    window.addEventListener('blur', markBlur)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      markBlur() // record final session on unmount
      window.removeEventListener('focus', markFocus)
      window.removeEventListener('blur', markBlur)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])
}
