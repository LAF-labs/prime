import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useResolvedTheme } from './useResolvedTheme'
import { useSettingsStore } from '@/stores/settingsStore'

interface MQ {
  matches: boolean
  listeners: Array<(e: MediaQueryListEvent) => void>
}

function installMatchMedia(initialDark: boolean): MQ {
  const mq: MQ = { matches: initialDark, listeners: [] }
  ;(window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = (() => ({
    matches: mq.matches,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
      mq.listeners.push(cb)
    },
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
      mq.listeners = mq.listeners.filter((l) => l !== cb)
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia
  return mq
}

describe('useResolvedTheme', () => {
  let originalMatchMedia: typeof window.matchMedia
  let originalSettings: ReturnType<typeof useSettingsStore.getState>['settings']

  beforeEach(() => {
    originalMatchMedia = window.matchMedia
    originalSettings = useSettingsStore.getState().settings
  })

  afterEach(() => {
    if (originalMatchMedia) {
      ;(window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia =
        originalMatchMedia
    }
    useSettingsStore.setState({ settings: originalSettings })
    vi.restoreAllMocks()
  })

  it('returns dark when settings.theme is dark', () => {
    installMatchMedia(false)
    useSettingsStore.setState({
      settings: { ...originalSettings, theme: 'dark' },
    })
    const { result } = renderHook(() => useResolvedTheme())
    expect(result.current).toBe('dark')
  })

  it('returns light when settings.theme is light', () => {
    installMatchMedia(true)
    useSettingsStore.setState({
      settings: { ...originalSettings, theme: 'light' },
    })
    const { result } = renderHook(() => useResolvedTheme())
    expect(result.current).toBe('light')
  })

  it('follows system media when settings.theme is system', () => {
    const mq = installMatchMedia(true)
    useSettingsStore.setState({
      settings: { ...originalSettings, theme: 'system' },
    })
    const { result } = renderHook(() => useResolvedTheme())
    expect(result.current).toBe('dark')

    act(() => {
      mq.matches = false
      for (const l of mq.listeners) l({ matches: false } as MediaQueryListEvent)
    })
    expect(result.current).toBe('light')
  })
})
