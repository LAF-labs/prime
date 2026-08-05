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

  it('falls back to "text" when the requested grammar fails to load', async () => {
    // First invocation (lang) rejects; second invocation (text) resolves.
    getSharedHighlighterMock
      .mockImplementationOnce(async () => {
        throw new Error('grammar not found: imaginarylang')
      })
      .mockImplementationOnce(async () => ({} as unknown))

    const { getHighlighterPromise } = await loadFreshModule()
    const result = await getHighlighterPromise('imaginarylang')
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

    await expect(getHighlighterPromise('rust')).rejects.toBeInstanceOf(Error)

    // Bad promises must have been evicted; a new request actually retries.
    const ok = await getHighlighterPromise('rust')
    expect(ok).toBeDefined()
    // 1) initial 'rust' (rejects) → 2) 'text' fallback inside catch (rejects)
    // → 3) new 'rust' attempt (resolves)
    expect(getSharedHighlighterMock).toHaveBeenCalledTimes(3)
  })

  it('rethrows when the "text" fallback itself fails', async () => {
    getSharedHighlighterMock.mockImplementation(async () => {
      throw new Error('shiki cannot init')
    })
    const { getHighlighterPromise } = await loadFreshModule()
    await expect(getHighlighterPromise('text')).rejects.toThrow('shiki cannot init')
  })
})
