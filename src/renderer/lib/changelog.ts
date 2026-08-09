export interface ChangelogEntry {
  readonly version: string
  readonly highlights: readonly string[]
}

/**
 * Changelog entries ordered newest-first, mirroring `CHANGELOG.md`.
 *
 * The first entry is shown in the "What's New" dialog after an update and by
 * the `/changelog` command. Add a new entry here in the same commit that bumps
 * the version, or the dialog silently shows nothing.
 */
export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: '0.1.1',
    highlights: [
      'Web research now fans out to parallel subagents, with a three-level effort picker',
      'Fetched web pages are read as clean articles instead of raw page source',
      'One simpler surface — the separate simple/developer modes are gone',
      'Sign in now opens Settings → Providers instead of a terminal window',
    ],
  },
  {
    version: '0.1.0',
    highlights: [
      'First release of LAF Agent',
      'The agent runtime ships inside the app — install the DMG and start working',
      'Per-tool permission approval before anything touches your files',
      'Korean and English, following your system language',
    ],
  },
] as const

/**
 * Compare two semver strings. Returns true if `a` is strictly newer than `b`.
 * Handles versions like "0.38.0" (no "v" prefix expected).
 */
export const isNewerVersion = (a: string, b: string): boolean => {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const va = pa[i] ?? 0
    const vb = pb[i] ?? 0
    if (va > vb) return true
    if (va < vb) return false
  }
  return false
}
