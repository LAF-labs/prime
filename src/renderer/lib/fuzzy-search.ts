/**
 * Fuzzy match scoring helpers.
 *
 * Two flavors:
 *
 *   1. `fuzzyScore` (sync, JS) — kept for backwards compatibility with the
 *      existing pickers (slash commands, agent, model). Cheap on small lists.
 *
 *   2. `fuzzyMatch` (async, Rust via IPC) — backed by `nucleo-matcher` in the
 *      backend. Use this when scoring more than ~200 candidates or when you
 *      want fzf-grade scoring quality. It hands off to the same matcher
 *      Helix and Zed use, off the renderer thread.
 *
 * Future migration: replace direct `fuzzyScore` callers with `fuzzyMatch`,
 * one picker at a time. The async signature is a wrapper so async/await
 * lands cleanly in components that already have `useEffect` for queries.
 */

import { ipc } from '@/lib/ipc'

/** Fuzzy match scoring: lower = better, null = no match */
export const fuzzyScore = (query: string, target: string): number | null => {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (t === q) return 0
  if (t.startsWith(q)) return 1
  const containsIdx = t.indexOf(q)
  if (containsIdx >= 0) return 2 + containsIdx
  let qi = 0
  let firstMatch = -1
  let gaps = 0
  let lastMatch = -1
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      if (firstMatch === -1) firstMatch = ti
      if (lastMatch >= 0 && ti - lastMatch > 1) gaps += ti - lastMatch - 1
      lastMatch = ti
      qi++
    }
  }
  if (qi < q.length) return null
  const span = lastMatch - firstMatch + 1
  return 100 + firstMatch * 2 + gaps * 3 + span
}

// ── Backend-powered async matcher (preferred for new callers) ────────────────

export interface FuzzyCandidate {
  readonly id: string
  readonly text: string
  readonly secondary?: string
}

export interface FuzzyMatch {
  readonly id: string
  /** Higher = better. Sorted descending in the returned array. */
  readonly score: number
  /** Byte indices into `text` (or `secondary` if `secondaryMatched`) of matched characters. */
  readonly indices: readonly number[]
  readonly secondaryMatched: boolean
}

/**
 * Score `query` against `candidates` using the Rust nucleo-matcher backend.
 *
 * - Empty/whitespace queries return all candidates with `score: 0` in input order.
 * - Results are sorted by descending score; the caller should not re-sort.
 * - Use `limit` to cap result count (the backend truncates after sort).
 */
export const fuzzyMatch = async (
  query: string,
  candidates: readonly FuzzyCandidate[],
  limit?: number,
): Promise<FuzzyMatch[]> => {
  if (candidates.length === 0) return []
  // The IPC layer only deals with plain JS objects; spread to drop readonly markers.
  const payload = candidates.map((c) => ({
    id: c.id,
    text: c.text,
    ...(c.secondary !== undefined ? { secondary: c.secondary } : {}),
  }))
  return ipc.fuzzyMatch(query, payload, limit)
}
