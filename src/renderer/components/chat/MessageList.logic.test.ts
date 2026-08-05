import { describe, it, expect } from 'vitest'
import {
  AUTO_SCROLL_THRESHOLD,
  ROW_HEIGHT_ESTIMATES,
  isNearBottom,
  findRowIndex,
  computeMatchIdSet,
  getRowHighlightState,
} from './MessageList.logic'
import type { TimelineRow } from '@/lib/timeline'

describe('AUTO_SCROLL_THRESHOLD', () => {
  it('is a positive number', () => {
    expect(AUTO_SCROLL_THRESHOLD).toBeGreaterThan(0)
  })
})

describe('ROW_HEIGHT_ESTIMATES', () => {
  it('has estimates for all known row kinds', () => {
    expect(ROW_HEIGHT_ESTIMATES['user-message']).toBeGreaterThan(0)
    expect(ROW_HEIGHT_ESTIMATES['system-message']).toBeGreaterThan(0)
    expect(ROW_HEIGHT_ESTIMATES['assistant-text']).toBeGreaterThan(0)
    expect(ROW_HEIGHT_ESTIMATES['work']).toBeGreaterThan(0)
    expect(ROW_HEIGHT_ESTIMATES['working']).toBeGreaterThan(0)
    expect(ROW_HEIGHT_ESTIMATES['changed-files']).toBeGreaterThan(0)
  })
})

describe('isNearBottom', () => {
  it('returns true when at the bottom', () => {
    // scrollHeight=1000, scrollTop=900, clientHeight=100 → distance=0
    expect(isNearBottom(1000, 900, 100)).toBe(true)
  })

  it('returns true when within threshold', () => {
    // scrollHeight=1000, scrollTop=800, clientHeight=100 → distance=100 < 150
    expect(isNearBottom(1000, 800, 100)).toBe(true)
  })

  it('returns false when far from bottom', () => {
    // scrollHeight=1000, scrollTop=200, clientHeight=100 → distance=700 > 150
    expect(isNearBottom(1000, 200, 100)).toBe(false)
  })

  it('returns true when exactly at threshold', () => {
    // scrollHeight=1000, scrollTop=750, clientHeight=100 → distance=150
    // 150 < 150 is false, so this should be false
    expect(isNearBottom(1000, 750, 100)).toBe(false)
  })

  it('respects custom threshold', () => {
    // distance=200, custom threshold=250
    expect(isNearBottom(1000, 700, 100, 250)).toBe(true)
    // distance=200, custom threshold=100
    expect(isNearBottom(1000, 700, 100, 100)).toBe(false)
  })

  it('handles zero scroll height', () => {
    expect(isNearBottom(0, 0, 0)).toBe(true)
  })
})

describe('findRowIndex', () => {
  const rows: TimelineRow[] = [
    { kind: 'user-message', id: 'msg-0-user', content: 'hello', timestamp: '2024-01-01' },
    { kind: 'assistant-text', id: 'msg-1-text', content: 'hi', timestamp: '2024-01-01' },
    { kind: 'working', id: 'working', hasStreamingContent: false },
  ]

  it('finds existing row by id', () => {
    expect(findRowIndex(rows, 'msg-1-text')).toBe(1)
  })

  it('returns -1 for non-existent id', () => {
    expect(findRowIndex(rows, 'non-existent')).toBe(-1)
  })

  it('returns 0 for first row', () => {
    expect(findRowIndex(rows, 'msg-0-user')).toBe(0)
  })

  it('handles empty array', () => {
    expect(findRowIndex([], 'any')).toBe(-1)
  })
})

describe('computeMatchIdSet', () => {
  it('returns null for undefined', () => {
    expect(computeMatchIdSet(undefined)).toBeNull()
  })

  it('returns null for empty array', () => {
    expect(computeMatchIdSet([])).toBeNull()
  })

  it('returns Set with provided IDs', () => {
    const set = computeMatchIdSet(['a', 'b', 'c'])
    expect(set).toBeInstanceOf(Set)
    expect(set!.size).toBe(3)
    expect(set!.has('a')).toBe(true)
    expect(set!.has('b')).toBe(true)
    expect(set!.has('c')).toBe(true)
  })

  it('deduplicates IDs', () => {
    const set = computeMatchIdSet(['a', 'a', 'b'])
    expect(set!.size).toBe(2)
  })
})

describe('getRowHighlightState', () => {
  it('returns no highlight when matchIdSet is null', () => {
    const result = getRowHighlightState('row-1', null, null)
    expect(result).toEqual({ isMatch: false, isActive: false })
  })

  it('returns isMatch true when row is in match set', () => {
    const set = new Set(['row-1', 'row-2'])
    const result = getRowHighlightState('row-1', set, null)
    expect(result).toEqual({ isMatch: true, isActive: false })
  })

  it('returns isActive true when row is the active match', () => {
    const set = new Set(['row-1', 'row-2'])
    const result = getRowHighlightState('row-1', set, 'row-1')
    expect(result).toEqual({ isMatch: true, isActive: true })
  })

  it('returns isActive true even without matchIdSet', () => {
    // Edge case: activeMatchId set but no matchIdSet
    const result = getRowHighlightState('row-1', null, 'row-1')
    expect(result).toEqual({ isMatch: false, isActive: true })
  })

  it('returns both false for non-matching row', () => {
    const set = new Set(['row-1', 'row-2'])
    const result = getRowHighlightState('row-3', set, 'row-1')
    expect(result).toEqual({ isMatch: false, isActive: false })
  })
})
