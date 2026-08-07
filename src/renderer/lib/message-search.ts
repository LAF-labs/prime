/**
 * Global conversation search — pure helpers for the command palette's
 * "Messages" section.
 *
 * The heavy lifting (FTS5 over every stored message, operator hardening)
 * lives in the Rust backend behind `ipc.threadDbSearch`. This module owns the
 * client-side rules: when a query is worth sending, and how to turn a matched
 * message into a one-line highlighted snippet.
 */

/** Queries shorter than this never hit the database. */
export const MESSAGE_SEARCH_MIN_QUERY = 2

/** How many message hits the palette shows. */
export const MESSAGE_SEARCH_LIMIT = 8

/** Debounce between keystrokes and the FTS query. */
export const MESSAGE_SEARCH_DEBOUNCE_MS = 150

/** True when the query should trigger a message search. */
export const isSearchableQuery = (query: string): boolean =>
  query.trim().length >= MESSAGE_SEARCH_MIN_QUERY

/**
 * A snippet split around the first matched query token so the renderer can
 * highlight `match` without doing string surgery of its own. When no token
 * matches (FTS stemming can match forms the raw string doesn't contain),
 * `match` is empty and `before` carries a plain leading excerpt.
 */
export interface MessageSnippet {
  before: string
  match: string
  after: string
}

/**
 * Build a one-line snippet around the first occurrence of any query token.
 * Whitespace is collapsed first so multi-line messages read as prose.
 */
export const buildSnippet = (content: string, query: string, context = 40): MessageSnippet => {
  const flat = content.replace(/\s+/g, ' ').trim()
  const lower = flat.toLowerCase()

  let matchStart = -1
  let matchLength = 0
  for (const token of query.trim().split(/\s+/)) {
    if (!token) continue
    const idx = lower.indexOf(token.toLowerCase())
    if (idx >= 0 && (matchStart < 0 || idx < matchStart)) {
      matchStart = idx
      matchLength = token.length
    }
  }

  if (matchStart < 0) {
    const head = flat.slice(0, context * 2)
    return {
      before: head + (flat.length > head.length ? '…' : ''),
      match: '',
      after: '',
    }
  }

  const start = Math.max(0, matchStart - context)
  const end = Math.min(flat.length, matchStart + matchLength + context)
  return {
    before: (start > 0 ? '…' : '') + flat.slice(start, matchStart),
    match: flat.slice(matchStart, matchStart + matchLength),
    after: flat.slice(matchStart + matchLength, end) + (end < flat.length ? '…' : ''),
  }
}

/** Compact relative timestamp for a search hit ("5m ago", "3d ago", or a date). */
export const formatMessageTimestamp = (iso: string, now: number = Date.now()): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const diff = now - date.getTime()
  const minute = 60_000
  const hour = 3_600_000
  const day = 86_400_000
  if (diff < 0) return date.toLocaleDateString()
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}m ago`
  if (diff < day) return `${Math.floor(diff / hour)}h ago`
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`
  return date.toLocaleDateString()
}
