import { describe, it, expect, beforeEach } from 'vitest'
import { claimTurn, consumeTurnClaim, releaseTurn, rekeyTurnClaim } from './turn-ownership'

// Claims are module state; drain anything a previous test left behind.
beforeEach(() => {
  for (const id of ['a', 'b', 'local', 'backend']) releaseTurn(id)
})

describe('turn ownership', () => {
  it('counts a turn only in the window that sent it', () => {
    claimTurn('a')
    expect(consumeTurnClaim('a')).toBe(true)
  })

  it('does not count a turn in a window that only watched', () => {
    // The other window receives the same broadcast turn_end. Without this,
    // every metric — including cost — was multiplied by the window count.
    expect(consumeTurnClaim('a')).toBe(false)
  })

  it('requires a fresh claim for each turn', () => {
    claimTurn('a')
    expect(consumeTurnClaim('a')).toBe(true)
    expect(consumeTurnClaim('a')).toBe(false)
  })

  it('keeps claims separate per thread', () => {
    claimTurn('a')
    expect(consumeTurnClaim('b')).toBe(false)
    expect(consumeTurnClaim('a')).toBe(true)
  })

  it('drops a claim when the send never became a turn', () => {
    claimTurn('a')
    releaseTurn('a')
    expect(consumeTurnClaim('a')).toBe(false)
  })

  it('follows a thread to its backend-assigned id', () => {
    // A thread is dispatched under a local id and comes back with another;
    // a stranded claim would leave the turn uncounted entirely.
    claimTurn('local')
    rekeyTurnClaim('local', 'backend')
    expect(consumeTurnClaim('local')).toBe(false)
    expect(consumeTurnClaim('backend')).toBe(true)
  })

  it('rekeying an unclaimed thread claims nothing', () => {
    rekeyTurnClaim('local', 'backend')
    expect(consumeTurnClaim('backend')).toBe(false)
  })
})
