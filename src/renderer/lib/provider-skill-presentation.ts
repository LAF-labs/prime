/**
 * Provider skill presentation utilities.
 *
 * Formats provider skill display names and install source labels.
 */

export interface ProviderSkill {
  name: string
  displayName?: string | null
  path?: string
  scope?: string
}

/**
 * Format a provider skill's display name.
 * Uses displayName if available, otherwise title-cases the skill name.
 */
export function formatProviderSkillDisplayName(
  skill: Pick<ProviderSkill, 'name' | 'displayName'>,
): string {
  const displayName = skill.displayName?.trim()
  if (displayName) return displayName
  return titleCaseWords(skill.name)
}

/**
 * Determine the install source label for a provider skill.
 * Returns "App", "System", "Project", "Personal", or null.
 */
export function formatProviderSkillInstallSource(
  skill: Pick<ProviderSkill, 'path' | 'scope'>,
): string | null {
  const normalizedPath = (skill.path ?? '').replace(/\\/g, '/')
  if (normalizedPath.includes('/.codex/plugins/') || normalizedPath.includes('/.agents/plugins/')) {
    return 'App'
  }

  const normalizedScope = skill.scope?.trim().toLowerCase()
  if (normalizedScope === 'system') return 'System'
  if (normalizedScope === 'project' || normalizedScope === 'workspace' || normalizedScope === 'local') return 'Project'
  if (normalizedScope === 'user' || normalizedScope === 'personal') return 'Personal'
  if (normalizedScope) return titleCaseWords(normalizedScope)

  return null
}

function titleCaseWords(value: string): string {
  return value
    .split(/[\s:_-]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}
