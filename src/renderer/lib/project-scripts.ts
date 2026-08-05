/**
 * Project scripts management.
 *
 * Named scripts per project (like npm scripts) with keybinding integration.
 * Scripts are stored in project prefs and can be run via keyboard shortcuts.
 */

export interface ProjectScript {
  /** Unique ID for the script within the project */
  id: string
  /** Display name */
  name: string
  /** Shell command to execute */
  command: string
  /** Optional keyboard shortcut (e.g. "ctrl+shift+t") */
  keybinding?: string
  /** Whether this is the primary/default script */
  isPrimary?: boolean
}

/**
 * Generate a unique script ID from a name, avoiding collisions.
 */
export function generateScriptId(name: string, existingIds: Set<string>): string {
  const base = sanitizeScriptId(name)
  if (!existingIds.has(base)) return base

  let counter = 2
  while (existingIds.has(`${base}-${counter}`)) {
    counter++
  }
  return `${base}-${counter}`
}

/**
 * Sanitize a name into a valid script ID.
 */
export function sanitizeScriptId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'script'
}

/**
 * Convert a script ID to a keybinding command name.
 * Example: "run-tests" → "project.script.run-tests"
 */
export function scriptIdToCommand(scriptId: string): string {
  return `project.script.${scriptId}`
}

/**
 * Extract the script ID from a keybinding command name.
 * Example: "project.script.run-tests" → "run-tests"
 */
export function commandToScriptId(command: string): string | null {
  const prefix = 'project.script.'
  if (!command.startsWith(prefix)) return null
  return command.slice(prefix.length)
}

/**
 * Find the primary script for a project (first one marked isPrimary, or the first script).
 */
export function findPrimaryScript(scripts: ProjectScript[]): ProjectScript | null {
  return scripts.find((s) => s.isPrimary) ?? scripts[0] ?? null
}

/**
 * Parse scripts from package.json content.
 * Returns common scripts that are useful to surface in the UI.
 */
export function parsePackageJsonScripts(content: string): ProjectScript[] {
  try {
    const pkg = JSON.parse(content)
    const scripts = pkg.scripts
    if (!scripts || typeof scripts !== 'object') return []

    const result: ProjectScript[] = []
    const USEFUL_SCRIPTS = ['dev', 'start', 'build', 'test', 'lint', 'format', 'typecheck', 'check']

    for (const [name, command] of Object.entries(scripts)) {
      if (typeof command !== 'string') continue
      if (USEFUL_SCRIPTS.includes(name) || name.startsWith('test:') || name.startsWith('build:')) {
        result.push({
          id: sanitizeScriptId(name),
          name,
          command: `npm run ${name}`,
          isPrimary: name === 'dev' || name === 'start',
        })
      }
    }

    return result
  } catch {
    return []
  }
}

/**
 * Parse scripts from a Makefile.
 * Returns targets that look like user-facing commands.
 */
export function parseMakefileTargets(content: string): ProjectScript[] {
  const result: ProjectScript[] = []
  const SKIP_PATTERNS = /^(\.|_|all$|clean$|install$|help$)/

  for (const line of content.split('\n')) {
    const match = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*)\s*:/)
    if (!match) continue
    const target = match[1]
    if (SKIP_PATTERNS.test(target)) continue

    result.push({
      id: sanitizeScriptId(target),
      name: target,
      command: `make ${target}`,
    })
  }

  return result.slice(0, 20) // Cap to avoid huge Makefiles
}

/**
 * Detect and parse project scripts from common config files.
 * Returns scripts found in package.json, Makefile, or Cargo.toml.
 */
export async function detectProjectScripts(
  readFile: (path: string) => Promise<string | null>,
  workspace: string,
): Promise<ProjectScript[]> {
  // Try package.json first
  const pkgJson = await readFile(`${workspace}/package.json`)
  if (pkgJson) {
    const scripts = parsePackageJsonScripts(pkgJson)
    if (scripts.length > 0) return scripts
  }

  // Try Makefile
  const makefile = await readFile(`${workspace}/Makefile`)
  if (makefile) {
    const scripts = parseMakefileTargets(makefile)
    if (scripts.length > 0) return scripts
  }

  // Cargo.toml — standard Rust commands
  const cargoToml = await readFile(`${workspace}/Cargo.toml`)
  if (cargoToml) {
    return [
      { id: 'build', name: 'build', command: 'cargo build', isPrimary: true },
      { id: 'test', name: 'test', command: 'cargo test' },
      { id: 'run', name: 'run', command: 'cargo run' },
      { id: 'check', name: 'check', command: 'cargo check' },
      { id: 'clippy', name: 'clippy', command: 'cargo clippy' },
    ]
  }

  return []
}
