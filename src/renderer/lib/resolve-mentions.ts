/**
 * resolve-mentions.ts
 *
 * Resolves @file, @folder, @agent:name, @skill:name, and @prompt-name
 * references in a chat message before it is sent to kiro-cli ACP.
 *
 * This mirrors what the Kiro CLI does natively in its TUI:
 *  - @src/auth.ts  → inlines the file content as a fenced code block
 *  - @src/         → inlines a directory tree listing (3 levels, 10 items/level)
 *  - @prompt-name  → inlines the prompt content
 *  - @agent:name   → kept as-is (handled by the agent-switch path)
 *  - @skill:name   → kept as-is (handled by the skill-load path)
 *
 * File size limit: 250 KB (matches CLI behaviour). Larger files are truncated
 * with a warning comment so the model knows the content is incomplete.
 *
 * Directory limits: 3 levels deep, 10 items per level (matches CLI).
 * Ignored dirs: node_modules, .git, target, dist, build, .next, .cache
 */

import { ipc } from '@/lib/ipc'
import type { KiroPrompt } from '@/types'

const FILE_SIZE_LIMIT = 250 * 1024 // 250 KB

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'target', 'dist', 'build',
  '.next', '.cache', '__pycache__', '.turbo', 'coverage',
])

// ── Directory tree builder ────────────────────────────────────────────────────

interface TreeEntry {
  name: string
  isDir: boolean
  children?: TreeEntry[]
}

async function buildTree(
  workspace: string,
  relPath: string,
  depth: number,
  maxDepth: number,
  maxItems: number,
): Promise<TreeEntry[]> {
  if (depth > maxDepth) return []
  try {
    const entries = await ipc.scanDirectory(workspace, relPath, true)
    const visible = entries.filter((e: any) => !IGNORED_DIRS.has(e.name))
    const truncated = visible.length > maxItems
    const slice = visible.slice(0, maxItems)

    // Fetch all subdirectory children in parallel instead of sequentially
    const dirSlice = slice.filter((e: any) => e.isDir)
    const fileSlice = slice.filter((e: any) => !e.isDir)

    const childResults = await Promise.all(
      dirSlice.map((e: any) => {
        const childRel = relPath ? `${relPath}/${e.name}` : e.name
        return buildTree(workspace, childRel, depth + 1, maxDepth, maxItems)
      })
    )

    const result: TreeEntry[] = []
    for (let i = 0; i < dirSlice.length; i++) {
      result.push({ name: dirSlice[i].name, isDir: true, children: childResults[i] })
    }
    for (const e of fileSlice) {
      result.push({ name: e.name, isDir: false })
    }
    if (truncated) {
      result.push({ name: `... (${visible.length - maxItems} more items)`, isDir: false })
    }
    return result
  } catch {
    return []
  }
}

function renderTree(entries: TreeEntry[], prefix = ''): string {
  const lines: string[] = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const isLast = i === entries.length - 1
    const connector = isLast ? '└── ' : '├── '
    const childPrefix = prefix + (isLast ? '    ' : '│   ')
    lines.push(prefix + connector + e.name + (e.isDir ? '/' : ''))
    if (e.isDir && e.children && e.children.length > 0) {
      lines.push(renderTree(e.children, childPrefix))
    }
  }
  return lines.join('\n')
}

async function expandDirectory(workspace: string, dirPath: string): Promise<string> {
  // dirPath is relative to workspace
  const entries = await buildTree(workspace, dirPath, 0, 3, 10)
  const label = dirPath || '.'
  const tree = renderTree(entries)
  return `\`\`\`\n${label}/\n${tree}\n\`\`\``
}

// ── File content expander ─────────────────────────────────────────────────────

async function expandFile(absolutePath: string): Promise<string> {
  const content = await ipc.readFile(absolutePath)
  if (content === null) {
    return `<!-- @${absolutePath}: file not found -->`
  }
  const ext = absolutePath.split('.').pop() ?? ''
  // Encode to bytes for an accurate size check, then decode a safe slice back
  // to a string. content.slice(N) would slice by UTF-16 code units, not bytes,
  // which can produce incorrect results for multi-byte characters.
  const bytes = new TextEncoder().encode(content)
  if (bytes.length > FILE_SIZE_LIMIT) {
    const truncated = new TextDecoder().decode(bytes.slice(0, FILE_SIZE_LIMIT))
    return `\`\`\`${ext}\n${truncated}\n\`\`\`\n<!-- ⚠ File '${absolutePath}' was truncated (exceeds 250KB limit) -->`
  }
  return `\`\`\`${ext}\n${content}\n\`\`\``
}

// ── @mention regex ────────────────────────────────────────────────────────────
// Matches:
//   @"path with spaces"   (quoted)
//   @./relative/path
//   @/absolute/path
//   @plain-name           (prompt name or relative path)
// Does NOT match @agent:name or @skill:name (those are handled separately)
//
// The `@` must be at the start of the message or preceded by whitespace.
// This mirrors the FileMentionPicker trigger rule and prevents matches inside
// strings like `postgres:user@host:5432/db` or `name@example.com`.
//
// NOTE: No `g` flag — we use matchAll() which creates a fresh stateful iterator
// each call, avoiding shared lastIndex state across concurrent invocations.
const MENTION_PATTERN = /(?<=^|\s)@(?:"([^"]+)"|(\S+))/

// ── Main resolver ─────────────────────────────────────────────────────────────

export interface ResolveMentionsOptions {
  /** Absolute path to the project workspace */
  workspace: string | null
  /** Available prompts from kiro config */
  prompts: KiroPrompt[]
}

/**
 * Resolves all @mentions in `message` to their inline content.
 * Returns the expanded message string.
 *
 * Resolution order (matches CLI):
 *  1. @agent:name / @skill:name → kept as-is
 *  2. @prompt-name → prompt content
 *  3. @path (file) → file content as code block
 *  4. @path/ (directory) → directory tree
 */
export async function resolveMentions(
  message: string,
  opts: ResolveMentionsOptions,
): Promise<string> {
  const { workspace, prompts } = opts
  if (!message.includes('@')) return message

  // Collect all matches using matchAll (creates a fresh iterator, no shared lastIndex)
  const matches: Array<{ full: string; path: string; start: number; end: number }> = []
  for (const m of message.matchAll(new RegExp(MENTION_PATTERN.source, 'g'))) {
    const path = m[1] ?? m[2] // quoted or unquoted
    matches.push({ full: m[0], path, start: m.index!, end: m.index! + m[0].length })
  }

  if (matches.length === 0) return message

  // Resolve each match in parallel
  const resolved = await Promise.all(
    matches.map(async ({ path }) => {
      // 1. Skip agent/skill references — handled by the agent-switch path
      if (path.startsWith('agent:') || path.startsWith('skill:')) {
        return null // keep as-is
      }

      // 2. Prompt lookup (exact name match, case-insensitive)
      const prompt = prompts.find(
        (p) => p.name.toLowerCase() === path.toLowerCase(),
      )
      if (prompt) {
        return prompt.content
      }

      // 3. File / directory resolution
      if (!workspace) return null

      // Resolve to absolute path
      const absPath = path.startsWith('/')
        ? path
        : `${workspace}/${path.replace(/^\.\//, '')}`

      // Check if it's a directory (trailing slash or is_directory)
      const isDir = path.endsWith('/') || (await ipc.isDirectory(absPath).catch(() => false))
      if (isDir) {
        const relPath = path.startsWith('/')
          ? absPath.replace(workspace + '/', '')
          : path.replace(/^\.\//, '').replace(/\/$/, '')
        return expandDirectory(workspace, relPath)
      }

      // It's a file
      return expandFile(absPath)
    }),
  )

  // Rebuild message by replacing matches back-to-front to preserve indices
  let result = message
  for (let i = matches.length - 1; i >= 0; i--) {
    const { full, start, end } = matches[i]
    const replacement = resolved[i]
    if (replacement === null) continue // keep as-is
    result = result.slice(0, start) + replacement + result.slice(end)
  }

  return result
}

/**
 * Builds the folder tree string for a folder attachment path.
 * Used when a folder is dragged into the chat input.
 */
export async function buildFolderTree(
  workspace: string,
  folderPath: string,
): Promise<string> {
  // Determine relative path from workspace
  const relPath = folderPath.startsWith(workspace)
    ? folderPath.slice(workspace.length).replace(/^\//, '')
    : folderPath

  const label = relPath || folderPath.split('/').pop() || folderPath
  const entries = await buildTree(workspace, relPath, 0, 3, 10)
  const tree = renderTree(entries)
  return `Directory: ${label}/\n\`\`\`\n${label}/\n${tree}\n\`\`\``
}
