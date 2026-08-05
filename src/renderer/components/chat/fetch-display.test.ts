import { describe, it, expect } from 'vitest'
import {
  isFetchToolCall, extractUrl, shortenUrl,
  extractBytes, formatBytes, formatDuration, getFetchMeta,
} from './fetch-display'
import type { ToolCall } from '@/types'

const mk = (overrides: Partial<ToolCall> = {}): ToolCall => ({
  toolCallId: 'tc',
  title: 'fetch',
  status: 'completed',
  ...overrides,
})

describe('isFetchToolCall', () => {
  it('detects by kind=fetch', () => {
    expect(isFetchToolCall(mk({ kind: 'fetch' }))).toBe(true)
  })

  it('detects by "web fetch" in title', () => {
    expect(isFetchToolCall(mk({ title: 'Fetching web content' }))).toBe(true)
  })

  it('does not match when rawInput has a URL but kind is not fetch', () => {
    expect(isFetchToolCall(mk({ title: 'Run command', rawInput: { url: 'https://example.com' } }))).toBe(false)
  })

  it('does not match git fetch', () => {
    expect(isFetchToolCall(mk({ title: 'git fetch origin' }))).toBe(false)
  })

  it('does not match arbitrary tools', () => {
    expect(isFetchToolCall(mk({ title: 'Read file' }))).toBe(false)
  })
})

describe('extractUrl', () => {
  it('returns null for non-objects without URL strings', () => {
    expect(extractUrl(null)).toBeNull()
    expect(extractUrl(42)).toBeNull()
    expect(extractUrl('not a url')).toBeNull()
  })

  it('returns the string when it is itself a URL', () => {
    expect(extractUrl('https://example.com/x')).toBe('https://example.com/x')
  })

  it('reads url field', () => {
    expect(extractUrl({ url: 'https://example.com' })).toBe('https://example.com')
  })

  it('reads alternative url keys', () => {
    expect(extractUrl({ href: 'https://a.test' })).toBe('https://a.test')
    expect(extractUrl({ uri: 'https://b.test' })).toBe('https://b.test')
    expect(extractUrl({ targetUrl: 'https://c.test' })).toBe('https://c.test')
  })

  it('digs into arguments / params wrappers', () => {
    expect(extractUrl({ arguments: { url: 'https://x.test' } })).toBe('https://x.test')
    expect(extractUrl({ params: { href: 'https://y.test' } })).toBe('https://y.test')
  })

  it('ignores non-http strings', () => {
    expect(extractUrl({ url: 'file:///etc/passwd' })).toBeNull()
    expect(extractUrl({ url: 'javascript:alert(1)' })).toBeNull()
  })
})

describe('shortenUrl', () => {
  it('strips protocol and trailing slash', () => {
    expect(shortenUrl('https://example.com/')).toBe('example.com')
  })

  it('preserves the path', () => {
    expect(shortenUrl('https://docs.example.com/api/v1')).toBe('docs.example.com/api/v1')
  })

  it('truncates very long URLs', () => {
    const long = 'https://example.com/' + 'a'.repeat(100)
    const out = shortenUrl(long, 30)
    expect(out.length).toBeLessThanOrEqual(30)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('extractBytes', () => {
  it('reads explicit bytes/size fields', () => {
    expect(extractBytes({ bytes: 1024 })).toBe(1024)
    expect(extractBytes({ size: 11 })).toBe(11)
    expect(extractBytes({ contentLength: 42 })).toBe(42)
  })

  it('measures string body', () => {
    expect(extractBytes({ body: 'hello' })).toBe(5)
  })

  it('measures top-level string', () => {
    expect(extractBytes('abc')).toBe(3)
  })

  it('returns null for null input', () => {
    expect(extractBytes(null)).toBeNull()
  })

  it('falls back to JSON length for arbitrary objects', () => {
    const v = extractBytes({ foo: 'bar' })
    expect(v).toBeGreaterThan(0)
  })
})

describe('formatBytes', () => {
  it('formats common sizes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(11_469)).toBe('11.2 KB')
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB')
  })
})

describe('formatDuration', () => {
  it('formats sub-second as ms', () => {
    expect(formatDuration(500)).toBe('500ms')
  })

  it('formats sub-minute as seconds', () => {
    expect(formatDuration(1360)).toBe('1.36s')
    expect(formatDuration(12_400)).toBe('12.40s')
  })

  it('formats minutes as m s', () => {
    expect(formatDuration(63_000)).toBe('1m 03s')
  })
})

describe('getFetchMeta', () => {
  it('extracts url, bytes, and duration together', () => {
    const tc = mk({
      kind: 'fetch',
      rawInput: { url: 'https://example.com' },
      rawOutput: { body: 'x'.repeat(100) },
      createdAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:01.500Z',
    })
    const meta = getFetchMeta(tc)
    expect(meta.url).toBe('https://example.com')
    expect(meta.bytes).toBe(100)
    expect(meta.durationMs).toBe(1500)
  })

  it('returns null bytes when status is not completed', () => {
    const tc = mk({
      kind: 'fetch',
      status: 'in_progress',
      rawInput: { url: 'https://example.com' },
      rawOutput: { body: 'partial' },
    })
    expect(getFetchMeta(tc).bytes).toBeNull()
  })

  it('returns null duration when timestamps are missing', () => {
    const tc = mk({ kind: 'fetch', rawInput: { url: 'https://example.com' } })
    expect(getFetchMeta(tc).durationMs).toBeNull()
  })
})
