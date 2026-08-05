/**
 * Optimized store selectors for the task store.
 *
 * These selectors provide fine-grained access to store data, preventing
 * unnecessary re-renders by selecting only the fields a component needs.
 *
 * Uses a normalized store pattern where sidebar data, session state, and
 * message content are separate concerns that don't trigger each other's
 * re-renders.
 */

import type { TaskStore } from './task-store-types'
import type { AgentTask } from '@/types'

// ── Sidebar-optimized selectors ───────────────────────────────────

/**
 * Metadata-only view of a task for sidebar rendering.
 * Excludes messages, streaming state, and tool calls.
 */
export interface TaskShellData {
  readonly id: string
  readonly name: string
  readonly status: AgentTask['status']
  readonly workspace: string
  readonly createdAt: string
  readonly isArchived?: boolean
  readonly worktreePath?: string
  readonly originalWorkspace?: string
  readonly projectId?: string
}

/**
 * Select only the task shell (metadata) for a given task ID.
 * This selector is stable when only messages/streaming change.
 */
export function selectTaskShell(state: TaskStore, taskId: string): TaskShellData | null {
  const task = state.tasks[taskId]
  if (!task) return null
  return {
    id: task.id,
    name: task.name,
    status: task.status,
    workspace: task.workspace,
    createdAt: task.createdAt,
    isArchived: task.isArchived,
    worktreePath: task.worktreePath,
    originalWorkspace: task.originalWorkspace,
    projectId: task.projectId,
  }
}

/**
 * Select the task status only. Useful for components that only need
 * to know if a task is running/paused/completed.
 */
export function selectTaskStatus(state: TaskStore, taskId: string | null): AgentTask['status'] | null {
  if (!taskId) return null
  return state.tasks[taskId]?.status ?? null
}

/**
 * Select whether a task is archived.
 */
export function selectTaskIsArchived(state: TaskStore, taskId: string | null): boolean {
  if (!taskId) return false
  return state.tasks[taskId]?.isArchived === true
}

// ── Active thread selectors ───────────────────────────────────────

/**
 * Select the message count for a task without subscribing to message content.
 */
export function selectMessageCount(state: TaskStore, taskId: string | null): number {
  if (!taskId) return 0
  return state.tasks[taskId]?.messages?.length ?? 0
}

/**
 * Select context usage for a task.
 */
export function selectContextUsage(state: TaskStore, taskId: string | null): { used: number; size: number } | null {
  if (!taskId) return null
  return state.tasks[taskId]?.contextUsage ?? null
}

/**
 * Select the pending permission for a task.
 */
export function selectPendingPermission(state: TaskStore, taskId: string | null) {
  if (!taskId) return null
  return state.tasks[taskId]?.pendingPermission ?? null
}

/**
 * Select the plan for a task.
 */
export function selectTaskPlan(state: TaskStore, taskId: string | null) {
  if (!taskId) return null
  return state.tasks[taskId]?.plan ?? null
}

/**
 * Select the workspace for a task.
 */
export function selectTaskWorkspace(state: TaskStore, taskId: string | null): string | null {
  if (!taskId) return null
  return state.tasks[taskId]?.workspace ?? null
}

/**
 * Select whether a task has a worktree.
 */
export function selectIsWorktree(state: TaskStore, taskId: string | null): boolean {
  if (!taskId) return false
  return !!state.tasks[taskId]?.worktreePath
}

// ── Streaming selectors ───────────────────────────────────────────

/**
 * Select streaming chunk for a task, respecting BTW mode.
 */
export function selectStreamingChunk(state: TaskStore, taskId: string | null): string {
  if (!taskId) return ''
  if (state.btwCheckpoint?.taskId === taskId) return ''
  return state.streamingChunks[taskId] ?? ''
}

/**
 * Select thinking chunk for a task, respecting BTW mode.
 */
export function selectThinkingChunk(state: TaskStore, taskId: string | null): string {
  if (!taskId) return ''
  if (state.btwCheckpoint?.taskId === taskId) return ''
  return state.thinkingChunks[taskId] ?? ''
}

/**
 * Select live tool calls for a task, respecting BTW mode.
 */
export function selectLiveToolCalls(state: TaskStore, taskId: string | null) {
  if (!taskId) return []
  if (state.btwCheckpoint?.taskId === taskId) return []
  return state.liveToolCalls[taskId] ?? []
}

// ── Sidebar summary selectors ─────────────────────────────────────

/**
 * Select the count of active (running) tasks across all projects.
 * Useful for showing a global activity indicator.
 */
export function selectRunningTaskCount(state: TaskStore): number {
  let count = 0
  for (const task of Object.values(state.tasks)) {
    if (task.status === 'running') count++
  }
  return count
}

/**
 * Select task IDs for a given workspace/project.
 *
 * Returns a stable empty array when no tasks exist; otherwise returns a
 * memoized array reference so equivalent re-selections don't trigger
 * re-renders. The memo cache is keyed by workspace path and bounded — older
 * entries are evicted once `MAX_WORKSPACE_CACHE_ENTRIES` is reached so the
 * map can't grow without bound when users open many projects.
 *
 * Cache key uses a `\u0000` separator plus the id count as a guard so two
 * distinct id sets can't collide on the joined string (task ids cannot
 * contain a null byte). `Object.values(state.tasks)` iterates in insertion
 * order; tasks are never re-ordered, so no sort is needed for the join.
 */
const EMPTY_IDS: string[] = []
const MAX_WORKSPACE_CACHE_ENTRIES = 64
const _taskIdsCache = new Map<string, { ids: string[]; key: string }>()

export function selectTaskIdsForWorkspace(state: TaskStore, workspace: string): string[] {
  const ids: string[] = []
  for (const task of Object.values(state.tasks)) {
    const ws = task.originalWorkspace ?? task.workspace
    if (ws === workspace) ids.push(task.id)
  }
  if (ids.length === 0) return EMPTY_IDS

  // `\u0000` cannot appear in a task id; prefix with the length so two id
  // sets that join to the same string would also need identical counts —
  // i.e. they'd actually be the same set in the same order.
  const key = `${ids.length}\u0000${ids.join('\u0000')}`
  const cached = _taskIdsCache.get(workspace)

  // Promote-on-hit: delete-then-set lands the entry at the MRU end of the
  // Map's insertion-order iteration, regardless of whether we're hitting
  // (key matches) or refreshing (key differs but we still want MRU
  // promotion).
  if (cached) _taskIdsCache.delete(workspace)
  if (cached && cached.key === key) {
    _taskIdsCache.set(workspace, cached)
    return cached.ids
  }

  // Evict the least-recently-used workspace once we hit the cap. We only
  // need this branch when adding a *new* workspace — refreshing an existing
  // entry doesn't grow the map (we deleted it above).
  if (!cached && _taskIdsCache.size >= MAX_WORKSPACE_CACHE_ENTRIES) {
    const oldest = _taskIdsCache.keys().next().value
    if (oldest !== undefined) _taskIdsCache.delete(oldest)
  }
  _taskIdsCache.set(workspace, { ids, key })
  return ids
}
