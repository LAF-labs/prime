import { useCallback, useSyncExternalStore } from 'react'

/**
 * Responsive media query hook using useSyncExternalStore.
 * Provides reactive breakpoint detection.
 *
 * @example
 * const isMobile = useMediaQuery('(max-width: 768px)')
 * const prefersDark = useMediaQuery('(prefers-color-scheme: dark)')
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (callback: () => void) => {
      if (typeof window === 'undefined') return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener('change', callback)
      return () => mql.removeEventListener('change', callback)
    },
    [query],
  )

  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(query).matches
  }, [query])

  const getServerSnapshot = useCallback(() => false, [])

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * Returns true when viewport is below 768px (mobile).
 */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 767px)')
}

/**
 * Returns true when viewport is below 1024px (tablet and below).
 */
export function useIsTablet(): boolean {
  return useMediaQuery('(max-width: 1023px)')
}
