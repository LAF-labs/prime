/**
 * Shared platform detection.
 *
 * Every component that branches on platform (keyboard-shortcut glyphs,
 * traffic-light spacing, window controls) imports from here instead of
 * re-deriving it from the user agent. One detector, one answer.
 */

export type AppPlatform = 'macos' | 'windows' | 'linux'

export const detectPlatform = (): AppPlatform => {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : ''
  if (ua.includes('mac')) return 'macos'
  if (ua.includes('win')) return 'windows'
  return 'linux'
}

export const PLATFORM: AppPlatform = detectPlatform()

export const IS_MAC = PLATFORM === 'macos'

/** Bare modifier label for standalone display: `⌘` or `Ctrl`. */
export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl'

/** Modifier prefix for compact combos: `⌘K` on macOS, `Ctrl+K` elsewhere. */
export const MOD_PREFIX = IS_MAC ? '⌘' : 'Ctrl+'
