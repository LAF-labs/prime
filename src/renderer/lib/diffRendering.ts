/**
 * Theme + hashing helpers shared by chat code-block highlighting and any
 * other Shiki-based renderers (e.g. DiffPanel, DiffViewer).
 *
 * Centralizing the `pierre-light`/`pierre-dark` choice keeps the theme
 * mapping in one place so future changes don't have to be hunted across
 * call sites.
 */
export const DIFF_THEME_NAMES = {
  light: 'pierre-light',
  dark: 'pierre-dark',
} as const

export type DiffThemeName = (typeof DIFF_THEME_NAMES)[keyof typeof DIFF_THEME_NAMES]

export function resolveDiffThemeName(theme: 'light' | 'dark'): DiffThemeName {
  return theme === 'dark' ? DIFF_THEME_NAMES.dark : DIFF_THEME_NAMES.light
}

// FNV-1a 32-bit. Used to build stable, short cache keys for highlighted code
// without pulling in a crypto dependency. Collisions are tolerable here —
// the cache key also includes the code length and language, and a miss just
// re-runs Shiki.
const FNV_OFFSET_BASIS_32 = 0x811c9dc5
const FNV_PRIME_32 = 0x01000193

export function fnv1a32(input: string): number {
  let hash = FNV_OFFSET_BASIS_32 >>> 0
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME_32) >>> 0
  }
  return hash >>> 0
}
