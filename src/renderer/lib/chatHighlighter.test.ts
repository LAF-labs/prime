import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock @pierre/diffs so the test stays fast and deterministic — we only
// care about the scheduling/cleanup/fallback logic in chatHighlighter.ts here.
const getSharedHighlighterMock = vi.fn(async (..._args: unknown[]) => ({} as unknown))
vi.mock('@pierre/diffs', () => ({
  getSharedHighlighter: (...args: unknown[]) => getSharedHighlighterMock(...args),
}))

// lib.dom types `requestIdleCallback` as required on Window, but jsdom
// doesn't ship it and we want to test both branches. A record-style cast
// lets us assign and delete freely without fighting the DOM lib types.
function asMutable(): Record<string, unknown> {
  return window as unknown as Record<string, unknown>
}

/**
 * Re-import the module fresh so the per-language promise cache starts empty.
 * The cache lives at module scope so without this, success in one test would
 * shadow a configured failure in the next.
 */
async function loadFreshModule() {
  vi.resetModules()
  return await import('./chatHighlighter')
}

describe('preloadHighlighterIdle', () => {
  let originalRIC: unknown
  let originalCIC: unknown

  beforeEach(() => {
    const w = asMutable()
    originalRIC = w.requestIdleCallback
    originalCIC = w.cancelIdleCallback
    getSharedHighlighterMock.mockClear()
    getSharedHighlighterMock.mockImplementation(async () => ({} as unknown))
  })

  afterEach(() => {
    const w = asMutable()
    if (originalRIC !== undefined) w.requestIdleCallback = originalRIC
    else delete w.requestIdleCallback
    if (originalCIC !== undefined) w.cancelIdleCallback = originalCIC
    else delete w.cancelIdleCallback
    vi.useRealTimers()
  })

  it('schedules via requestIdleCallback and warms the cache for "text"', async () => {
    const { preloadHighlighterIdle } = await loadFreshModule()
    const w = asMutable()
    let scheduled: () => void = () => {}
    const ric = vi.fn((cb: () => void) => {
      scheduled = cb
      return 1
    })
    w.requestIdleCallback = ric
    w.cancelIdleCallback = vi.fn()

    preloadHighlighterIdle()
    expect(ric).toHaveBeenCalledTimes(1)
    expect(getSharedHighlighterMock).not.toHaveBeenCalled()

    scheduled()
    // Dynamic import() introduces a real microtask boundary; waitFor polls
    // until the mocked highlighter factory has been invoked.
    await vi.waitFor(() => {
      expect(getSharedHighlighterMock).toHaveBeenCalledTimes(1)
    })
  })

  it('falls back to setTimeout when requestIdleCallback is unavailable', async () => {
    // Load the module up-front (real timers), then switch to fake timers and
    // exercise the schedule path. This avoids leaking a fire-and-forget
    // dynamic import past the test's lifetime.
    const { preloadHighlighterIdle } = await loadFreshModule()
    vi.useFakeTimers()
    const w = asMutable()
    delete w.requestIdleCallback
    delete w.cancelIdleCallback

    preloadHighlighterIdle()
    expect(getSharedHighlighterMock).not.toHaveBeenCalled()
    vi.runAllTimers()
  })

  it('cleanup cancels a pending idle callback', async () => {
    const { preloadHighlighterIdle } = await loadFreshModule()
    const w = asMutable()
    const cancel = vi.fn()
    w.requestIdleCallback = vi.fn(() => 42)
    w.cancelIdleCallback = cancel

    const dispose = preloadHighlighterIdle()
    dispose()
    expect(cancel).toHaveBeenCalledWith(42)
  })

  it('cleanup cancels a pending setTimeout fallback', async () => {
    vi.useFakeTimers()
    const { preloadHighlighterIdle } = await loadFreshModule()
    const w = asMutable()
    delete w.requestIdleCallback
    delete w.cancelIdleCallback

    const dispose = preloadHighlighterIdle()
    dispose()
    vi.runAllTimers()
    expect(getSharedHighlighterMock).not.toHaveBeenCalled()
  })
})

describe('getHighlighterPromise', () => {
  beforeEach(() => {
    getSharedHighlighterMock.mockClear()
    getSharedHighlighterMock.mockImplementation(async () => ({} as unknown))
  })

  it('caches successful results so repeated calls share the same promise', async () => {
    const { getHighlighterPromise } = await loadFreshModule()
    const a = getHighlighterPromise('typescript')
    const b = getHighlighterPromise('typescript')
    expect(a).toBe(b)
    await a
    // Module-level cache means only one underlying call.
    expect(getSharedHighlighterMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to "text" when a shipped grammar fails to load', async () => {
    // A grammar this build ships, failing at load time — an unknown tag is
    // resolved to plain text before the loader now, so it cannot exercise
    // this path.
    getSharedHighlighterMock
      .mockImplementationOnce(async () => {
        throw new Error('grammar failed to load: python')
      })
      .mockImplementationOnce(async () => ({} as unknown))

    const { getHighlighterPromise } = await loadFreshModule()
    const result = await getHighlighterPromise('python')
    expect(result).toBeDefined()
    expect(getSharedHighlighterMock).toHaveBeenCalledTimes(2)

    // The second call should have requested 'text'.
    const secondCallArgs = getSharedHighlighterMock.mock.calls[1]?.[0] as
      | { langs?: string[] }
      | undefined
    expect(secondCallArgs?.langs).toEqual(['text'])
  })

  it('evicts a rejected promise so a later retry can succeed', async () => {
    // First call rejects, second call (retry) resolves.
    getSharedHighlighterMock
      .mockImplementationOnce(async () => {
        throw new Error('transient failure')
      })
      // The fallback retry for 'text' inside catch:
      .mockImplementationOnce(async () => {
        throw new Error('text also failed')
      })
      // Third call (a brand-new request) succeeds:
      .mockImplementationOnce(async () => ({} as unknown))

    const { getHighlighterPromise } = await loadFreshModule()

    await expect(getHighlighterPromise('python')).rejects.toBeInstanceOf(Error)

    // Bad promises must have been evicted; a new request actually retries.
    const ok = await getHighlighterPromise('python')
    expect(ok).toBeDefined()
    // 1) initial 'python' (rejects) → 2) 'text' fallback inside catch
    // (rejects) → 3) new 'python' attempt (resolves)
    expect(getSharedHighlighterMock).toHaveBeenCalledTimes(3)
  })

  it('never asks the loader for a grammar this build excluded', async () => {
    getSharedHighlighterMock.mockImplementation(async () => ({}) as unknown)
    const { getHighlighterPromise } = await loadFreshModule()

    await getHighlighterPromise('rust')

    // One call, for 'text' — not two (excluded grammar, then fallback).
    expect(getSharedHighlighterMock).toHaveBeenCalledTimes(1)
    const args = getSharedHighlighterMock.mock.calls[0]?.[0] as { langs?: string[] } | undefined
    expect(args?.langs).toEqual(['text'])
  })

  it('rethrows when the "text" fallback itself fails', async () => {
    getSharedHighlighterMock.mockImplementation(async () => {
      throw new Error('shiki cannot init')
    })
    const { getHighlighterPromise } = await loadFreshModule()
    await expect(getHighlighterPromise('text')).rejects.toThrow('shiki cannot init')
  })
})

// ── Grammar allowlist ─────────────────────────────────────────────

describe('normalizeLanguage', () => {
  // Same fresh-import helper the rest of this file uses; the mock above keeps
  // @pierre/diffs out of it even though these cases never reach the loader.
  let normalizeLanguage: (s: string) => string
  let BUNDLED_GRAMMARS: readonly string[]
  let PLAIN_TEXT: string

  beforeEach(async () => {
    const mod = await loadFreshModule()
    normalizeLanguage = mod.normalizeLanguage
    BUNDLED_GRAMMARS = mod.BUNDLED_GRAMMARS
    PLAIN_TEXT = mod.PLAIN_TEXT
  })

  it('keeps the grammars this build ships', () => {
    for (const lang of BUNDLED_GRAMMARS) {
      expect(normalizeLanguage(lang)).toBe(lang)
    }
  })

  it('resolves the fence tags people actually type', () => {
    expect(normalizeLanguage('js')).toBe('javascript')
    expect(normalizeLanguage('ts')).toBe('typescript')
    expect(normalizeLanguage('py')).toBe('python')
    expect(normalizeLanguage('bash')).toBe('shellscript')
    expect(normalizeLanguage('sh')).toBe('shellscript')
    expect(normalizeLanguage('zsh')).toBe('shellscript')
    expect(normalizeLanguage('md')).toBe('markdown')
    expect(normalizeLanguage('psql')).toBe('sql')
  })

  it('is case- and whitespace-insensitive, the way fences are written', () => {
    expect(normalizeLanguage('  Python  ')).toBe('python')
    expect(normalizeLanguage('JS')).toBe('javascript')
  })

  it('falls back to plain text for a grammar this build excluded', () => {
    // These are real shiki languages; the build stubs them out, so asking
    // for one must never reach the loader.
    for (const excluded of ['emacs-lisp', 'wolfram', 'cpp', 'rust', 'go', 'vue-vine']) {
      expect(normalizeLanguage(excluded)).toBe(PLAIN_TEXT)
    }
  })

  it('falls back to plain text for junk and empty tags', () => {
    expect(normalizeLanguage('')).toBe(PLAIN_TEXT)
    expect(normalizeLanguage('   ')).toBe(PLAIN_TEXT)
    expect(normalizeLanguage('not-a-language')).toBe(PLAIN_TEXT)
  })

  it('never returns a name outside the shipped set', () => {
    const shipped = new Set<string>([...BUNDLED_GRAMMARS, PLAIN_TEXT])
    for (const tag of ['js', 'ruby', 'HTML', 'jsonc', 'zsh', '', 'κόσμος']) {
      expect(shipped.has(normalizeLanguage(tag))).toBe(true)
    }
  })

  /**
   * The allowlist here and the stub list in vite.config.ts are one decision
   * split across two files; a mismatch ships a grammar nothing can request,
   * or stubs one the chat will ask for.
   */
  it('matches the grammar set the build keeps', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const config = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf-8')
    const block = /const KEEP = new Set\(\[([\s\S]*?)\]\)/.exec(config)
    expect(block, 'vite.config.ts should declare a KEEP set').toBeTruthy()
    const inBuild = [...block![1].matchAll(/"([\w.+-]+)"/g)].map((m) => m[1]).sort()
    expect(inBuild).toEqual([...BUNDLED_GRAMMARS].sort())
  })
})
