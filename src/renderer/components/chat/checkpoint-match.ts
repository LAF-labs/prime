/**
 * Checkpoint ↔ message-index matching.
 *
 * Checkpoints are keyed by the task's message count at send time: ChatPanel
 * calls `ipc.checkpointCreate(taskId, task.messages.length)` right before
 * appending the user message, so a checkpoint's `turn` equals the index that
 * user message landed at, and its snapshot is HEAD as it stood *before* that
 * turn ran.
 */

export interface CheckpointRef {
  turn: number
}

/**
 * Find the checkpoint whose snapshot captures the workspace exactly as the
 * assistant turn at `assistantMessageIndex` left it.
 *
 * That is the checkpoint taken at the start of the *next* turn — the earliest
 * checkpoint keyed past this assistant message. Returns null when no later
 * checkpoint exists (this is the last turn, so no later turn changed files).
 */
export const findRevertCheckpoint = <T extends CheckpointRef>(
  checkpoints: readonly T[],
  assistantMessageIndex: number,
): T | null => {
  let best: T | null = null
  for (const cp of checkpoints) {
    if (cp.turn > assistantMessageIndex && (best === null || cp.turn < best.turn)) {
      best = cp
    }
  }
  return best
}
