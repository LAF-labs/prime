/**
 * Worktree cleanup utilities.
 *
 * Detects orphaned worktrees (not shared by any other thread) and provides
 * display formatting for worktree paths.
 */
import type { AgentTask } from '@/types'
import type { ArchivedThreadMeta } from '@/lib/history-store'

/**
 * Get the worktree path for a thread if it's orphaned (not shared by any other thread).
 * Returns null if the thread has no worktree or if the worktree is shared.
 */
export function getOrphanedWorktreePath(
  tasks: Record<string, AgentTask>,
  archivedMeta: Record<string, ArchivedThreadMeta>,
  threadId: string,
): string | null {
  const task = tasks[threadId]
  const worktreePath = task?.worktreePath
  if (!worktreePath) return null

  const normalized = normalizeWorktreePath(worktreePath)
  if (!normalized) return null

  // Check if any other live task shares this worktree
  for (const [id, t] of Object.entries(tasks)) {
    if (id === threadId) continue
    if (normalizeWorktreePath(t.worktreePath) === normalized) return null
  }

  // Check if any archived thread shares this worktree
  for (const [id, m] of Object.entries(archivedMeta)) {
    if (id === threadId) continue
    if (normalizeWorktreePath(m.worktreePath) === normalized) return null
  }

  return normalized
}

/**
 * Format a worktree path for display (shows only the last segment).
 */
export function formatWorktreePathForDisplay(worktreePath: string): string {
  const trimmed = worktreePath.trim()
  if (!trimmed) return worktreePath

  const normalized = trimmed.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = normalized.split('/')
  const lastPart = parts[parts.length - 1]?.trim() ?? ''
  return lastPart.length > 0 ? lastPart : trimmed
}

function normalizeWorktreePath(path: string | undefined | null): string | null {
  const trimmed = path?.trim()
  if (!trimmed) return null
  return trimmed.replace(/\\/g, '/').replace(/\/+$/, '')
}
