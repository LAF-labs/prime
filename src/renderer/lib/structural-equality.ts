/**
 * Structural equality helpers for store updates.
 *
 * Per-field equality checks that prevent unnecessary store updates and React
 * re-renders. These functions compare domain objects at the field level,
 * avoiding deep equality costs while being more precise than reference equality.
 *
 * Use these in store setters to bail out early when incoming data matches
 * the current state.
 */

import type { AgentTask, TaskMessage, ToolCall } from '@/types'

/**
 * Compare two task objects for meaningful changes.
 * Returns true if the tasks are structurally equal in all fields that
 * affect rendering.
 */
export function tasksEqual(prev: AgentTask, next: AgentTask): boolean {
  return (
    prev.id === next.id &&
    prev.name === next.name &&
    prev.status === next.status &&
    prev.workspace === next.workspace &&
    prev.messages === next.messages &&
    prev.isArchived === next.isArchived &&
    prev.worktreePath === next.worktreePath &&
    prev.originalWorkspace === next.originalWorkspace &&
    prev.projectId === next.projectId &&
    prev.parentTaskId === next.parentTaskId &&
    prev.needsNewConnection === next.needsNewConnection &&
    contextUsagesEqual(prev.contextUsage, next.contextUsage) &&
    permissionsEqual(prev.pendingPermission, next.pendingPermission) &&
    plansEqual(prev.plan, next.plan) &&
    prev.compactionStatus === next.compactionStatus
  )
}

/**
 * Compare context usage objects.
 */
export function contextUsagesEqual(
  a: { used: number; size: number } | null | undefined,
  b: { used: number; size: number } | null | undefined,
): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  return a.used === b.used && a.size === b.size
}

/**
 * Compare permission request objects.
 */
export function permissionsEqual(
  a: { requestId: string; toolName?: string; description?: string } | null | undefined,
  b: { requestId: string; toolName?: string; description?: string } | null | undefined,
): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  return (
    a.requestId === b.requestId &&
    a.toolName === b.toolName &&
    a.description === b.description
  )
}

/**
 * Compare plan step arrays.
 * Plans are replaced atomically, so reference equality is sufficient
 * when both are non-null.
 */
export function plansEqual(
  a: AgentTask['plan'],
  b: AgentTask['plan'],
): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  if (a.length !== b.length) return false
  return a.every((step, i) => (
    step.content === b[i].content &&
    step.status === b[i].status
  ))
}

/**
 * Compare two tool call objects.
 * Uses reference equality for `content` because content arrays are replaced
 * atomically by the IPC layer — the same array instance means unchanged data.
 */
export function toolCallsEqual(a: ToolCall, b: ToolCall): boolean {
  return (
    a.toolCallId === b.toolCallId &&
    a.status === b.status &&
    a.title === b.title &&
    a.content === b.content &&
    a.kind === b.kind
  )
}

/**
 * Compare two tool call arrays.
 * Returns true if they contain the same tool calls in the same order.
 */
export function toolCallArraysEqual(a: ToolCall[], b: ToolCall[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((tc, i) => toolCallsEqual(tc, b[i]))
}

/**
 * Compare two message arrays by reference.
 * Messages are typically replaced atomically, so reference equality
 * is the fast path. Falls back to length + last message check.
 */
export function messagesEqual(a: TaskMessage[], b: TaskMessage[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  if (a.length === 0) return true
  // Check last message as a quick proxy for "anything changed"
  const lastA = a[a.length - 1]
  const lastB = b[b.length - 1]
  return (
    lastA.role === lastB.role &&
    lastA.content === lastB.content &&
    lastA.timestamp === lastB.timestamp
  )
}

/**
 * Shallow compare two string arrays.
 */
export function stringArraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}
