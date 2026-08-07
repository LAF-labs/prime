/**
 * Which window is responsible for counting a turn.
 *
 * Agent events are broadcast to every window, so each one runs the same
 * turn-end handler. That is right for rendering — both windows should show the
 * answer — and wrong for anything that accumulates: with two windows open,
 * every turn was recorded twice, so message counts, diff stats and the token
 * spend behind the cost chart were all doubled.
 *
 * The window that sent the message claims the turn; the others skip the
 * counting and just render. Claims are per-window because this module lives in
 * the renderer, which is exactly the scope we want.
 */
const claimed = new Set<string>()

// Threads this window has EVER dispatched. Unlike `claimed` (consumed at
// turn_end), this survives the turn — it scopes which streaming-snapshot
// entries this window may write or clear. An idle second window used to
// persist an empty snapshot map over the streaming window's in-flight
// partial; ownership scoping is what stops that.
const dispatchedHere = new Set<string>()

/** Called by whichever window dispatched the message. */
export const claimTurn = (taskId: string): void => {
  claimed.add(taskId)
  dispatchedHere.add(taskId)
}

/** Threads whose streaming snapshots this window owns. */
export const snapshotOwnedIds = (): ReadonlySet<string> => dispatchedHere

/**
 * Whether this window started the turn that just ended.
 *
 * Releases the claim as it answers, so the next turn has to be claimed again
 * — a window that merely watched a thread never starts counting it.
 */
export const consumeTurnClaim = (taskId: string): boolean => claimed.delete(taskId)

/** Drop a claim without counting it — for a send that never became a turn. */
export const releaseTurn = (taskId: string): void => {
  claimed.delete(taskId)
}

/**
 * Move a claim to the id the backend assigned.
 *
 * A thread is dispatched under a local id and can come back with a different
 * one; without this the claim would be stranded and the turn uncounted.
 */
export const rekeyTurnClaim = (fromTaskId: string, toTaskId: string): void => {
  if (claimed.delete(fromTaskId)) claimed.add(toTaskId)
  if (dispatchedHere.delete(fromTaskId)) dispatchedHere.add(toTaskId)
}
