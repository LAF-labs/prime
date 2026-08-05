/**
 * ChatPanel.logic.ts — Pure business logic extracted from ChatPanel.
 *
 * This file contains all derivation functions, state helpers, and pure
 * computations used by the ChatPanel component. Each function is independently
 * testable without React or DOM dependencies.
 */

import type { AgentTask, TaskMessage, ToolCall, ToolCallSplit } from '@/types'
import type { QueuedMessage } from '@/stores/task-store-types'
import {
  type LocalDispatchSnapshot,
  type DispatchPhase,
  createDispatchSnapshot,
  deriveDispatchPhase,
  getDispatchPhaseLabel,
} from '@/lib/dispatch-snapshot'

// ── Constants ─────────────────────────────────────────────────────

export const EMPTY_MESSAGES: TaskMessage[] = []
export const EMPTY_TOOL_CALLS: ToolCall[] = []
export const EMPTY_TOOL_SPLITS: ToolCallSplit[] = []
export const EMPTY_OPTIONS: Array<{ optionId: string; name: string; kind: string }> = []
export const EMPTY_QUEUE: QueuedMessage[] = []

// ── Derivation helpers ────────────────────────────────────────────

/**
 * Determine whether the chat input should be disabled and why.
 *
 * Only reads `status` and `isArchived`, so callers can pass a narrow slice
 * instead of the full task — that lets `ChatPanel` subscribe to those two
 * fields individually and avoid re-rendering on every other task mutation.
 *
 * Archived (resumed-from-history) threads are NOT disabled. They use
 * stateless resumption: the user can type, and on send a fresh ACP
 * connection is spawned with the historical transcript replayed as context.
 */
export function deriveInputState(
  task: Pick<AgentTask, 'status' | 'isArchived'> | null | undefined,
): {
  disabled: boolean
  disabledReason: string | undefined
} {
  if (!task) return { disabled: true, disabledReason: undefined }
  if (task.status === 'cancelled') return { disabled: true, disabledReason: 'Task was cancelled' }
  return { disabled: false, disabledReason: undefined }
}

/**
 * Determine whether a message should be queued or sent directly.
 */
export function shouldQueueMessage(task: AgentTask | null | undefined, isBtwMode: boolean): boolean {
  if (!task) return false
  return task.status === 'running' && !isBtwMode
}

/**
 * Determine whether the task is in a running state (for UI indicators).
 */
export function isTaskRunning(status: AgentTask['status'] | null): boolean {
  return status === 'running'
}

/**
 * Check if a panel is the focused one in split view.
 */
export function isPanelFocused(
  activeSplitId: string | null,
  taskIdProp: string | null | undefined,
  splitViews: Array<{ id: string; left: string; right: string }>,
  focusedPanel: 'left' | 'right',
): boolean {
  if (!activeSplitId || !taskIdProp) return true
  const sv = splitViews.find((v) => v.id === activeSplitId)
  if (!sv) return true
  const focusedTaskId = focusedPanel === 'left' ? sv.left : sv.right
  return focusedTaskId === taskIdProp
}

/**
 * Determine if the BTW (tangent) overlay should be shown for a task.
 */
export function isBtwModeActive(
  btwCheckpoint: { taskId: string } | null,
  resolvedTaskId: string | null,
): boolean {
  return btwCheckpoint !== null && btwCheckpoint.taskId === resolvedTaskId
}

// ── Structural equality helpers ───────────────────────────────────

/**
 * Shallow compare two context usage objects.
 * Returns true if they are structurally equal.
 */
export function contextUsageEqual(
  a: { used: number; size: number } | null | undefined,
  b: { used: number; size: number } | null | undefined,
): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  return a.used === b.used && a.size === b.size
}

/**
 * Shallow compare two permission objects.
 * Returns true if they represent the same permission request.
 */
export function permissionEqual(
  a: { requestId: string } | null | undefined,
  b: { requestId: string } | null | undefined,
): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  return a.requestId === b.requestId
}

/**
 * Compare two plan arrays by reference (they're replaced atomically).
 */
export function planEqual(
  a: AgentTask['plan'],
  b: AgentTask['plan'],
): boolean {
  return a === b
}

// ── Message send logic ────────────────────────────────────────────

/**
 * Build the user message object for optimistic UI update.
 */
export function buildUserMessage(content: string): TaskMessage {
  return {
    role: 'user',
    content,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Determine if a task needs a new connection (draft, resumed-from-history,
 * or explicit reconnect signal).
 *
 * Archived threads always need a fresh connection: the kiro-cli subprocess
 * died when the app closed, so the frontend must call `task_create` (with
 * `existingId` to preserve the thread id) to spawn a new ACP session.
 */
export function needsNewConnection(task: AgentTask): boolean {
  const isDraft = task.messages.length === 0 && task.status === 'paused'
  return isDraft || task.isArchived === true || task.needsNewConnection === true
}

/**
 * Extract the project name from a workspace path (last segment).
 */
export function extractProjectName(task: AgentTask): string {
  return (task.originalWorkspace ?? task.workspace).replace(/\\/g, '/').split('/').pop() ?? ''
}

// ── Dispatch snapshot helpers ─────────────────────────────────────

/**
 * Create a dispatch snapshot for optimistic UI tracking.
 * Call this when the user sends a message.
 */
export function captureDispatchSnapshot(
  task: AgentTask,
  streamingChunk: string,
): LocalDispatchSnapshot {
  return createDispatchSnapshot(task, streamingChunk)
}

/**
 * Derive the current dispatch phase for UI display.
 */
export function getDispatchPhase(
  snapshot: LocalDispatchSnapshot | null,
  task: AgentTask | null | undefined,
  streamingChunk: string,
): DispatchPhase {
  return deriveDispatchPhase(snapshot, task, streamingChunk)
}

/**
 * Get a human-readable label for the dispatch phase (or null if idle/streaming).
 */
export function getDispatchLabel(phase: DispatchPhase): string | null {
  return getDispatchPhaseLabel(phase)
}

// Re-export for convenience
export type { LocalDispatchSnapshot, DispatchPhase }
