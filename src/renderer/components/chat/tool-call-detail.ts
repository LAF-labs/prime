import type { ToolCall } from '@/types'

/**
 * Extracts a compact detail/preview string for any tool call.
 * Shown as a secondary label next to the tool title in the row.
 *
 * Each tool kind gets a tailored extraction strategy.
 */

// ── Public API ────────────────────────────────────────────────────

export interface ToolDetail {
  /** Short preview text (e.g. file path, command, result count). */
  readonly preview: string | null
  /** Duration in ms (createdAt → completedAt). Null if not available. */
  readonly durationMs: number | null
}

export function getToolDetail(tc: ToolCall): ToolDetail {
  const durationMs = computeDuration(tc)
  const preview = extractPreview(tc)
  return { preview, durationMs }
}

/** Format duration for display. */
export function formatToolDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

// ── Internals ─────────────────────────────────────────────────────

function computeDuration(tc: ToolCall): number | null {
  if (!tc.createdAt || !tc.completedAt) return null
  const ms = new Date(tc.completedAt).getTime() - new Date(tc.createdAt).getTime()
  return ms >= 0 ? ms : null
}

function extractPreview(tc: ToolCall): string | null {
  const input = asRecord(tc.rawInput)
  const output = asRecord(tc.rawOutput)

  switch (tc.kind) {
    case 'read':
      return extractReadPreview(tc, input)
    case 'edit':
    case 'delete':
    case 'move':
      return extractEditPreview(tc, input)
    case 'search':
      return extractSearchPreview(tc, input, output)
    case 'execute':
      return extractExecutePreview(tc, input)
    case 'fetch':
      return null // Handled by fetch-display.ts with richer rendering
    case 'think':
      return null // Thinking doesn't need a preview
    default:
      return extractGenericPreview(tc, input, output)
  }
}

// ── Per-kind extractors ───────────────────────────────────────────

function extractReadPreview(tc: ToolCall, input: Record<string, unknown> | null): string | null {
  // If the title already contains the file name, skip
  const path = firstLocation(tc) ?? asString(input?.path) ?? asString(input?.file_path)
  if (!path) return null
  const fileName = path.split('/').pop() ?? path
  // Don't repeat if the title already mentions the file
  if (tc.title.includes(fileName)) return null
  return fileName
}

function extractEditPreview(tc: ToolCall, input: Record<string, unknown> | null): string | null {
  const path = firstLocation(tc) ?? asString(input?.path) ?? asString(input?.file_path)
  if (!path) return null
  const fileName = path.split('/').pop() ?? path
  if (tc.title.includes(fileName)) return null
  return fileName
}

function extractSearchPreview(
  _tc: ToolCall,
  input: Record<string, unknown> | null,
  output: Record<string, unknown> | null,
): string | null {
  // Show the query if available
  const query = asString(input?.query) ?? asString(input?.pattern) ?? asString(input?.search)
  // Show result count from output — handle both flat and nested structures
  let resultCount: number | null = null
  const totalFiles = asNumber(output?.totalFiles) ?? asNumber(output?.total) ?? asNumber(output?.count)
  const results = output?.results
  if (Array.isArray(results)) {
    resultCount = results.length
  } else if (totalFiles != null) {
    resultCount = totalFiles
  } else {
    // Handle nested structure: { items: [{ Json: { results: [...] } }] }
    const items = output?.items
    if (Array.isArray(items) && items.length > 0) {
      const first = items[0] as Record<string, unknown> | undefined
      const json = first?.Json as Record<string, unknown> | undefined
      const nestedResults = json?.results
      if (Array.isArray(nestedResults)) resultCount = nestedResults.length
      const nestedTotal = asNumber(json?.totalResults)
      if (resultCount == null && nestedTotal != null) resultCount = nestedTotal
    }
  }

  const parts: string[] = []
  if (query) {
    // Show up to 80 chars for web search queries (they tend to be longer)
    const maxLen = 80
    if (query.length <= maxLen) parts.push(`"${query}"`)
    else parts.push(`"${query.slice(0, maxLen - 1)}…"`)
  }
  if (resultCount != null) {
    const suffix = output?.truncated === true ? '+' : ''
    parts.push(`${resultCount}${suffix} result${resultCount === 1 ? '' : 's'}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

function extractExecutePreview(_tc: ToolCall, input: Record<string, unknown> | null): string | null {
  const command = asString(input?.command) ?? asString(input?.cmd)
  if (!command) return null
  // Show a compact version of the command
  const trimmed = command.trim()
  if (trimmed.length <= 60) return trimmed
  return trimmed.slice(0, 57) + '…'
}

function extractGenericPreview(
  tc: ToolCall,
  input: Record<string, unknown> | null,
  output: Record<string, unknown> | null,
): string | null {
  // Try to find a meaningful field from input
  const path = firstLocation(tc) ?? asString(input?.path) ?? asString(input?.file_path)
  if (path) {
    const fileName = path.split('/').pop() ?? path
    if (!tc.title.includes(fileName)) return fileName
  }
  // Try output summary
  const content = asString(output?.content) ?? asString(output?.text) ?? asString(output?.body)
  if (content) {
    const firstLine = content.split('\n')[0].trim()
    if (firstLine.length > 0 && firstLine.length <= 60) return firstLine
    if (firstLine.length > 60) return firstLine.slice(0, 57) + '…'
  }
  return null
}

// ── Helpers ───────────────────────────────────────────────────────

function firstLocation(tc: ToolCall): string | null {
  return tc.locations?.[0]?.path ?? null
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  return null
}

function asString(v: unknown): string | null {
  if (typeof v === 'string' && v.length > 0) return v
  return null
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  return null
}
