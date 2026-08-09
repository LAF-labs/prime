import { t } from '@/lib/i18n'
import type { ToolCall } from '@/types'

/**
 * One-line summary of a tool call, in the shape Claude Code and Codex use:
 * an action verb, the single argument that identifies the call, and a compact
 * result on the right.
 *
 *     Bash(bun run check:ts)                    2.1s
 *     Read(chat/EffortPicker.tsx)          142 lines
 *     Update(chat/ChatToolbar.tsx)             +12 −3
 *     Search("thinkingLevel")              12 results
 *
 * This replaces the older title + preview pair, which rendered the same text
 * twice — the backend's `tool_title` already embeds the command ("bash: cargo
 * test"), and the row then appended the command again as a preview. Rows ran
 * hundreds of characters wide and pushed the status icon off screen.
 *
 * Everything is derived from `rawInput`/`kind` rather than parsed out of the
 * stored title, so threads persisted before this change render the same way.
 */
export interface ToolCallSummary {
  /** Action verb: `Bash`, `Read`, `Update`, `Search`, … */
  readonly label: string
  /** The one argument that identifies this call. Never contains a newline. */
  readonly arg: string | null
  /** `arg` is a file path and should render as a file badge. */
  readonly argIsPath: boolean
  /** Compact result for the right edge: `142 lines`, `+12 −3`, `4.2KB`. */
  readonly result: string | null
}

/**
 * Tool name → the verb shown in the row.
 *
 * Deliberately English in every locale, matching Claude Code and Codex: these
 * read as the names of operations, and a translated verb beside an untranslated
 * shell command is harder to scan, not easier.
 */
const LABELS: Record<string, string> = {
  bash: 'Bash',
  shell: 'Bash',
  exec: 'Bash',
  ipython: 'Python',
  python: 'Python',
  read: 'Read',
  cat: 'Read',
  view: 'Read',
  write: 'Write',
  create: 'Write',
  edit: 'Update',
  str_replace: 'Update',
  multi_edit: 'Update',
  patch: 'Update',
  delete: 'Delete',
  remove: 'Delete',
  move: 'Move',
  rename: 'Move',
  glob: 'Search',
  grep: 'Search',
  search: 'Search',
  find: 'Search',
  web_search: 'Search',
  web_fetch: 'Fetch',
  fetch: 'Fetch',
  todo_write: 'Todo',
  task: 'Task',
}

/** Fallback verb per kind, for tools we have no name mapping for. */
const KIND_LABELS: Record<string, string> = {
  read: 'Read',
  edit: 'Update',
  delete: 'Delete',
  move: 'Move',
  search: 'Search',
  execute: 'Bash',
  fetch: 'Fetch',
  think: 'Think',
  switch_mode: 'Mode',
  other: 'Tool',
}

/**
 * Recover the tool name from the stored title.
 *
 * `tool_title` formats it as `"<tool>: <arg>"`, or bare `"<tool>"` when the
 * tool takes no headline argument. Splitting on the first `": "` is safe even
 * when the argument itself contains one.
 */
export const toolNameFromTitle = (title: string): string => {
  const idx = title.indexOf(': ')
  return (idx > 0 ? title.slice(0, idx) : title).trim().toLowerCase()
}

/** snake_case / kebab-case → Title Case, for tools with no mapping. */
const prettifyToolName = (name: string): string => {
  const cleaned = name.replace(/^mcp__/, '').replace(/[_-]+/g, ' ').trim()
  if (!cleaned) return 'Tool'
  return cleaned
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** Collapse to a single line: multi-line commands render their first line. */
const firstLine = (text: string): string => {
  const line = text.split('\n', 1)[0].trim()
  const isMultiline = text.trim().includes('\n')
  return isMultiline ? `${line} …` : line
}

/** Last two path segments — enough to disambiguate without eating the row. */
export const shortPath = (path: string): string => path.split('/').filter(Boolean).slice(-2).join('/')

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

const asString = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null

const asNumber = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/**
 * Unwrap a tool result envelope down to its text.
 *
 * prime-agent returns `{content: [{type: "text", text}, …]}`. Rendering that
 * object verbatim is what filled the expanded panel with `{"content":[{"text":`
 * noise instead of the output the user wanted to read.
 */
export const unwrapResultText = (raw: unknown): string | null => {
  if (typeof raw === 'string') return raw.length > 0 ? raw : null
  const obj = asRecord(raw)
  if (!obj) return null
  const content = obj.content
  if (Array.isArray(content)) {
    const parts = content
      .map((c) => (asRecord(c) ? asString((c as Record<string, unknown>).text) : null))
      .filter((s): s is string => s !== null)
    if (parts.length > 0) return parts.join('\n')
  }
  return asString(obj.text) ?? asString(obj.output) ?? asString(obj.result)
}

const countLines = (text: string): number => {
  const trimmed = text.replace(/\n+$/, '')
  return trimmed.length === 0 ? 0 : trimmed.split('\n').length
}

const plural = (n: number, one: string, many: string): string =>
  t(n === 1 ? one : many, { n: String(n) })

// ── Argument ──────────────────────────────────────────────────────

const extractArg = (
  tc: ToolCall,
  name: string,
  input: Record<string, unknown> | null,
): { arg: string | null; isPath: boolean } => {
  const path =
    tc.locations?.[0]?.path ??
    asString(input?.path) ??
    asString(input?.file_path) ??
    asString(input?.filePath)

  switch (LABELS[name] ?? KIND_LABELS[tc.kind ?? 'other']) {
    case 'Bash': {
      const cmd = asString(input?.command) ?? asString(input?.cmd)
      return { arg: cmd ? firstLine(cmd) : titleSuffix(tc.title), isPath: false }
    }
    case 'Python': {
      const code = asString(input?.code)
      return { arg: code ? firstLine(code) : titleSuffix(tc.title), isPath: false }
    }
    case 'Search': {
      const q = asString(input?.pattern) ?? asString(input?.query) ?? asString(input?.search)
      if (q) return { arg: `"${firstLine(q)}"`, isPath: false }
      return { arg: path ? shortPath(path) : titleSuffix(tc.title), isPath: !!path }
    }
    case 'Fetch': {
      const url = asString(input?.url) ?? asString(input?.uri)
      return { arg: url ?? titleSuffix(tc.title), isPath: false }
    }
    default: {
      if (path) return { arg: shortPath(path), isPath: true }
      return { arg: titleSuffix(tc.title), isPath: false }
    }
  }
}

/** The stored title's argument half, for calls whose rawInput never arrived. */
const titleSuffix = (title: string): string | null => {
  const idx = title.indexOf(': ')
  if (idx <= 0) return null
  const rest = title.slice(idx + 2).trim()
  return rest.length > 0 ? firstLine(rest) : null
}

// ── Result ────────────────────────────────────────────────────────

const editStats = (tc: ToolCall): string | null => {
  let added = 0
  let removed = 0
  let sawDiff = false
  for (const item of tc.content ?? []) {
    if (item.type !== 'diff') continue
    sawDiff = true
    added += item.linesAdded ?? 0
    removed += item.linesRemoved ?? 0
  }
  if (!sawDiff || (added === 0 && removed === 0)) return null
  return `+${added} −${removed}`
}

const searchCount = (output: Record<string, unknown> | null): number | null => {
  if (!output) return null
  const results = output.results
  if (Array.isArray(results)) return results.length
  const flat = asNumber(output.totalFiles) ?? asNumber(output.total) ?? asNumber(output.count)
  if (flat != null) return flat
  const items = output.items
  if (Array.isArray(items) && items.length > 0) {
    const json = asRecord(asRecord(items[0])?.Json)
    const nested = json?.results
    if (Array.isArray(nested)) return nested.length
    const nestedTotal = asNumber(json?.totalResults)
    if (nestedTotal != null) return nestedTotal
  }
  return null
}

const extractResult = (tc: ToolCall, label: string, output: Record<string, unknown> | null): string | null => {
  if (tc.status === 'in_progress') return null
  if (tc.status === 'cancelled') return null

  if (label === 'Update' || label === 'Write') {
    const stats = editStats(tc)
    if (stats) return stats
  }

  if (label === 'Search') {
    const n = searchCount(output)
    if (n != null) return plural(n, '{n} result', '{n} results')
  }

  const text = unwrapResultText(tc.rawOutput) ?? textFromContent(tc)
  if (text) {
    const lines = countLines(text)
    if (lines > 1) return plural(lines, '{n} line', '{n} lines')
  }
  return null
}

const textFromContent = (tc: ToolCall): string | null => {
  const parts = (tc.content ?? [])
    .filter((c) => c.type === 'content' && c.text)
    .map((c) => c.text as string)
  return parts.length > 0 ? parts.join('\n') : null
}

// ── Public entry point ────────────────────────────────────────────

export function getToolCallSummary(tc: ToolCall): ToolCallSummary {
  const name = toolNameFromTitle(tc.title)
  const input = asRecord(tc.rawInput)
  const output = asRecord(tc.rawOutput)

  // `other` is the kind the backend assigns to everything it does not
  // recognise, including every MCP tool. Letting it win here would label a
  // whole server's tools "Tool"; the tool's own name is more informative.
  const kindLabel = tc.kind && tc.kind !== 'other' ? KIND_LABELS[tc.kind] : undefined
  const label = LABELS[name] ?? kindLabel ?? prettifyToolName(name)

  const { arg, isPath } = extractArg(tc, name, input)

  return {
    label,
    arg,
    argIsPath: isPath,
    result: extractResult(tc, label, output),
  }
}
