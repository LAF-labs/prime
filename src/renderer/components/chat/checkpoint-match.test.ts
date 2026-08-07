import { describe, it, expect } from 'vitest'
import { findRevertCheckpoint } from './checkpoint-match'

// Checkpoints are keyed by the message count at send time — i.e. the index the
// user message landed at. A thread `[user@0, asst@1, user@2, asst@3]` therefore
// has checkpoints at turns 0 and 2.

describe('findRevertCheckpoint', () => {
  const checkpoints = [{ turn: 0 }, { turn: 2 }, { turn: 4 }]

  it('picks the checkpoint taken at the start of the following turn', () => {
    // Rolling back to the assistant message at index 1 keeps that turn;
    // the state "as this turn left it" is the turn-2 checkpoint.
    expect(findRevertCheckpoint(checkpoints, 1)).toEqual({ turn: 2 })
  })

  it('picks the earliest later checkpoint, not just any later one', () => {
    expect(findRevertCheckpoint([{ turn: 4 }, { turn: 2 }], 1)).toEqual({ turn: 2 })
  })

  it('returns null on the last turn (no later checkpoint exists)', () => {
    expect(findRevertCheckpoint(checkpoints, 5)).toBeNull()
  })

  it('never matches the checkpoint keyed at the assistant index itself', () => {
    // turn === index would be the snapshot from BEFORE the turn ran.
    expect(findRevertCheckpoint([{ turn: 3 }], 3)).toBeNull()
  })

  it('returns null for an empty list', () => {
    expect(findRevertCheckpoint([], 1)).toBeNull()
  })
})
