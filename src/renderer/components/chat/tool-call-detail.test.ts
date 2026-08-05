import { describe, it, expect } from 'vitest'
import { getToolDetail, formatToolDuration } from './tool-call-detail'
import type { ToolCall } from '@/types'

const mk = (overrides: Partial<ToolCall> = {}): ToolCall => ({
  toolCallId: 'tc',
  title: 'Tool',
  status: 'completed',
  ...overrides,
})

describe('getToolDetail', () => {
  describe('read tools', () => {
    it('extracts file name from locations', () => {
      const tc = mk({ kind: 'read', title: 'Read file', locations: [{ path: '/src/utils/helpers.ts' }] })
      expect(getToolDetail(tc).preview).toBe('helpers.ts')
    })

    it('extracts file name from rawInput path', () => {
      const tc = mk({ kind: 'read', title: 'Read file', rawInput: { path: '/project/README.md' } })
      expect(getToolDetail(tc).preview).toBe('README.md')
    })

    it('returns null if title already contains the file name', () => {
      const tc = mk({ kind: 'read', title: 'Read helpers.ts', locations: [{ path: '/src/helpers.ts' }] })
      expect(getToolDetail(tc).preview).toBeNull()
    })

    it('returns null if no path available', () => {
      const tc = mk({ kind: 'read', title: 'Read file' })
      expect(getToolDetail(tc).preview).toBeNull()
    })
  })

  describe('edit tools', () => {
    it('extracts file name from locations', () => {
      const tc = mk({ kind: 'edit', title: 'Edit file', locations: [{ path: '/src/App.tsx' }] })
      expect(getToolDetail(tc).preview).toBe('App.tsx')
    })

    it('returns null if title already contains the file name', () => {
      const tc = mk({ kind: 'edit', title: 'Edit App.tsx', locations: [{ path: '/src/App.tsx' }] })
      expect(getToolDetail(tc).preview).toBeNull()
    })
  })

  describe('search tools', () => {
    it('extracts query from rawInput', () => {
      const tc = mk({ kind: 'search', title: 'Search', rawInput: { query: 'useState' } })
      expect(getToolDetail(tc).preview).toBe('"useState"')
    })

    it('extracts result count from rawOutput', () => {
      const tc = mk({
        kind: 'search', title: 'Search',
        rawInput: { query: 'foo' },
        rawOutput: { totalFiles: 12, truncated: false },
      })
      expect(getToolDetail(tc).preview).toBe('"foo" · 12 results')
    })

    it('shows truncated indicator', () => {
      const tc = mk({
        kind: 'search', title: 'Search',
        rawInput: { query: 'bar' },
        rawOutput: { totalFiles: 50, truncated: true },
      })
      expect(getToolDetail(tc).preview).toBe('"bar" · 50+ results')
    })

    it('counts results array', () => {
      const tc = mk({
        kind: 'search', title: 'Search',
        rawInput: { query: 'x' },
        rawOutput: { results: [1, 2, 3] },
      })
      expect(getToolDetail(tc).preview).toBe('"x" · 3 results')
    })

    it('singular result', () => {
      const tc = mk({
        kind: 'search', title: 'Search',
        rawInput: { query: 'y' },
        rawOutput: { results: [1] },
      })
      expect(getToolDetail(tc).preview).toBe('"y" · 1 result')
    })
  })

  describe('execute tools', () => {
    it('extracts command from rawInput', () => {
      const tc = mk({ kind: 'execute', title: 'Run command', rawInput: { command: 'npm run build' } })
      expect(getToolDetail(tc).preview).toBe('npm run build')
    })

    it('truncates long commands', () => {
      const long = 'a'.repeat(100)
      const tc = mk({ kind: 'execute', title: 'Run command', rawInput: { command: long } })
      expect(getToolDetail(tc).preview!.length).toBeLessThanOrEqual(60)
      expect(getToolDetail(tc).preview!.endsWith('…')).toBe(true)
    })

    it('returns null if no command', () => {
      const tc = mk({ kind: 'execute', title: 'Run command' })
      expect(getToolDetail(tc).preview).toBeNull()
    })
  })

  describe('fetch tools', () => {
    it('returns null preview (handled by fetch-display)', () => {
      const tc = mk({ kind: 'fetch', title: 'Fetch', rawInput: { url: 'https://example.com' } })
      expect(getToolDetail(tc).preview).toBeNull()
    })
  })

  describe('generic/other tools', () => {
    it('extracts path from locations', () => {
      const tc = mk({ kind: 'other', title: 'Do thing', locations: [{ path: '/src/foo.ts' }] })
      expect(getToolDetail(tc).preview).toBe('foo.ts')
    })

    it('extracts first line from output content', () => {
      const tc = mk({ kind: 'other', title: 'Do thing', rawOutput: { content: 'Success: 3 items processed' } })
      expect(getToolDetail(tc).preview).toBe('Success: 3 items processed')
    })

    it('truncates long output content', () => {
      const tc = mk({ kind: 'other', title: 'Do thing', rawOutput: { content: 'x'.repeat(100) } })
      expect(getToolDetail(tc).preview!.length).toBeLessThanOrEqual(60)
    })
  })

  describe('duration', () => {
    it('computes duration from timestamps', () => {
      const tc = mk({
        kind: 'read', title: 'Read',
        createdAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:00:02.500Z',
      })
      expect(getToolDetail(tc).durationMs).toBe(2500)
    })

    it('returns null when timestamps missing', () => {
      const tc = mk({ kind: 'read', title: 'Read' })
      expect(getToolDetail(tc).durationMs).toBeNull()
    })
  })
})

describe('formatToolDuration', () => {
  it('formats sub-second', () => {
    expect(formatToolDuration(150)).toBe('150ms')
  })

  it('formats seconds', () => {
    expect(formatToolDuration(2500)).toBe('2.5s')
  })

  it('formats minutes', () => {
    expect(formatToolDuration(90_000)).toBe('1m 30s')
  })

  it('handles edge cases', () => {
    expect(formatToolDuration(-1)).toBe('')
    expect(formatToolDuration(Infinity)).toBe('')
  })
})
