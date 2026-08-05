import { describe, it, expect } from 'vitest'
import { collapseToolCalls, deriveCollapseKey, getGroupCount, expandGroup } from './tool-call-collapsing'
import type { ToolCall } from '@/types'

const makeToolCall = (overrides: Partial<ToolCall> = {}): ToolCall => ({
  toolCallId: `tc-${Math.random().toString(36).slice(2)}`,
  title: 'Edit file',
  status: 'completed',
  ...overrides,
})

describe('deriveCollapseKey', () => {
  it('returns null for in_progress tool calls', () => {
    const tc = makeToolCall({ status: 'in_progress', kind: 'edit' })
    expect(deriveCollapseKey(tc)).toBeNull()
  })

  it('returns null for pending tool calls', () => {
    const tc = makeToolCall({ status: 'pending', kind: 'edit' })
    expect(deriveCollapseKey(tc)).toBeNull()
  })

  it('returns key based on kind and file path from locations', () => {
    const tc = makeToolCall({ kind: 'edit', locations: [{ path: 'src/foo.ts' }] })
    expect(deriveCollapseKey(tc)).toBe('edit:src/foo.ts')
  })

  it('returns key based on kind and file path from content', () => {
    const tc = makeToolCall({ kind: 'edit', content: [{ type: 'content', path: 'src/bar.ts' }] })
    expect(deriveCollapseKey(tc)).toBe('edit:src/bar.ts')
  })

  it('returns key based on kind and title when no file path', () => {
    const tc = makeToolCall({ kind: 'read', title: 'Read directory' })
    expect(deriveCollapseKey(tc)).toBe('read:read directory')
  })

  it('normalizes trailing "completed" in title', () => {
    const tc = makeToolCall({ kind: 'edit', title: 'Edit file completed' })
    expect(deriveCollapseKey(tc)).toBe('edit:edit file')
  })

  it('returns null when no kind and no title', () => {
    const tc = makeToolCall({ kind: undefined, title: '' })
    expect(deriveCollapseKey(tc)).toBeNull()
  })
})

describe('collapseToolCalls', () => {
  it('returns empty array for empty input', () => {
    expect(collapseToolCalls([])).toEqual([])
  })

  it('does not collapse in_progress tool calls', () => {
    const calls = [
      makeToolCall({ status: 'in_progress', kind: 'edit', locations: [{ path: 'src/a.ts' }] }),
      makeToolCall({ status: 'in_progress', kind: 'edit', locations: [{ path: 'src/a.ts' }] }),
    ]
    const groups = collapseToolCalls(calls)
    expect(groups.length).toBe(2)
  })

  it('collapses consecutive completed calls with same key', () => {
    const calls = [
      makeToolCall({ kind: 'edit', locations: [{ path: 'src/foo.ts' }] }),
      makeToolCall({ kind: 'edit', locations: [{ path: 'src/foo.ts' }] }),
      makeToolCall({ kind: 'edit', locations: [{ path: 'src/foo.ts' }] }),
    ]
    const groups = collapseToolCalls(calls)
    expect(groups.length).toBe(1)
    expect(groups[0].calls.length).toBe(3)
    expect(groups[0].representative).toBe(calls[2]) // latest
  })

  it('does not collapse non-adjacent calls with same key', () => {
    const calls = [
      makeToolCall({ kind: 'edit', locations: [{ path: 'src/foo.ts' }] }),
      makeToolCall({ kind: 'read', locations: [{ path: 'src/bar.ts' }] }),
      makeToolCall({ kind: 'edit', locations: [{ path: 'src/foo.ts' }] }),
    ]
    const groups = collapseToolCalls(calls)
    expect(groups.length).toBe(3)
  })

  it('separates groups by different file paths', () => {
    const calls = [
      makeToolCall({ kind: 'edit', locations: [{ path: 'src/a.ts' }] }),
      makeToolCall({ kind: 'edit', locations: [{ path: 'src/a.ts' }] }),
      makeToolCall({ kind: 'edit', locations: [{ path: 'src/b.ts' }] }),
    ]
    const groups = collapseToolCalls(calls)
    expect(groups.length).toBe(2)
    expect(groups[0].calls.length).toBe(2)
    expect(groups[1].calls.length).toBe(1)
  })
})

describe('getGroupCount', () => {
  it('returns null for single-item group', () => {
    const group = { representative: makeToolCall(), calls: [makeToolCall()], key: 'k' }
    expect(getGroupCount(group)).toBeNull()
  })

  it('returns count for multi-item group', () => {
    const calls = [makeToolCall(), makeToolCall(), makeToolCall()]
    const group = { representative: calls[2], calls, key: 'k' }
    expect(getGroupCount(group)).toBe(3)
  })
})

describe('expandGroup', () => {
  it('returns all calls in the group', () => {
    const calls = [makeToolCall(), makeToolCall(), makeToolCall()]
    const group = { representative: calls[2], calls, key: 'k' }
    expect(expandGroup(group)).toBe(calls)
    expect(expandGroup(group).length).toBe(3)
  })

  it('returns single-item array for non-collapsed group', () => {
    const tc = makeToolCall()
    const group = { representative: tc, calls: [tc], key: 'k' }
    expect(expandGroup(group)).toEqual([tc])
  })
})

describe('collapseToolCalls — edge cases', () => {
  it('handles single tool call', () => {
    const calls = [makeToolCall({ kind: 'edit', locations: [{ path: 'src/a.ts' }] })]
    const groups = collapseToolCalls(calls)
    expect(groups.length).toBe(1)
    expect(groups[0].calls.length).toBe(1)
    expect(groups[0].representative).toBe(calls[0])
  })

  it('does not collapse failed tool calls with completed ones', () => {
    const calls = [
      makeToolCall({ kind: 'edit', status: 'completed', locations: [{ path: 'src/a.ts' }] }),
      makeToolCall({ kind: 'edit', status: 'failed', locations: [{ path: 'src/a.ts' }] }),
    ]
    const groups = collapseToolCalls(calls)
    // Both are collapsible (not in_progress/pending), same key → collapsed
    expect(groups.length).toBe(1)
    expect(groups[0].calls.length).toBe(2)
  })

  it('handles mixed pending and completed calls', () => {
    const calls = [
      makeToolCall({ kind: 'edit', status: 'completed', locations: [{ path: 'src/a.ts' }] }),
      makeToolCall({ kind: 'edit', status: 'pending', locations: [{ path: 'src/a.ts' }] }),
      makeToolCall({ kind: 'edit', status: 'completed', locations: [{ path: 'src/a.ts' }] }),
    ]
    const groups = collapseToolCalls(calls)
    // First completed is alone, pending is standalone, last completed is alone
    expect(groups.length).toBe(3)
  })

  it('collapses by title when no locations or content', () => {
    const calls = [
      makeToolCall({ kind: 'search', title: 'Search files' }),
      makeToolCall({ kind: 'search', title: 'Search files' }),
      makeToolCall({ kind: 'search', title: 'Search files' }),
    ]
    const groups = collapseToolCalls(calls)
    expect(groups.length).toBe(1)
    expect(groups[0].calls.length).toBe(3)
  })

  it('does not collapse different kinds even with same path', () => {
    const calls = [
      makeToolCall({ kind: 'edit', locations: [{ path: 'src/a.ts' }] }),
      makeToolCall({ kind: 'read', locations: [{ path: 'src/a.ts' }] }),
    ]
    const groups = collapseToolCalls(calls)
    expect(groups.length).toBe(2)
  })

  it('extracts path from content text when no locations', () => {
    const calls = [
      makeToolCall({ kind: 'edit', content: [{ type: 'content', text: 'Edited src/utils.ts' }] }),
      makeToolCall({ kind: 'edit', content: [{ type: 'content', text: 'Edited src/utils.ts again' }] }),
    ]
    const groups = collapseToolCalls(calls)
    expect(groups.length).toBe(1)
    expect(groups[0].key).toBe('edit:src/utils.ts')
  })

  it('handles tool calls with no kind and no title gracefully', () => {
    const calls = [
      makeToolCall({ kind: undefined, title: '', status: 'completed' }),
      makeToolCall({ kind: undefined, title: '', status: 'completed' }),
    ]
    const groups = collapseToolCalls(calls)
    // Both have null collapse key → standalone
    expect(groups.length).toBe(2)
  })

  it('preserves order within collapsed groups', () => {
    const calls = [
      makeToolCall({ toolCallId: 'tc-1', kind: 'edit', locations: [{ path: 'src/a.ts' }] }),
      makeToolCall({ toolCallId: 'tc-2', kind: 'edit', locations: [{ path: 'src/a.ts' }] }),
      makeToolCall({ toolCallId: 'tc-3', kind: 'edit', locations: [{ path: 'src/a.ts' }] }),
    ]
    const groups = collapseToolCalls(calls)
    expect(groups[0].calls[0].toolCallId).toBe('tc-1')
    expect(groups[0].calls[1].toolCallId).toBe('tc-2')
    expect(groups[0].calls[2].toolCallId).toBe('tc-3')
  })
})

describe('deriveCollapseKey — path extraction', () => {
  it('prefers locations over content for path', () => {
    const tc = makeToolCall({
      kind: 'edit',
      locations: [{ path: 'from/locations.ts' }],
      content: [{ type: 'content', text: 'Edited from/content.ts' }],
    })
    expect(deriveCollapseKey(tc)).toBe('edit:from/locations.ts')
  })

  it('uses content path field over text matching', () => {
    const tc = makeToolCall({
      kind: 'edit',
      content: [{ type: 'diff', path: 'explicit/path.ts', text: 'some other/file.ts' }],
    })
    expect(deriveCollapseKey(tc)).toBe('edit:explicit/path.ts')
  })

  it('handles content with no extractable path', () => {
    const tc = makeToolCall({
      kind: 'think',
      title: 'Thinking about the problem',
      content: [{ type: 'content', text: 'Let me think about this...' }],
    })
    // No file path found, falls back to kind:title
    expect(deriveCollapseKey(tc)).toBe('think:thinking about the problem')
  })
})
