import { useState, useEffect } from 'react'
import { ipc } from '@/lib/ipc'
import { useSettingsStore } from '@/stores/settingsStore'
import type { ProjectPrefs } from '@/types'

interface FaviconIcon {
  readonly type: 'favicon'
  readonly dataUrl: string
}

interface FrameworkIcon {
  readonly type: 'framework'
  readonly id: string
}

interface EmojiIcon {
  readonly type: 'emoji'
  readonly emoji: string
}

export type ProjectIconResult = FaviconIcon | FrameworkIcon | EmojiIcon | null

/** Module-level cache so re-renders and remounts don't re-fetch. */
const cache = new Map<string, ProjectIconResult>()

/** Delete the cache entry so overrides take effect immediately. */
export const clearIconCache = (cwd: string): void => {
  cache.delete(cwd)
}

/** Persist an icon override for a project and clear its cache. */
export const setProjectIconOverride = (
  cwd: string,
  override: ProjectPrefs['iconOverride'],
): void => {
  const { settings, saveSettings } = useSettingsStore.getState()
  const existing = settings.projectPrefs?.[cwd] ?? {}
  const updated = {
    ...settings,
    projectPrefs: {
      ...settings.projectPrefs,
      [cwd]: { ...existing, iconOverride: override },
    },
  }
  void saveSettings(updated)
  clearIconCache(cwd)
}

/** Detect and load the project icon for a given workspace path. */
export const useProjectIcon = (cwd: string): ProjectIconResult => {
  const override = useSettingsStore(
    (s) => s.settings.projectPrefs?.[cwd]?.iconOverride,
  )

  const [icon, setIcon] = useState<ProjectIconResult>(() => cache.get(cwd) ?? null)

  useEffect(() => {
    if (!cwd) return

    // Handle framework override
    if (override?.type === 'framework') {
      const result: FrameworkIcon = { type: 'framework', id: override.id }
      cache.set(cwd, result)
      setIcon(result)
      return
    }

    // Handle emoji override
    if (override?.type === 'emoji') {
      const result: EmojiIcon = { type: 'emoji', emoji: override.emoji }
      cache.set(cwd, result)
      setIcon(result)
      return
    }

    // Handle file override
    if (override?.type === 'file') {
      let stale = false
      const loadFileOverride = async (): Promise<void> => {
        try {
          const absolutePath = cwd + '/' + override.path
          const base64 = await ipc.readFileBase64(absolutePath)
          if (stale) return
          if (!base64) {
            cache.set(cwd, null)
            setIcon(null)
            return
          }
          const ext = override.path.split('.').pop()?.toLowerCase() ?? 'ico'
          const mime = ext === 'png' ? 'image/png' : ext === 'svg' ? 'image/svg+xml' : 'image/x-icon'
          const result: FaviconIcon = { type: 'favicon', dataUrl: `data:${mime};base64,${base64}` }
          cache.set(cwd, result)
          setIcon(result)
        } catch {
          if (!stale) {
            cache.set(cwd, null)
            setIcon(null)
          }
        }
      }
      void loadFileOverride()
      return () => { stale = true }
    }

    // No override — use cached value if available
    if (cache.has(cwd)) {
      setIcon(cache.get(cwd)!)
      return
    }

    // Fall through to auto-detection
    let stale = false
    const detect = async (): Promise<void> => {
      try {
        const info = await ipc.detectProjectIcon(cwd)
        if (stale) return
        if (!info) {
          cache.set(cwd, null)
          setIcon(null)
          return
        }
        if (info.iconType === 'framework') {
          const result: FrameworkIcon = { type: 'framework', id: info.value }
          cache.set(cwd, result)
          setIcon(result)
          return
        }
        if (info.iconType === 'favicon') {
          const base64 = await ipc.readFileBase64(info.value)
          if (stale) return
          if (!base64) {
            cache.set(cwd, null)
            setIcon(null)
            return
          }
          const ext = info.value.split('.').pop()?.toLowerCase() ?? 'ico'
          const mime = ext === 'png' ? 'image/png' : ext === 'svg' ? 'image/svg+xml' : 'image/x-icon'
          const result: FaviconIcon = { type: 'favicon', dataUrl: `data:${mime};base64,${base64}` }
          cache.set(cwd, result)
          setIcon(result)
        }
      } catch {
        if (!stale) {
          cache.set(cwd, null)
          setIcon(null)
        }
      }
    }
    void detect()
    return () => { stale = true }
  }, [cwd, override])

  return icon
}
