import { useState, useCallback, useMemo } from 'react'
import type { TimelineRow } from '@/lib/timeline'

interface MessageSearchResult {
  /** Current search query */
  query: string
  /** Whether the search bar is visible */
  isOpen: boolean
  /** IDs of timeline rows that match the query */
  matchIds: string[]
  /** Index of the currently focused match (0-based) */
  activeIndex: number
  /** ID of the currently focused match row */
  activeMatchId: string | null
  /** Total number of matches */
  matchCount: number
  /** Open the search bar */
  open: () => void
  /** Close the search bar and reset state */
  close: () => void
  /** Update the search query */
  setQuery: (query: string) => void
  /** Navigate to the next match */
  goToNext: () => void
  /** Navigate to the previous match */
  goToPrevious: () => void
}

/** Extract searchable text from a timeline row. */
const getRowText = (row: TimelineRow): string => {
  switch (row.kind) {
    case 'user-message':
      return row.content
    case 'assistant-text':
      return row.content
    case 'system-message':
      return row.content
    default:
      return ''
  }
}

/** Hook for searching through timeline rows in a chat thread. */
export const useMessageSearch = (rows: TimelineRow[]): MessageSearchResult => {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQueryState] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const matchIds = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    if (!trimmed) return []
    return rows
      .filter((row) => getRowText(row).toLowerCase().includes(trimmed))
      .map((row) => row.id)
  }, [rows, query])

  const matchCount = matchIds.length
  const clampedIndex = matchCount > 0 ? activeIndex % matchCount : 0
  const activeMatchId = matchCount > 0 ? matchIds[clampedIndex] : null

  const open = useCallback(() => setIsOpen(true), [])

  const close = useCallback(() => {
    setIsOpen(false)
    setQueryState('')
    setActiveIndex(0)
  }, [])

  const setQuery = useCallback((value: string) => {
    setQueryState(value)
    setActiveIndex(0)
  }, [])

  const goToNext = useCallback(() => {
    setActiveIndex((prev) => (matchCount > 0 ? (prev + 1) % matchCount : 0))
  }, [matchCount])

  const goToPrevious = useCallback(() => {
    setActiveIndex((prev) => (matchCount > 0 ? (prev - 1 + matchCount) % matchCount : 0))
  }, [matchCount])

  return {
    query,
    isOpen,
    matchIds,
    activeIndex: clampedIndex,
    activeMatchId,
    matchCount,
    open,
    close,
    setQuery,
    goToNext,
    goToPrevious,
  }
}
