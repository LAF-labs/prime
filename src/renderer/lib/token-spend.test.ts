import { describe, it, expect } from 'vitest'
import { EMPTY_SNAPSHOT, snapshotOf, spendDelta, providerOf } from './token-spend'

const rate = { input: 2, output: 8, cacheRead: 0.2, cacheWrite: 2.5 }

describe('snapshotOf', () => {
  it('reads the cumulative counters', () => {
    const s = snapshotOf({ tokens: { input: 10, output: 5, cacheRead: 3, cacheWrite: 1 }, cost: 0.5 })
    expect(s).toEqual({ input: 10, output: 5, cacheRead: 3, cacheWrite: 1, cost: 0.5 })
  })

  it('treats missing stats as zero rather than throwing', () => {
    expect(snapshotOf(null)).toEqual(EMPTY_SNAPSHOT)
    expect(snapshotOf({})).toEqual(EMPTY_SNAPSHOT)
  })
})

describe('spendDelta', () => {
  it('counts only what the turn added', () => {
    const before = { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0 }
    const after = { input: 180, output: 70, cacheRead: 0, cacheWrite: 0, cost: 0 }
    expect(spendDelta(before, after, rate).tokens).toBe(100)
  })

  it("prefers the agent's own cost when it reports one", () => {
    const before = { ...EMPTY_SNAPSHOT, cost: 0.10 }
    const after = { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0.25 }
    // 0.15 reported, not 1000 * 2 / 1e6 = 0.002 from the rate table.
    expect(spendDelta(before, after, rate).cost).toBeCloseTo(0.15, 10)
  })

  it('prices from user rates when the agent reports no cost', () => {
    const after = { input: 1_000_000, output: 500_000, cacheRead: 0, cacheWrite: 0, cost: 0 }
    // 1M input at $2 + 0.5M output at $8 = 2 + 4
    expect(spendDelta(EMPTY_SNAPSHOT, after, rate).cost).toBeCloseTo(6, 10)
  })

  it('charges cache tiers at their own rates', () => {
    const after = { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 1_000_000, cost: 0 }
    expect(spendDelta(EMPTY_SNAPSHOT, after, rate).cost).toBeCloseTo(2.7, 10)
  })

  it('falls back to the input rate for cache tiers a provider does not price', () => {
    const flat = { input: 3, output: 9 }
    const after = { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 0, cost: 0 }
    // Counting them at zero would silently under-report.
    expect(spendDelta(EMPTY_SNAPSHOT, after, flat).cost).toBeCloseTo(3, 10)
  })

  it('reports tokens with no cost when nothing can price them', () => {
    const after = { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, cost: 0 }
    const d = spendDelta(EMPTY_SNAPSHOT, after)
    expect(d.tokens).toBe(1100)
    // A confident zero would read as "this was free".
    expect(d.cost).toBeUndefined()
  })

  it('treats a counter reset as a fresh session, not negative usage', () => {
    const before = { input: 9000, output: 4000, cacheRead: 0, cacheWrite: 0, cost: 1.5 }
    const after = { input: 120, output: 30, cacheRead: 0, cacheWrite: 0, cost: 0.02 }
    const d = spendDelta(before, after, rate)
    expect(d.tokens).toBe(150)
    expect(d.cost).toBeCloseTo(0.02, 10)
  })
})

describe('providerOf', () => {
  it('splits a composite id', () => {
    expect(providerOf('upstage/solar-pro2')).toBe('upstage')
  })

  it('returns nothing for a bare model id', () => {
    expect(providerOf('solar-pro2')).toBeUndefined()
    expect(providerOf(null)).toBeUndefined()
  })
})
