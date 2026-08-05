/**
 * VCS Status Store — real-time git status for each workspace.
 *
 * Listens to `project-tree-changed` events from the file watcher and
 * debounces git status refreshes. The sidebar reads from this store to
 * show branch name, ahead/behind counts, and dirty indicators.
 */
import { create } from 'zustand'
import { ipc } from '@/lib/ipc'

export interface VcsStatus {
  branch: string
  aheadCount: number
  behindCount: number
  isDirty: boolean
  changedFileCount: number
  hasUpstream: boolean
  /** Timestamp of last successful refresh */
  lastRefreshedAt: number
}

interface VcsStatusStore {
  /** Per-workspace VCS status */
  statuses: Record<string, VcsStatus>
  /** Refresh the VCS status for a workspace */
  refreshStatus: (workspace: string) => Promise<void>
  /** Clear status for a workspace (e.g. when project is removed) */
  clearStatus: (workspace: string) => void
}

export const useVcsStatusStore = create<VcsStatusStore>((set, get) => ({
  statuses: {},

  refreshStatus: async (workspace: string) => {
    try {
      const status = await ipc.gitVcsStatus(workspace)
      set((s) => ({
        statuses: {
          ...s.statuses,
          [workspace]: { ...status, lastRefreshedAt: Date.now() },
        },
      }))
    } catch {
      // Not a git repo or error — clear status
      set((s) => {
        if (!s.statuses[workspace]) return s
        const { [workspace]: _, ...rest } = s.statuses
        return { statuses: rest }
      })
    }
  },

  clearStatus: (workspace: string) => {
    set((s) => {
      if (!s.statuses[workspace]) return s
      const { [workspace]: _, ...rest } = s.statuses
      return { statuses: rest }
    })
  },
}))

// ── Debounced refresh on file changes ────────────────────────────────────

const DEBOUNCE_MS = 2000
const pendingRefreshes = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Schedule a debounced VCS status refresh for a workspace.
 * Called from the project-tree-changed event listener.
 */
export function scheduleVcsRefresh(workspace: string): void {
  const existing = pendingRefreshes.get(workspace)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(() => {
    pendingRefreshes.delete(workspace)
    useVcsStatusStore.getState().refreshStatus(workspace)
  }, DEBOUNCE_MS)

  pendingRefreshes.set(workspace, timer)
}

/**
 * Initialize VCS status for all known projects.
 * Called once on app startup after loadTasks completes.
 */
export function initVcsStatus(workspaces: string[]): void {
  for (const ws of workspaces) {
    useVcsStatusStore.getState().refreshStatus(ws)
  }
}

/**
 * Cleanup all pending timers (for HMR / unmount).
 */
export function cleanupVcsStatus(): void {
  for (const timer of pendingRefreshes.values()) {
    clearTimeout(timer)
  }
  pendingRefreshes.clear()
}
