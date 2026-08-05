/**
 * MessageList.logic.ts — Pure logic for the MessageList component.
 *
 * Contains timeline row derivation helpers, scroll state management logic,
 * and search-related computations extracted from the component.
 */

import type { TimelineRow } from '@/lib/timeline'

export const AUTO_SCROLL_THRESHOLD = 150

/** Per-row-type height estimates so the virtualizer doesn't leave large gaps
 *  before measureElement fires. Overestimating slightly is better than
 *  underestimating — underestimates cause rows to overlap until measured. */
export const ROW_HEIGHT_ESTIMATES: Record<string, number> = {
  'user-message': 72,
  'system-message': 44,
  'assistant-text': 100,
  'work': 64,
  'working': 40,
  'changed-files': 120,
}

/**
 * Determine if the user is near the bottom of the scroll container.
 */
export function isNearBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold = AUTO_SCROLL_THRESHOLD,
): boolean {
  const distFromBottom = scrollHeight - scrollTop - clientHeight
  return distFromBottom < threshold
}

/**
 * Find the index of a timeline row by its ID.
 * Returns -1 if not found.
 */
export function findRowIndex(rows: TimelineRow[], id: string): number {
  return rows.findIndex((r) => r.id === id)
}

/**
 * Compute the set of matching row IDs for search highlighting.
 * Returns null when search is inactive (no IDs to highlight).
 */
export function computeMatchIdSet(searchMatchIds: string[] | undefined): Set<string> | null {
  if (!searchMatchIds || searchMatchIds.length === 0) return null
  return new Set(searchMatchIds)
}

/**
 * Determine whether a row should show match highlighting.
 */
export function getRowHighlightState(
  rowId: string,
  matchIdSet: Set<string> | null,
  activeMatchId: string | null | undefined,
): { isMatch: boolean; isActive: boolean } {
  const isMatch = matchIdSet?.has(rowId) ?? false
  const isActive = rowId === activeMatchId
  return { isMatch, isActive }
}
