import type { ToolCall } from '@/types'

/**
 * Lightweight detection + extraction for "fetch" / web-style tool calls.
 *
 * The agent backend is free to name a web tool anything (e.g. `webFetch`,
 * `web_fetch`, `WebFetch`, `Fetching web content`, MCP `fetch_url`, …) so we
 * detect by `kind === 'fetch'` first and fall back to title heuristics.
 *
 * The extracted metadata mirrors what the Kiro IDE shows: a clickable URL,
 * the response payload size, and the elapsed duration from invocation to
 * completion.
 */

export interface FetchMeta {
  /** First URL from rawInput, or null if none could be extracted. */
  readonly url: string | null
  /** Response payload size in bytes, or null if not derivable. */
  readonly bytes: number | null
  /** Elapsed milliseconds between createdAt and completedAt, or null. */
  readonly durationMs: number | null
}

const URL_KEYS: ReadonlyArray<string> = ['url', 'href', 'link', 'uri', 'target_url', 'targetUrl']

/** Returns true when `tc` should render with the enriched fetch UI. */
export function isFetchToolCall(tc: ToolCall): boolean {
  if (tc.kind === 'fetch') return true
  // Be conservative on the title fallback: the user's other "fetch"-y kinds
  // (e.g. `git fetch`) shouldn't get a globe + URL treatment, so require
  // "web" alongside a fetch verb in the title. We intentionally do NOT
  // fall back to detecting URLs in rawInput — many non-fetch tools (git clone,
  // execute with a URL arg, MCP tools) have URLs in their input without being
  // web-fetch operations.
  const title = (tc.title ?? '').toLowerCase()
  if (/\bweb\b/.test(title) && /fetch/.test(title)) return true
  return false
}

/** Try to find a URL string in a tool call's `rawInput` payload. */
export function extractUrl(rawInput: unknown): string | null {
  if (typeof rawInput === 'string') return looksLikeUrl(rawInput) ? rawInput : null
  if (!rawInput || typeof rawInput !== 'object') return null
  const obj = rawInput as Record<string, unknown>
  for (const key of URL_KEYS) {
    const v = obj[key]
    if (typeof v === 'string' && looksLikeUrl(v)) return v
  }
  // Some MCP servers nest the URL inside `arguments` / `params`.
  for (const wrap of ['arguments', 'params', 'input']) {
    const inner = obj[wrap]
    if (inner && typeof inner === 'object') {
      const found = extractUrl(inner)
      if (found) return found
    }
  }
  return null
}

const looksLikeUrl = (s: string): boolean => /^https?:\/\//i.test(s.trim())

/** Strip protocol + trailing slash for compact display. */
export function shortenUrl(url: string, maxLen: number = 60): string {
  let s = url.replace(/^https?:\/\//i, '').replace(/\/$/, '')
  if (s.length > maxLen) s = s.slice(0, maxLen - 1) + '…'
  return s
}

/** Estimate the byte size of a fetch tool's response payload. */
export function extractBytes(rawOutput: unknown): number | null {
  if (rawOutput == null) return null
  // Prefer explicit size fields when the backend provides them.
  if (typeof rawOutput === 'object' && !Array.isArray(rawOutput)) {
    const obj = rawOutput as Record<string, unknown>
    for (const key of ['bytes', 'size', 'contentLength', 'content_length']) {
      const v = obj[key]
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v
    }
    // Some payloads expose the body under `body` / `content` / `text`.
    for (const key of ['body', 'content', 'text', 'data']) {
      const v = obj[key]
      if (typeof v === 'string') return byteLength(v)
    }
  }
  if (typeof rawOutput === 'string') return byteLength(rawOutput)
  // Last resort: serialise and measure. Slightly over-counts JSON
  // overhead but is always non-negative.
  try { return byteLength(JSON.stringify(rawOutput)) } catch { return null }
}

const byteLength = (s: string): number => {
  // Browsers always have TextEncoder; fall back to length if it's missing
  // for some exotic test environment.
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(s).length
  return s.length
}

/** Format a byte count the way Kiro IDE does: "1.4 KB", "11.2 KB", "2.3 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** Format a duration in ms as "920ms", "1.36s", "12.4s", "1m 03s". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

/** Compute display metadata for a fetch-style tool call. */
export function getFetchMeta(tc: ToolCall): FetchMeta {
  const url = extractUrl(tc.rawInput)
  const bytes = tc.status === 'completed' ? extractBytes(tc.rawOutput) : null
  const durationMs =
    tc.createdAt && tc.completedAt
      ? Math.max(0, new Date(tc.completedAt).getTime() - new Date(tc.createdAt).getTime())
      : null
  return { url, bytes, durationMs }
}
