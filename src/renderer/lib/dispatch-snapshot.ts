/**
 * Local Dispatch Snapshots — Optimistic UI acknowledgment tracking.
 *
 * When the user sends a message, we capture a snapshot of the current task
 * state. We then compare incoming state updates against this snapshot to
 * detect when the backend has actually acknowledged and started processing
 * the request.
 *
 * This eliminates the "dead zone" between sending a message and seeing the
 * first streaming token, giving the user clear feedback:
 *   "Sending..." → "Waiting for agent..." → "Agent thinking..." → streaming
 */

import type { AgentTask } from '@/types'

// ── Types ─────────────────────────────────────────────────────────

export interface LocalDispatchSnapshot {
  /** When the dispatch was initiated */
  readonly startedAt: number
  /** Task status at time of dispatch */
  readonly taskStatus: AgentTask['status']
  /** Message count at time of dispatch */
  readonly messageCount: number
  /** Whether streaming was active at dispatch time */
  readonly wasStreaming: boolean
  /** The task ID this dispatch targets */
  readonly taskId: string
}

export type DispatchPhase =
  | 'idle'           // No pending dispatch
  | 'sending'        // Message sent, waiting for backend ack
  | 'acknowledged'   // Backend received it (status changed to running)
  | 'streaming'      // First token arrived
  | 'stale'          // Dispatch took too long, likely stuck

/** How long before a dispatch is considered stale (ms) */
const STALE_THRESHOLD_MS = 30_000

// ── Snapshot creation ─────────────────────────────────────────────

/**
 * Capture a snapshot of the current task state at the moment of dispatch.
 */
export function createDispatchSnapshot(
  task: AgentTask,
  streamingChunk: string,
): LocalDispatchSnapshot {
  return {
    startedAt: Date.now(),
    taskStatus: task.status,
    messageCount: task.messages.length,
    wasStreaming: streamingChunk.length > 0,
    taskId: task.id,
  }
}

// ── Phase derivation ──────────────────────────────────────────────

/**
 * Derive the current dispatch phase by comparing the snapshot against
 * the current task state.
 *
 * Order of checks matters:
 *   1. New streaming chunk after dispatch → `streaming`
 *   2. Trailing message is the *assistant* and there are more messages
 *      than at dispatch → `streaming`. We deliberately ignore the user
 *      message we just appended (which would otherwise spuriously
 *      flip the phase to `streaming` on every continuation send).
 *   3. Task moved into `running` after dispatch → `acknowledged`
 *   4. STALE_THRESHOLD_MS elapsed → `stale`
 *   5. Otherwise → `sending`
 */
export function deriveDispatchPhase(
  snapshot: LocalDispatchSnapshot | null,
  task: AgentTask | null | undefined,
  streamingChunk: string,
): DispatchPhase {
  if (!snapshot || !task) return 'idle'
  if (snapshot.taskId !== task.id) return 'idle'

  // If we're streaming new content, the dispatch is fully acknowledged.
  if (streamingChunk.length > 0 && !snapshot.wasStreaming) {
    return 'streaming'
  }

  // Compare assistant message counts so the user message we appended
  // pre-send doesn't trip the "new messages → streaming" check.
  const lastMessage = task.messages[task.messages.length - 1]
  const assistantArrivedAfterDispatch =
    task.messages.length > snapshot.messageCount && lastMessage?.role === 'assistant'
  if (assistantArrivedAfterDispatch) {
    return 'streaming'
  }

  // Task transitioned into running after dispatch — backend has the message.
  if (task.status === 'running' && snapshot.taskStatus !== 'running') {
    return 'acknowledged'
  }

  // Watchdog: surface a "taking longer than expected" hint.
  const elapsed = Date.now() - snapshot.startedAt
  if (elapsed > STALE_THRESHOLD_MS) {
    return 'stale'
  }

  return 'sending'
}

/**
 * Check if the dispatch has been fully acknowledged (safe to clear snapshot).
 */
export function isDispatchComplete(phase: DispatchPhase): boolean {
  return phase === 'streaming' || phase === 'idle'
}

/**
 * Get a human-readable status label for the current dispatch phase.
 */
export function getDispatchPhaseLabel(phase: DispatchPhase): string | null {
  switch (phase) {
    case 'idle': return null
    case 'sending': return 'Sending…'
    case 'acknowledged': return 'Agent starting…'
    case 'streaming': return null // streaming indicator handles this
    case 'stale': return 'Taking longer than expected…'
  }
}
