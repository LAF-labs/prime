/**
 * Version skew detection.
 *
 * Detects mismatches between the laf-agent app version and the prime-agent version.
 * Shows a dismissible warning when versions are incompatible.
 */

const DISMISSED_KEY = 'laf-agent-version-skew-dismissed'

export interface VersionSkewInfo {
  /** The app (laf-agent) version */
  appVersion: string
  /** The CLI (prime-agent) version */
  cliVersion: string
  /** Whether the versions are compatible */
  isCompatible: boolean
  /** Human-readable description of the mismatch */
  message: string
}

/**
 * Compare app and CLI versions for compatibility.
 * Major version mismatches are always incompatible.
 * Minor version mismatches show a warning but are not blocking.
 */
export function checkVersionSkew(appVersion: string, cliVersion: string): VersionSkewInfo {
  const appParts = parseVersion(appVersion)
  const cliParts = parseVersion(cliVersion)

  if (!appParts || !cliParts) {
    return {
      appVersion,
      cliVersion,
      isCompatible: true, // Can't determine, assume compatible
      message: '',
    }
  }

  // Major version mismatch — incompatible
  if (appParts.major !== cliParts.major) {
    return {
      appVersion,
      cliVersion,
      isCompatible: false,
      message: `laf-agent v${appVersion} requires prime-agent v${appParts.major}.x but found v${cliVersion}. Please update.`,
    }
  }

  // Minor version: app ahead of CLI — warn
  if (appParts.minor > cliParts.minor) {
    return {
      appVersion,
      cliVersion,
      isCompatible: true,
      message: `prime-agent v${cliVersion} may be outdated. Consider updating to v${appVersion} for best compatibility.`,
    }
  }

  // CLI ahead of app — also warn (user updated CLI but not app)
  if (cliParts.minor > appParts.minor + 2) {
    return {
      appVersion,
      cliVersion,
      isCompatible: true,
      message: `prime-agent v${cliVersion} is newer than laf-agent v${appVersion}. Consider updating the app.`,
    }
  }

  return {
    appVersion,
    cliVersion,
    isCompatible: true,
    message: '',
  }
}

/**
 * Build a dismissal key for a specific version pair.
 */
export function buildDismissalKey(appVersion: string, cliVersion: string): string {
  return `${appVersion}:${cliVersion}`
}

/**
 * Check if a version skew warning has been dismissed.
 */
export function isVersionSkewDismissed(appVersion: string, cliVersion: string): boolean {
  try {
    const dismissed = localStorage.getItem(DISMISSED_KEY)
    if (!dismissed) return false
    return dismissed === buildDismissalKey(appVersion, cliVersion)
  } catch {
    return false
  }
}

/**
 * Dismiss a version skew warning (persists in localStorage).
 */
export function dismissVersionSkew(appVersion: string, cliVersion: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, buildDismissalKey(appVersion, cliVersion))
  } catch { /* best-effort */ }
}

/**
 * Clear the dismissal (e.g. when versions change).
 */
export function clearVersionSkewDismissal(): void {
  try {
    localStorage.removeItem(DISMISSED_KEY)
  } catch { /* best-effort */ }
}

// ── Helpers ──────────────────────────────────────────────────────

interface ParsedVersion {
  major: number
  minor: number
  patch: number
}

function parseVersion(version: string): ParsedVersion | null {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  }
}
