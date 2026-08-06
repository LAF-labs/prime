import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withTimeout, TimeoutError } from './with-timeout'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('withTimeout', () => {
  it('passes a value through when it arrives in time', async () => {
    const p = withTimeout(Promise.resolve('ok'), 1000)
    await expect(p).resolves.toBe('ok')
  })

  it('passes a rejection through unchanged', async () => {
    const boom = new Error('backend said no')
    const p = withTimeout(Promise.reject(boom), 1000)
    await expect(p).rejects.toBe(boom)
  })

  it('rejects when nothing ever settles', async () => {
    // The case that bricked onboarding: a call that neither resolves nor
    // rejects left the UI with no state to render.
    const p = withTimeout(new Promise<string>(() => {}), 500)
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError)
    await vi.advanceTimersByTimeAsync(500)
    await assertion
  })

  it('does not fire after the promise already settled', async () => {
    const p = withTimeout(Promise.resolve('early'), 100)
    await expect(p).resolves.toBe('early')
    // Nothing should be left scheduled to reject a settled promise.
    await vi.advanceTimersByTimeAsync(1000)
    expect(vi.getTimerCount()).toBe(0)
  })
})
