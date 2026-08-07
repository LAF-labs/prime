import { describe, it, expect } from 'vitest'
import {
  buildSnippet,
  formatMessageTimestamp,
  isSearchableQuery,
  MESSAGE_SEARCH_MIN_QUERY,
} from './message-search'

describe('isSearchableQuery', () => {
  it('rejects queries shorter than the minimum', () => {
    expect(isSearchableQuery('')).toBe(false)
    expect(isSearchableQuery('a')).toBe(false)
    expect(isSearchableQuery('   a   ')).toBe(false)
  })

  it('accepts queries at or above the minimum after trimming', () => {
    expect(isSearchableQuery('ab')).toBe(true)
    expect(isSearchableQuery('  ab  ')).toBe(true)
    expect(MESSAGE_SEARCH_MIN_QUERY).toBe(2)
  })
})

describe('buildSnippet', () => {
  it('splits the content around the first case-insensitive match', () => {
    const snippet = buildSnippet('Please refactor the Login page tomorrow', 'login')
    expect(snippet.match).toBe('Login')
    expect(snippet.before.endsWith('the ')).toBe(true)
    expect(snippet.after.startsWith(' page')).toBe(true)
  })

  it('collapses whitespace so multi-line messages read as one line', () => {
    const snippet = buildSnippet('line one\n\n  line two with token here', 'token')
    expect(snippet.before).not.toContain('\n')
    expect(snippet.match).toBe('token')
  })

  it('adds leading and trailing ellipses when truncated', () => {
    const long = `${'x'.repeat(100)} needle ${'y'.repeat(100)}`
    const snippet = buildSnippet(long, 'needle', 20)
    expect(snippet.before.startsWith('…')).toBe(true)
    expect(snippet.after.endsWith('…')).toBe(true)
    expect(snippet.match).toBe('needle')
  })

  it('matches the earliest of multiple query tokens', () => {
    const snippet = buildSnippet('alpha comes before beta here', 'beta alpha')
    expect(snippet.match).toBe('alpha')
  })

  it('falls back to a plain leading excerpt when nothing matches', () => {
    const snippet = buildSnippet('completely unrelated content that goes on for a while and needs truncation somewhere', 'zzz', 10)
    expect(snippet.match).toBe('')
    expect(snippet.after).toBe('')
    expect(snippet.before.length).toBeGreaterThan(0)
    expect(snippet.before.endsWith('…')).toBe(true)
  })

  it('handles a match at the very start of the content', () => {
    const snippet = buildSnippet('needle in a haystack', 'needle')
    expect(snippet.before).toBe('')
    expect(snippet.match).toBe('needle')
  })
})

describe('formatMessageTimestamp', () => {
  const now = new Date('2026-08-07T12:00:00Z').getTime()

  it('formats minutes, hours, and days', () => {
    expect(formatMessageTimestamp('2026-08-07T11:55:00Z', now)).toBe('5m ago')
    expect(formatMessageTimestamp('2026-08-07T09:00:00Z', now)).toBe('3h ago')
    expect(formatMessageTimestamp('2026-08-04T12:00:00Z', now)).toBe('3d ago')
  })

  it('never reports zero minutes', () => {
    expect(formatMessageTimestamp('2026-08-07T11:59:59Z', now)).toBe('1m ago')
  })

  it('returns an empty string for garbage input', () => {
    expect(formatMessageTimestamp('not-a-date', now)).toBe('')
  })

  it('falls back to a locale date for old or future timestamps', () => {
    expect(formatMessageTimestamp('2026-01-01T00:00:00Z', now)).not.toContain('ago')
    expect(formatMessageTimestamp('2026-09-01T00:00:00Z', now)).not.toContain('ago')
  })
})
