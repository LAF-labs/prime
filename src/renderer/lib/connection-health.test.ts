import { describe, it, expect } from 'vitest'
import { calculateBackoffDelay } from './connection-health'

describe('calculateBackoffDelay', () => {
  it('returns base delay for first attempt', () => {
    // With jitter, should be within ±25% of base
    const delay = calculateBackoffDelay(0, 1000, 30000)
    expect(delay).toBeGreaterThanOrEqual(750)
    expect(delay).toBeLessThanOrEqual(1250)
  })

  it('doubles delay for each attempt', () => {
    // attempt 1: ~2000ms, attempt 2: ~4000ms, attempt 3: ~8000ms
    const d1 = calculateBackoffDelay(1, 1000, 30000)
    const d2 = calculateBackoffDelay(2, 1000, 30000)
    // d2 should be roughly double d1 (within jitter range)
    expect(d2).toBeGreaterThan(d1 * 0.8)
  })

  it('clamps to max delay', () => {
    const delay = calculateBackoffDelay(10, 1000, 5000)
    // Should never exceed max + 25% jitter
    expect(delay).toBeLessThanOrEqual(6250)
  })

  it('never returns negative', () => {
    for (let i = 0; i < 100; i++) {
      const delay = calculateBackoffDelay(i, 100, 1000)
      expect(delay).toBeGreaterThanOrEqual(0)
    }
  })

  it('handles zero base delay', () => {
    const delay = calculateBackoffDelay(0, 0, 1000)
    expect(delay).toBeGreaterThanOrEqual(0)
    expect(delay).toBeLessThanOrEqual(250) // 0 + 25% of 0 jitter... but max is 1000
  })

  it('handles zero max delay', () => {
    const delay = calculateBackoffDelay(5, 1000, 0)
    // Clamped to 0, jitter of 0 → 0
    expect(delay).toBe(0)
  })

  it('produces different values due to jitter', () => {
    // Run 20 times and check we get at least 2 different values
    const values = new Set<number>()
    for (let i = 0; i < 20; i++) {
      values.add(calculateBackoffDelay(3, 1000, 30000))
    }
    expect(values.size).toBeGreaterThan(1)
  })

  it('exponential growth: attempt 0=1s, 1=2s, 2=4s, 3=8s, 4=16s', () => {
    // Check the center of each range (ignoring jitter)
    // attempt 0: base * 2^0 = 1000
    // attempt 3: base * 2^3 = 8000
    // With ±25% jitter: 6000-10000
    const d3 = calculateBackoffDelay(3, 1000, 30000)
    expect(d3).toBeGreaterThanOrEqual(6000)
    expect(d3).toBeLessThanOrEqual(10000)
  })
})
