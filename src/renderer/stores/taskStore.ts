import { create } from 'zustand'
import type { AgentTask, ActivityEntry, SoftDeletedThread, TaskMessage, ToolCall } from '@/types'
import { ipc } from '@/lib/ipc'
import { t } from '@/lib/i18n'
import { attempt } from '@/lib/ipc-report'
import { joinChunk } from '@/lib/utils'
import * as historyStore from '@/lib/history-store'
import * as threadDb from '@/lib/thread-db'
import type { ArchivedThreadMeta } from '@/lib/history-store'
import { useSettingsStore } from './settingsStore'
import { sendTaskNotification } from '@/lib/notifications'
import { snapshotOwnedIds } from '@/lib/turn-ownership'
import { resendMessage } from '@/lib/chat-resend'
import type { TaskStore } from './task-store-types'

interface SavedMessageLike {
  role: string
  content: string
  timestamp: string
  thinking?: string
}

interface SavedThreadLike {
  id: string
  name: string
  workspace: string
  createdAt: string
  messages: SavedMessageLike[]
  /** Present on thin index entries, where `messages` is empty. */
  lastActivityAt?: string
  messageCount?: number
  parentTaskId?: string
  worktreePath?: string
  originalWorkspace?: string
  projectId?: string
}

/**
 * Really delete these threads, messages and search index included.
 *
 * Dropping a thread from the JS state only removes it from the sidebar; the
 * messages stay in SQLite and in the FTS index indefinitely. When someone
 * deletes a conversation because they pasted a key or a client's code into it,
 * the app told them it was gone and it was not.
 */
const eraseFromDb = (ids: string[]): void => {
  for (const id of ids) {
    threadDb.deleteThread(id).catch((err) => {
      console.warn(`[taskStore] could not erase thread ${id} from SQLite:`, err)
    })
  }
}

/**
 * Add threads that only SQLite knows about to the sidebar.
 *
 * `history.json` is the index the sidebar is built from; SQLite holds the
 * message bodies. When the index is lost — truncated by a crash, or emptied by
 * an older build's write race — every conversation becomes unreachable even
 * though its messages are intact. Consulting SQLite here is what makes that
 * recoverable. Mutates `archivedMeta` and `projects` in place.
 */
const mergeThreadsFromDb = async (
  archivedMeta: Record<string, ArchivedThreadMeta>,
  tasks: Record<string, AgentTask>,
  deletedTaskIds: Set<string>,
  projects: string[],
): Promise<void> => {
  try {
    const fromDb = await threadDb.listThreadMeta()
    let recovered = 0
    for (const meta of fromDb) {
      // Empty shells are an artifact of metadata being saved before messages;
      // surfacing them would put rows in the sidebar that open to nothing.
      if (meta.messageCount === 0) continue
      if (tasks[meta.id] || archivedMeta[meta.id] || deletedTaskIds.has(meta.id)) continue
      archivedMeta[meta.id] = meta
      recovered++
      const ws = meta.originalWorkspace ?? meta.workspace
      if (ws && !projects.includes(ws) && !isChatWorkspace(ws)) projects.push(ws)
    }
    if (recovered > 0) {
      console.info(`[taskStore] recovered ${recovered} thread(s) the JSON index had lost`)
    }
  } catch (err) {
    // Best-effort: SQLite being unavailable must not stop the app from
    // starting with whatever the JSON index did give us.
    console.warn('[taskStore] could not consult SQLite for missing threads:', err)
  }
}

const projectMeta = (t: SavedThreadLike): ArchivedThreadMeta => {
  // Thin index entries carry no messages; their explicit fields are the truth.
  const last = t.lastActivityAt
    ?? (t.messages.length > 0 ? t.messages[t.messages.length - 1].timestamp : t.createdAt)
  return {
    id: t.id,
    name: t.name,
    workspace: t.workspace,
    createdAt: t.createdAt,
    lastActivityAt: last,
    messageCount: t.messageCount ?? t.messages.length,
    ...(t.parentTaskId ? { parentTaskId: t.parentTaskId } : {}),
    ...(t.worktreePath ? { worktreePath: t.worktreePath } : {}),
    ...(t.originalWorkspace ? { originalWorkspace: t.originalWorkspace } : {}),
    ...(t.projectId ? { projectId: t.projectId } : {}),
  }
}

/** Cap a Set to MAX entries by evicting oldest (first-inserted) entries. */
const MAX_DELETED_IDS = 500
const capDeletedIds = (ids: Set<string>): Set<string> => {
  if (ids.size <= MAX_DELETED_IDS) return ids
  const arr = [...ids]
  return new Set(arr.slice(arr.length - MAX_DELETED_IDS))
}

/** Cap softDeleted to this many entries to prevent full-task-object accumulation. */
const MAX_SOFT_DELETED = 50
const capSoftDeleted = (sd: Record<string, SoftDeletedThread>): Record<string, SoftDeletedThread> => {
  const keys = Object.keys(sd)
  if (keys.length <= MAX_SOFT_DELETED) return sd
  // Sort by deletedAt ascending, keep the newest MAX_SOFT_DELETED
  const sorted = keys.sort((a, b) =>
    new Date(sd[a].deletedAt).getTime() - new Date(sd[b].deletedAt).getTime(),
  )
  const keep = sorted.slice(sorted.length - MAX_SOFT_DELETED)
  const result: Record<string, SoftDeletedThread> = {}
  for (const k of keep) result[k] = sd[k]
  // Eviction from the soft-delete window IS the permanent delete — erase the
  // evicted threads from SQLite too, or `mergeThreadsFromDb` resurrects them
  // on the next launch (and "deleted" data would quietly outlive the UI).
  eraseFromDb(sorted.slice(0, sorted.length - MAX_SOFT_DELETED))
  return result
}

// ── Thin-write eligibility ────────────────────────────────────────
// Per-window bookkeeping for which threads may be written as thin index
// entries. Module scope is correct here: persistHistory is also per-window.

/** Threads whose JSON→SQLite backfill is still in flight (or failed).
 *  Thinning their index entry before the messages are provably in SQLite
 *  would leave the conversation in neither store. */
const backfillPendingIds = new Set<string>()

/** Threads the user explicitly emptied via `/clear`. Their empty state is
 *  intentional and must be recorded even before `sqliteReady` — the
 *  truncation has already been written through to SQLite. */
const intentionallyClearedIds = new Set<string>()

/** Mark a thread as intentionally emptied (called by the `/clear` handler). */
export const markThreadCleared = (taskId: string): void => {
  intentionallyClearedIds.add(taskId)
}

export type { TaskStore, BtwCheckpoint } from './task-store-types'
export { initTaskListeners, applyTurnEnd } from './task-store-listeners'

/** Project-independent chats live here; they must never appear as a project. */
export const CHATS_DIR_MARKER = '/.laf-agent/chats'
export const isChatWorkspace = (ws: string | null | undefined): boolean =>
  !!ws && ws.includes(CHATS_DIR_MARKER)
const withoutChatDirs = (list: string[]): string[] => list.filter((w) => !isChatWorkspace(w))

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: {},
  archivedMeta: {},
  historyLoaded: false,
  sqliteReady: false,
  projects: [],
  projectIds: {},
  projectNames: {},
  deletedTaskIds: new Set<string>(),
  softDeleted: {},
  selectedTaskId: null,
  pendingWorkspace: null,
  view: 'chat',
  isNewProjectOpen: false,
  isSettingsOpen: false,
  settingsInitialSection: null,
  btwCheckpoint: null,
  streamingChunks: {},
  thinkingChunks: {},
  liveToolCalls: {},
  liveToolSplits: {},
  queuedMessages: {},
  activityFeed: [],
  connected: false,
  connectionStatus: { phase: 'idle', attemptCount: 0, reconnectAttemptCount: 0, reconnectMaxAttempts: 5, hasConnected: false, connectedAt: null, disconnectedAt: null, lastError: null, lastErrorAt: null, nextRetryAt: null },
  dispatchSnapshots: {},
  thinkingLevels: {},
  terminalOpenTasks: new Set<string>(),
  isWorkspaceTerminalOpen: false,
  pendingTerminalRequests: {},
  drafts: {},
  draftAttachments: {},
  draftPastedChunks: {},
  draftMentionedFiles: {},
  _suppressDraftSave: null,
  notifiedTaskIds: [],
  taskModes: {},
  taskModels: {},
  sessionIds: {},
  isForking: false,
  lastAddedProject: null,
  worktreeCleanupPending: null,
  splitViews: [],
  pinnedThreadIds: [],
  activeSplitId: null,
  pendingSplitReplace: null,
  focusedPanel: 'left' as const,
  scrollPositions: {},
  threadOrders: {},
  navHistory: [],
  navIndex: -1,
  _navInternal: false,

  navBack: () => {
    const { navHistory, navIndex, tasks, archivedMeta } = get()
    if (navIndex <= 0) return
    for (let i = navIndex - 1; i >= 0; i--) {
      const candidate = navHistory[i]
      if (candidate && (tasks[candidate] || archivedMeta[candidate])) {
        set({ _navInternal: true, navIndex: i })
        get().setSelectedTask(candidate)
        set({ _navInternal: false })
        return
      }
    }
  },

  navForward: () => {
    const { navHistory, navIndex, tasks, archivedMeta } = get()
    if (navIndex < 0 || navIndex >= navHistory.length - 1) return
    for (let i = navIndex + 1; i < navHistory.length; i++) {
      const candidate = navHistory[i]
      if (candidate && (tasks[candidate] || archivedMeta[candidate])) {
        set({ _navInternal: true, navIndex: i })
        get().setSelectedTask(candidate)
        set({ _navInternal: false })
        return
      }
    }
  },

  setSelectedTask: (id) => {
    // Handle pending split replacement
    const pending = get().pendingSplitReplace
    if (pending && id) {
      set({ pendingSplitReplace: null })
      get().replaceSplitThread(pending.splitId, pending.side, id)
      return
    }
    const { selectedTaskId: currentId, activeSplitId, splitViews, focusedPanel, notifiedTaskIds, archivedMeta, tasks: currentTasks } = get()
    if (currentId === id && !activeSplitId) return
    // Push to nav history unless this call originated from navBack/navForward
    if (id && !get()._navInternal) {
      const { navHistory, navIndex } = get()
      // Don't push duplicate consecutive entries
      if (navHistory[navIndex] !== id) {
        const truncated = navHistory.slice(0, navIndex + 1)
        truncated.push(id)
        // Cap history length to prevent unbounded growth
        const capped = truncated.length > 100 ? truncated.slice(truncated.length - 100) : truncated
        set({ navHistory: capped, navIndex: capped.length - 1 })
      }
    }
    // Clear the notification badge when the user navigates to this thread
    if (id && notifiedTaskIds.includes(id)) {
      set({ notifiedTaskIds: notifiedTaskIds.filter((nid) => nid !== id) })
    }
    // Hydrate archived metadata into a full task lazily on selection.
    // Fire-and-forget: the user sees the thread name from `archivedMeta` while
    // the messages load, and Zustand re-renders once hydration completes.
    if (id && !currentTasks[id] && archivedMeta[id]) {
      void get().hydrateArchivedTask(id)
    }
    // If the target task is part of the active split, focus that panel instead of closing the split
    if (activeSplitId && id) {
      const sv = splitViews.find((v) => v.id === activeSplitId)
      if (sv && (sv.left === id || sv.right === id)) {
        const panel = sv.left === id ? 'left' as const : 'right' as const
        const updates: Partial<import('./task-store-types').TaskStore> = { selectedTaskId: id }
        if (focusedPanel !== panel) updates.focusedPanel = panel
        set(updates)
        const task = get().tasks[id]
        const modeId = get().taskModes[id] ?? 'code'
        const workspace = task ? (task.originalWorkspace ?? task.workspace) : null
        const operationalWs = task ? task.workspace : null
        useSettingsStore.getState().setActiveWorkspace(workspace, operationalWs)
        useSettingsStore.setState({ currentModeId: modeId })
        // Sync per-task model to global (for non-split-aware components)
        const modelId = get().taskModels[id]
        if (modelId) useSettingsStore.setState({ currentModelId: modelId })
        return
      }
    }
    const updates: Partial<import('./task-store-types').TaskStore> = { selectedTaskId: id }
    // Navigating to a thread outside the split deactivates it (but keeps the saved pairing)
    if (activeSplitId) {
      updates.activeSplitId = null
    }
    set(updates)
    const task = id ? get().tasks[id] : null
    const modeId = id ? (get().taskModes[id] ?? 'code') : 'code'
    const workspace = task ? (task.originalWorkspace ?? task.workspace) : null
    const operationalWs = task ? task.workspace : null
    useSettingsStore.getState().setActiveWorkspace(workspace, operationalWs)
    useSettingsStore.setState({ currentModeId: modeId })
    // Sync per-task model to global (for non-split-aware components)
    if (id) {
      const modelId = get().taskModels[id]
      if (modelId) useSettingsStore.setState({ currentModelId: modelId })
    }
  },
  setView: (view) => {
    if (get().view === view) return
    set({ view })
  },
  setNewProjectOpen: (open) => set({ isNewProjectOpen: open }),
  setSettingsOpen: (open, section) => set({ isSettingsOpen: open, settingsInitialSection: section ?? null }),
  addProject: (workspace) => {
    if (get().projects.includes(workspace)) return
    if (workspace.includes('/.laf-agent/worktrees/')) return
    if (isChatWorkspace(workspace)) return
    const id = crypto.randomUUID()
    set((s) => ({
      projects: [...s.projects, workspace],
      projectIds: { ...s.projectIds, [workspace]: id },
      lastAddedProject: workspace,
    }))
  },
  clearLastAddedProject: () => set({ lastAddedProject: null }),
  getProjectId: (workspace) => {
    const existing = get().projectIds[workspace]
    if (existing) return existing
    const id = crypto.randomUUID()
    set((s) => ({ projectIds: { ...s.projectIds, [workspace]: id } }))
    return id
  },

  removeProject: (workspace) => {
    set((s) => {
      let taskIds = Object.keys(s.tasks).filter((id) => {
        const t = s.tasks[id]
        const ws = t.originalWorkspace ?? t.workspace
        return ws === workspace
      })
      // If no tasks matched by workspace, try matching by projectId (orphaned UUID entries)
      if (taskIds.length === 0) {
        taskIds = Object.keys(s.tasks).filter((id) => s.tasks[id].projectId === workspace)
      }
      const tasks = { ...s.tasks }
      const softDeleted = { ...s.softDeleted }
      const now = new Date().toISOString()
      taskIds.forEach((id) => {
        softDeleted[id] = { task: { ...tasks[id], isArchived: true, status: 'completed' }, deletedAt: now }
        delete tasks[id]
      })
      taskIds.forEach((id) => { void ipc.cancelTask(id).catch(() => {}) })
      taskIds.forEach((id) => { attempt(t('Could not delete the thread'), ipc.deleteTask(id)) })
      const selectedTaskId = taskIds.includes(s.selectedTaskId ?? '') ? null : s.selectedTaskId
      const deletedTaskIds = new Set(s.deletedTaskIds)
      taskIds.forEach((id) => deletedTaskIds.add(id))
      const { [workspace]: _, ...drafts } = s.drafts
      const taskModes = { ...s.taskModes }
      taskIds.forEach((id) => { delete taskModes[id] })
      const taskModels = { ...s.taskModels }
      taskIds.forEach((id) => { delete taskModels[id] })
      // Clean up projectIds entries that point to this UUID
      const projectIds = { ...s.projectIds }
      for (const [ws, pid] of Object.entries(projectIds)) {
        if (pid === workspace) delete projectIds[ws]
      }
      return {
        projects: s.projects.filter((p) => p !== workspace),
        projectIds,
        tasks,
        softDeleted: capSoftDeleted(softDeleted),
        selectedTaskId,
        deletedTaskIds: capDeletedIds(deletedTaskIds),
        drafts,
        taskModes,
        taskModels,
        pendingWorkspace: s.pendingWorkspace === workspace ? null : s.pendingWorkspace,
        view: selectedTaskId === null && s.view === 'chat' ? 'dashboard' : s.view,
      }
    })
    get().persistHistory()
  },

  archiveThreads: (workspace) => {
    set((s) => {
      const taskIds = Object.keys(s.tasks).filter((id) => {
        const t = s.tasks[id]
        const ws = t.originalWorkspace ?? t.workspace
        return ws === workspace
      })
      const tasks = { ...s.tasks }
      const softDeleted = { ...s.softDeleted }
      const now = new Date().toISOString()
      taskIds.forEach((id) => {
        softDeleted[id] = { task: { ...tasks[id], isArchived: true, status: 'completed' }, deletedAt: now }
        delete tasks[id]
      })
      taskIds.forEach((id) => { void ipc.cancelTask(id).catch(() => {}) })
      taskIds.forEach((id) => { attempt(t('Could not delete the thread'), ipc.deleteTask(id)) })
      const selectedTaskId = taskIds.includes(s.selectedTaskId ?? '') ? null : s.selectedTaskId
      const deletedTaskIds = new Set(s.deletedTaskIds)
      taskIds.forEach((id) => deletedTaskIds.add(id))
      return {
        tasks,
        softDeleted: capSoftDeleted(softDeleted),
        selectedTaskId,
        deletedTaskIds: capDeletedIds(deletedTaskIds),
        view: selectedTaskId === null && s.view === 'chat' ? 'dashboard' : s.view,
      }
    })
    get().persistHistory()
  },

  upsertTask: (task) => {
    set((state) => {
      // Don't re-add tasks that were explicitly deleted
      if (state.deletedTaskIds.has(task.id)) return state
      const prev = state.tasks[task.id]
      // Always preserve existing messages when incoming has fewer.
      // Backend task_update events arrive with messages: [] (stripped at listener).
      // Only frontend callers (onTurnEnd, handleSendMessage) pass real messages.
      const messages = prev && prev.messages.length > task.messages.length
        ? prev.messages
        : task.messages
      // Preserve client-side name: backend task_update events carry the stale
      // creation-time name and are unaware of user renames via renameTask().
      const name = prev ? prev.name : task.name
      // Bail out if nothing meaningful changed
      if (prev
        && prev.status === task.status
        && prev.messages === messages
        && prev.name === name
        && prev.pendingPermission === task.pendingPermission
        && prev.plan === task.plan
        && prev.contextUsage === task.contextUsage
        && prev.worktreePath === (task.worktreePath ?? prev.worktreePath)
        && prev.originalWorkspace === (task.originalWorkspace ?? prev.originalWorkspace)
        && prev.projectId === (task.projectId ?? prev.projectId)
      ) {
        return state
      }
      // Preserve client-only fields that the backend doesn't track
      const merged = {
        ...task,
        messages,
        name,
        ...(prev?.parentTaskId && !task.parentTaskId ? { parentTaskId: prev.parentTaskId } : {}),
        ...(prev?.worktreePath && !task.worktreePath ? { worktreePath: prev.worktreePath } : {}),
        ...(prev?.originalWorkspace && !task.originalWorkspace ? { originalWorkspace: prev.originalWorkspace } : {}),
        ...(prev?.projectId && !task.projectId ? { projectId: prev.projectId } : {}),
      }
      const statusChanged = !prev || prev.status !== task.status
      if (statusChanged && (task.status === 'completed' || task.status === 'error' || task.status === 'cancelled')) {
      }
      const activity: ActivityEntry[] = statusChanged
        ? [
            {
              taskId: task.id,
              taskName: task.name,
              status: task.status,
              timestamp: new Date().toISOString(),
            },
            ...state.activityFeed,
          ].slice(0, 20)
        : state.activityFeed
      return {
        tasks: { ...state.tasks, [task.id]: merged },
        activityFeed: activity,
      }
    })
    // Notify on permission requests while backgrounded
    if (task.pendingPermission) {
      const prev = get().tasks[task.id]
      // Only fire if this is a new permission (not already notified)
      if (!prev || prev.pendingPermission?.requestId !== task.pendingPermission.requestId) {
        const permSettings = useSettingsStore.getState().settings
        sendTaskNotification({
          task,
          status: 'permission',
          isNotificationsEnabled: permSettings.notifications ?? true,
          isSoundEnabled: permSettings.soundNotifications ?? true,
          onNotified: (tid) => {
            set((s) => ({
              notifiedTaskIds: s.notifiedTaskIds.includes(tid) ? s.notifiedTaskIds : [...s.notifiedTaskIds, tid],
            }))
          },
        })
      }
    }
  },

  removeTask: (id) => {
    get().softDeleteTask(id)
  },

  archiveTask: (id) => {
    const task = get().tasks[id]
    if (!task || task.isArchived) return
    // Worktree threads: show confirmation dialog BEFORE deleting
    if (task.worktreePath && task.originalWorkspace) {
      const branch = task.worktreePath.split('/').pop() ?? 'unknown'
      // Set pending immediately with hasChanges=null (loading), then check async
      set({ worktreeCleanupPending: { taskId: id, worktreePath: task.worktreePath, branch, originalWorkspace: task.originalWorkspace, action: 'archive', hasChanges: null } })
      void ipc.gitWorktreeHasChanges(task.worktreePath).then((hasChanges) => {
        set((s) => s.worktreeCleanupPending?.taskId === id
          ? { worktreeCleanupPending: { ...s.worktreeCleanupPending!, hasChanges } }
          : s)
      }).catch(() => {
        set((s) => s.worktreeCleanupPending?.taskId === id
          ? { worktreeCleanupPending: { ...s.worktreeCleanupPending!, hasChanges: false } }
          : s)
      })
      return
    }
    // Non-worktree: proceed immediately
    void ipc.cancelTask(id).catch(() => {})
    set((s) => ({
      tasks: { ...s.tasks, [id]: { ...s.tasks[id], isArchived: true, status: 'completed' } },
      streamingChunks: { ...s.streamingChunks, [id]: '' },
      thinkingChunks: { ...s.thinkingChunks, [id]: '' },
      liveToolCalls: { ...s.liveToolCalls, [id]: [] },
      liveToolSplits: { ...s.liveToolSplits, [id]: [] },
    }))
    void ipc.checkpointCleanup(id).catch(() => {})
    attempt(t('Could not delete the thread'), ipc.deleteTask(id))
    get().persistHistory()
  },

  softDeleteTask: (id) => {
    const state = get()
    const task = state.tasks[id]
    // Archived metadata threads aren't inflated yet — hydrate first so the
    // soft-delete entry retains the full message history needed for restore.
    if (!task && state.archivedMeta[id]) {
      void state.hydrateArchivedTask(id).then((ok) => {
        if (ok) get().softDeleteTask(id)
      })
      return
    }
    if (!task) return
    // Worktree threads: show confirmation dialog BEFORE deleting
    if (task.worktreePath && task.originalWorkspace) {
      const branch = task.worktreePath.split('/').pop() ?? 'unknown'
      set({ worktreeCleanupPending: { taskId: id, worktreePath: task.worktreePath, branch, originalWorkspace: task.originalWorkspace, action: 'delete', hasChanges: null } })
      void ipc.gitWorktreeHasChanges(task.worktreePath).then((hasChanges) => {
        set((s) => s.worktreeCleanupPending?.taskId === id
          ? { worktreeCleanupPending: { ...s.worktreeCleanupPending!, hasChanges } }
          : s)
      }).catch(() => {
        set((s) => s.worktreeCleanupPending?.taskId === id
          ? { worktreeCleanupPending: { ...s.worktreeCleanupPending!, hasChanges: false } }
          : s)
      })
      return
    }
    // Non-worktree: proceed immediately
    void ipc.cancelTask(id).catch(() => {})
    attempt(t('Could not delete the thread'), ipc.deleteTask(id))
    set((state) => {
      const { [id]: removed, ...rest } = state.tasks
      const { [id]: _c, ...chunks } = state.streamingChunks
      const { [id]: _t, ...thinking } = state.thinkingChunks
      const { [id]: _tc, ...tools } = state.liveToolCalls
      const { [id]: _ts, ...splits } = state.liveToolSplits
      const { [id]: _m, ...modes } = state.taskModes
      const { [id]: _mdl, ...models } = state.taskModels
      const { [id]: _ds, ...remainingSnapshots } = state.dispatchSnapshots
      const deletedTaskIds = new Set(state.deletedTaskIds)
      deletedTaskIds.add(id)
      const softDeleted = capSoftDeleted({
        ...state.softDeleted,
        [id]: { task: { ...removed, isArchived: true, status: 'completed' as const }, deletedAt: new Date().toISOString() },
      })
      return {
        tasks: rest,
        streamingChunks: chunks,
        thinkingChunks: thinking,
        liveToolCalls: tools,
        liveToolSplits: splits,
        taskModes: modes,
        taskModels: models,
        dispatchSnapshots: remainingSnapshots,
        deletedTaskIds: capDeletedIds(deletedTaskIds),
        softDeleted,
        selectedTaskId: state.selectedTaskId === id ? null : state.selectedTaskId,
        splitViews: state.splitViews.filter((sv) => sv.left !== id && sv.right !== id),
        activeSplitId: state.splitViews.some((sv) => (sv.left === id || sv.right === id) && sv.id === state.activeSplitId) ? null : state.activeSplitId,
        pinnedThreadIds: state.pinnedThreadIds.filter((tid) => tid !== id),
      }
    })
    get().persistHistory()
  },

  restoreTask: (id) => {
    const entry = get().softDeleted[id]
    if (!entry) return
    set((state) => {
      const { [id]: _, ...remaining } = state.softDeleted
      const deletedTaskIds = new Set(state.deletedTaskIds)
      deletedTaskIds.delete(id)
      const projectWorkspace = entry.task.originalWorkspace ?? entry.task.workspace
      const projects = state.projects.includes(projectWorkspace) || isChatWorkspace(projectWorkspace)
        ? state.projects
        : [...state.projects, projectWorkspace]
      return {
        tasks: { ...state.tasks, [id]: { ...entry.task, isArchived: false, status: 'paused' as const, needsNewConnection: true } },
        softDeleted: remaining,
        deletedTaskIds,
        projects,
      }
    })
    get().persistHistory()
  },

  permanentlyDeleteTask: (id) => {
    if (!get().softDeleted[id]) return
    set((state) => {
      const { [id]: _, ...remaining } = state.softDeleted
      const deletedTaskIds = new Set(state.deletedTaskIds)
      deletedTaskIds.add(id)
      return { softDeleted: remaining, deletedTaskIds: capDeletedIds(deletedTaskIds) }
    })
    eraseFromDb([id])
    get().persistHistory()
  },

  purgeExpiredSoftDeletes: () => {
    const TWO_DAYS_MS = 48 * 60 * 60 * 1000
    const now = Date.now()
    const { softDeleted } = get()
    const expiredIds = Object.keys(softDeleted).filter(
      (id) => now - new Date(softDeleted[id].deletedAt).getTime() >= TWO_DAYS_MS,
    )
    if (expiredIds.length === 0) return
    set((state) => {
      const next = { ...state.softDeleted }
      const deletedTaskIds = new Set(state.deletedTaskIds)
      for (const id of expiredIds) {
        delete next[id]
        deletedTaskIds.add(id)
      }
      return { softDeleted: next, deletedTaskIds: capDeletedIds(deletedTaskIds) }
    })
    eraseFromDb(expiredIds)
    get().persistHistory()
  },

  purgeAllSoftDeletes: () => {
    const ids = Object.keys(get().softDeleted)
    if (ids.length === 0) return
    set((state) => {
      const deletedTaskIds = new Set(state.deletedTaskIds)
      for (const id of ids) deletedTaskIds.add(id)
      return { softDeleted: {}, deletedTaskIds }
    })
    eraseFromDb(ids)
    get().persistHistory()
  },

  /**
   * Auto-archive threads that have been inactive for longer than the configured
   * `autoArchiveDays` setting. Only archives completed/error/cancelled threads
   * (never running or paused). Called on app startup alongside purgeExpiredSoftDeletes.
   *
   * The heavy lifting (scanning threads, computing staleness) is done by the
   * Rust backend via the thread_db_auto_archive command. The frontend just
   * updates its local state with the results.
   */
  autoArchiveStaleThreads: () => {
    const settings = useSettingsStore.getState().settings
    const days = settings.autoArchiveDays
    if (!days || days <= 0) return

    // Delegate to backend — it queries SQLite for threads past the retention
    // window. It reports them and leaves them on disk; archiving is a sidebar
    // state, and the rows are what makes a lost JSON index recoverable.
    void ipc.threadDbAutoArchive(days).then((archived) => {
      if (!archived || archived.length === 0) return

      // Because the rows survive, the same threads are reported on every
      // startup — including ones the user has since deleted. Without this
      // filter, deleting a thread would only hide it until the next launch.
      const { deletedTaskIds, softDeleted } = get()
      const archivedThreads = archived.filter(
        (t) => !deletedTaskIds.has(t.id) && !softDeleted[t.id],
      )
      if (archivedThreads.length === 0) return

      const staleIds = new Set(archivedThreads.map((t) => t.id))

      set((state) => {
        const tasks = { ...state.tasks }
        const archivedMeta = { ...state.archivedMeta }

        for (const info of archivedThreads) {
          // If the thread is currently loaded in memory, remove it from tasks
          const task = tasks[info.id]
          if (task) {
            delete tasks[info.id]
          }
          // Add to archivedMeta so it still appears in the sidebar as archived
          archivedMeta[info.id] = {
            id: info.id,
            name: info.name,
            workspace: info.workspace,
            createdAt: info.createdAt,
            lastActivityAt: info.lastActivityAt,
            messageCount: info.messageCount,
            ...(info.parentTaskId ? { parentTaskId: info.parentTaskId } : {}),
            // Preserve worktree/project info from the in-memory task if available
            ...(task?.worktreePath ? { worktreePath: task.worktreePath } : {}),
            ...(task?.originalWorkspace ? { originalWorkspace: task.originalWorkspace } : {}),
            ...(task?.projectId ? { projectId: task.projectId } : {}),
          }
        }

        const selectedTaskId = staleIds.has(state.selectedTaskId ?? '') ? null : state.selectedTaskId
        return { tasks, archivedMeta, selectedTaskId }
      })

      // Notify the backend to clean up any lingering agent resources for these threads.
      for (const id of staleIds) {
        void ipc.deleteTask(id).catch(() => {})
      }

      get().persistHistory()
    }).catch((err) => {
      if (import.meta.env.DEV) console.warn('[autoArchive] backend call failed, skipping:', err)
    })
  },

  appendChunk: (taskId, chunk) =>
    set((state) => ({
      streamingChunks: {
        ...state.streamingChunks,
        [taskId]: joinChunk(state.streamingChunks[taskId] ?? '', chunk),
      },
    })),

  appendThinkingChunk: (taskId, chunk) =>
    set((state) => ({
      thinkingChunks: {
        ...state.thinkingChunks,
        [taskId]: joinChunk(state.thinkingChunks[taskId] ?? '', chunk),
      },
    })),

  upsertToolCall: (taskId, toolCall) =>
    set((state) => {
      const existing = state.liveToolCalls[taskId] ?? []
      const idx = existing.findIndex((tc) => tc.toolCallId === toolCall.toolCallId)
      if (idx >= 0
        && existing[idx].status === toolCall.status
        && existing[idx].content === toolCall.content
        && existing[idx].title === toolCall.title
        && existing[idx].kind === toolCall.kind
      ) {
        return state
      }
      // Stamp createdAt on first appearance so we can order tool calls
      // relative to text segments when rendering inline.
      const isNew = idx < 0
      const isTerminal = toolCall.status === 'completed' || toolCall.status === 'failed' || toolCall.status === 'cancelled'
      const now = new Date().toISOString()
      const stamped: ToolCall = isNew
        ? {
          ...toolCall,
          createdAt: toolCall.createdAt ?? now,
          // If the first sighting is already terminal (rare), stamp
          // completedAt so duration is accurate even when we miss the
          // pending → completed transition.
          ...(isTerminal && !toolCall.completedAt ? { completedAt: now } : {}),
        }
        : toolCall
      const updated = isNew
        ? [...existing, stamped]
        : existing.map((tc, i) => {
          if (i !== idx) return tc
          // Stamp completedAt the first time we see a terminal status so
          // fetch/web tool entries can show elapsed duration. Preserves
          // createdAt across updates.
          const completedAt =
            isTerminal && !tc.completedAt && !stamped.completedAt
              ? now
              : tc.completedAt ?? stamped.completedAt
          // Merge: spread existing first so fields not present in the
          // incoming update (e.g. `content` with diff stats) are preserved.
          return {
            ...tc,
            ...stamped,
            createdAt: tc.createdAt ?? stamped.createdAt,
            ...(completedAt ? { completedAt } : {}),
          }
        })
      // Record the streaming-text offset at which this tool call appeared.
      // Only recorded once per toolCallId, on first sight.
      let nextSplits = state.liveToolSplits
      if (isNew) {
        const at = state.streamingChunks[taskId]?.length ?? 0
        const existingSplits = state.liveToolSplits[taskId] ?? []
        nextSplits = {
          ...state.liveToolSplits,
          [taskId]: [...existingSplits, { at, toolCallId: toolCall.toolCallId }],
        }
      }
      return {
        liveToolCalls: { ...state.liveToolCalls, [taskId]: updated },
        liveToolSplits: nextSplits,
      }
    }),

  updatePlan: (taskId, plan) =>
    set((state) => {
      const task = state.tasks[taskId]
      if (!task || task.plan === plan) return state
      return {
        tasks: { ...state.tasks, [taskId]: { ...task, plan } },
      }
    }),

  updateUsage: (taskId, used, size) =>
    set((state) => {
      const task = state.tasks[taskId]
      if (!task) return state
      const cu = task.contextUsage
      if (cu && cu.used === used && cu.size === size) return state
      // Reset compaction status to idle when new usage arrives post-compaction
      const resetCompaction = task.compactionStatus === 'completed' || task.compactionStatus === 'failed'
      return {
        tasks: { ...state.tasks, [taskId]: { ...task, contextUsage: { used, size }, ...(resetCompaction ? { compactionStatus: 'idle' as const } : {}) } },
      }
    }),

  setThinkingLevel: (taskId, level) => {
    if (get().thinkingLevels[taskId] === level) return
    set((s) => ({ thinkingLevels: { ...s.thinkingLevels, [taskId]: level } }))
  },

  updateCompactionStatus: (taskId, status, _summary) => {
    set((state) => {
      const task = state.tasks[taskId]
      if (!task) return state
      if (task.compactionStatus === status) return state
      const messages = [...task.messages]
      if (status === 'compacting') {
        // Inject plan text so the backend summary includes it
        if (task.plan && task.plan.length > 0) {
          const planText = task.plan.map((s, i) => `${i + 1}. [${s.status}] ${s.content}`).join('\n')
          messages.push({
            role: 'system' as const,
            content: `${t('⏳ Compacting context...')}\n\n**${t('Plan to preserve:')}**\n${planText}`,
            timestamp: new Date().toISOString(),
          })
        } else {
          messages.push({
            role: 'system' as const,
            content: t('⏳ Compacting context...'),
            timestamp: new Date().toISOString(),
          })
        }
      } else if (status === 'completed') {
        const hasPlan = task.plan && task.plan.length > 0
        messages.push({
          role: 'system' as const,
          content: hasPlan ? t('✅ Context compacted — plan preserved') : t('✅ Context compacted'),
          timestamp: new Date().toISOString(),
        })
      } else if (status === 'failed') {
        messages.push({
          role: 'system' as const,
          content: t('⚠️ Context compaction failed'),
          timestamp: new Date().toISOString(),
        })
      }
      return {
        tasks: { ...state.tasks, [taskId]: { ...task, compactionStatus: status, messages } },
      }
    })
    get().persistHistory()
  },

  clearTurn: (taskId) =>
    set((state) => {
      const hasChunks = !!state.streamingChunks[taskId]
      const hasThinking = !!state.thinkingChunks[taskId]
      const hasTools = state.liveToolCalls[taskId]?.length > 0
      const hasSplits = (state.liveToolSplits[taskId]?.length ?? 0) > 0
      if (!hasChunks && !hasThinking && !hasTools && !hasSplits) return state
      return {
        streamingChunks: { ...state.streamingChunks, [taskId]: '' },
        thinkingChunks: { ...state.thinkingChunks, [taskId]: '' },
        liveToolCalls: { ...state.liveToolCalls, [taskId]: [] },
        liveToolSplits: { ...state.liveToolSplits, [taskId]: [] },
      }
    }),

  enqueueMessage: (taskId, message, attachments) =>
    set((state) => ({
      queuedMessages: {
        ...state.queuedMessages,
        [taskId]: [...(state.queuedMessages[taskId] ?? []), { text: message, attachments: attachments?.length ? attachments : undefined }],
      },
    })),

  dequeueMessages: (taskId) => {
    const msgs = get().queuedMessages[taskId] ?? []
    if (msgs.length > 0) {
      set((state) => ({
        queuedMessages: { ...state.queuedMessages, [taskId]: [] },
      }))
    }
    return msgs
  },

  removeQueuedMessage: (taskId, index) =>
    set((state) => {
      const queue = state.queuedMessages[taskId] ?? []
      if (index < 0 || index >= queue.length) return state
      return {
        queuedMessages: {
          ...state.queuedMessages,
          [taskId]: queue.filter((_, i) => i !== index),
        },
      }
    }),

  reorderQueuedMessage: (taskId, from, to) =>
    set((state) => {
      const queue = [...(state.queuedMessages[taskId] ?? [])]
      if (from < 0 || from >= queue.length || to < 0 || to >= queue.length) return state
      const [item] = queue.splice(from, 1)
      queue.splice(to, 0, item)
      return { queuedMessages: { ...state.queuedMessages, [taskId]: queue } }
    }),

  createDraftThread: (workspace) => {
    const id = crypto.randomUUID()
    const name = `Thread ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    const draft: AgentTask = {
      id,
      name,
      workspace,
      projectId: get().getProjectId(workspace),
      status: 'paused',
      createdAt: new Date().toISOString(),
      messages: [],
    }
    set((state) => ({
      tasks: { ...state.tasks, [id]: draft },
      selectedTaskId: id,
      activeSplitId: null,
      view: 'chat' as const,
      activityFeed: [
        { taskId: id, taskName: name, status: 'paused' as const, timestamp: draft.createdAt },
        ...state.activityFeed,
      ].slice(0, 20),
    }))
    get().persistHistory()
    return id
  },

  setPendingWorkspace: (workspace) => {
    set({
      pendingWorkspace: workspace,
      selectedTaskId: null,
      activeSplitId: null,
      view: 'chat' as const,
    })
    useSettingsStore.getState().setActiveWorkspace(workspace, workspace)
    useSettingsStore.setState({ currentModeId: 'code' })
    // Track in native Recent Projects menu
    if (workspace) {
      ipc.addRecentProject(workspace).then(() => ipc.rebuildRecentMenu()).catch(() => {})
    }
  },

  renameTask: (taskId, name) => {
    set((state) => {
      const task = state.tasks[taskId]
      if (!task || task.name === name) return state
      return { tasks: { ...state.tasks, [taskId]: { ...task, name } } }
    })
    get().persistHistory()
  },

  forkTask: async (taskId) => {
    if (get().isForking) return
    set({ isForking: true })
    try {
      const task = get().tasks[taskId]
      const forked = await ipc.forkTask(taskId, task?.workspace, task?.name, task?.sessionFile)
      // Backend sets parent_task_id; preserve worktree fields from parent so
      // the forked thread nests under the same project in the sidebar.
      if (task?.worktreePath) forked.worktreePath = task.worktreePath
      if (task?.originalWorkspace) forked.originalWorkspace = task.originalWorkspace
      forked.projectId = task?.projectId ?? get().getProjectId(task?.originalWorkspace ?? forked.workspace)
      set((state) => {
        const realWorkspace = forked.originalWorkspace ?? forked.workspace
        const projects = realWorkspace && !state.projects.includes(realWorkspace) && !isChatWorkspace(realWorkspace)
          ? [...state.projects, realWorkspace]
          : state.projects
        return {
          tasks: { ...state.tasks, [forked.id]: forked },
          selectedTaskId: forked.id,
          view: 'chat' as const,
          projects,
          isForking: false,
        }
      })
      get().persistHistory()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const { selectedTaskId, tasks, upsertTask } = get()
      const tid = selectedTaskId ?? taskId
      const task = tasks[tid]
      if (task) {
        upsertTask({
          ...task,
          messages: [...task.messages, { role: 'system', content: t('⚠️ Fork failed: {error}', { error: msg }), timestamp: new Date().toISOString() }],
        })
      }
      set({ isForking: false })
    }
  },

  reorderProject: (from, to) => {
    if (from === to) return
    set((state) => {
      const arr = [...state.projects]
      const [item] = arr.splice(from, 1)
      arr.splice(to, 0, item)
      return { projects: arr }
    })
    get().persistHistory()
  },

  reorderThread: (workspace, from, to) => {
    if (from === to) return
    set((state) => {
      const order = [...(state.threadOrders[workspace] ?? [])]
      if (from < 0 || from >= order.length || to < 0 || to >= order.length) return state
      const [item] = order.splice(from, 1)
      order.splice(to, 0, item)
      return { threadOrders: { ...state.threadOrders, [workspace]: order } }
    })
    get().persistHistory()
  },

  setDraft: (workspace, content) => {
    // Skip save if this workspace was just explicitly deleted (unmount flush guard)
    if (get()._suppressDraftSave === workspace) {
      set({ _suppressDraftSave: null })
      return
    }
    const trimmed = content.trim()
    if (!trimmed) {
      // Remove empty drafts
      const { [workspace]: _, ...rest } = get().drafts
      if (_ === undefined) return  // bail-out: nothing to remove
      set({ drafts: rest })
    } else {
      if (get().drafts[workspace] === content) return  // bail-out: no change
      set((s) => ({ drafts: { ...s.drafts, [workspace]: content } }))
    }
  },

  removeDraft: (workspace) => {
    if (get().drafts[workspace] === undefined) return
    set((s) => {
      const { [workspace]: _, ...rest } = s.drafts
      return {
        drafts: rest,
        // Suppress the next setDraft call for this workspace so the
        // PendingChat unmount flush doesn't resurrect the deleted draft
        _suppressDraftSave: workspace,
      }
    })
  },

  setDraftAttachments: (workspace, attachments) => {
    if (attachments.length === 0) {
      const { [workspace]: _, ...rest } = get().draftAttachments
      if (_ === undefined) return
      set({ draftAttachments: rest })
    } else {
      set((s) => ({ draftAttachments: { ...s.draftAttachments, [workspace]: attachments } }))
    }
  },

  setDraftPastedChunks: (workspace, chunks) => {
    if (chunks.length === 0) {
      const { [workspace]: _, ...rest } = get().draftPastedChunks
      if (_ === undefined) return
      set({ draftPastedChunks: rest })
    } else {
      set((s) => ({ draftPastedChunks: { ...s.draftPastedChunks, [workspace]: chunks } }))
    }
  },

  removeDraftAttachments: (workspace) => {
    if (get().draftAttachments[workspace] === undefined) return
    const { [workspace]: _, ...rest } = get().draftAttachments
    set({ draftAttachments: rest })
  },

  removeDraftPastedChunks: (workspace) => {
    if (get().draftPastedChunks[workspace] === undefined) return
    const { [workspace]: _, ...rest } = get().draftPastedChunks
    set({ draftPastedChunks: rest })
  },

  setDraftMentionedFiles: (workspace, files) => {
    if (files.length === 0) {
      const { [workspace]: _, ...rest } = get().draftMentionedFiles
      if (_ === undefined) return
      set({ draftMentionedFiles: rest })
    } else {
      set((s) => ({ draftMentionedFiles: { ...s.draftMentionedFiles, [workspace]: files } }))
    }
  },

  removeDraftMentionedFiles: (workspace) => {
    if (get().draftMentionedFiles[workspace] === undefined) return
    const { [workspace]: _, ...rest } = get().draftMentionedFiles
    set({ draftMentionedFiles: rest })
  },

  toggleTerminal: (taskId) => set((s) => {
    const next = new Set(s.terminalOpenTasks)
    if (next.has(taskId)) next.delete(taskId); else next.add(taskId)
    return { terminalOpenTasks: next }
  }),

  toggleWorkspaceTerminal: () => set((s) => ({ isWorkspaceTerminalOpen: !s.isWorkspaceTerminalOpen })),

  requestOpenTerminalAt: (taskId, cwd) => set((s) => {
    const prev = s.pendingTerminalRequests[taskId]
    const requestId = (prev?.requestId ?? 0) + 1
    const patch: Partial<TaskStore> = {
      pendingTerminalRequests: {
        ...s.pendingTerminalRequests,
        [taskId]: { taskId, cwd, requestId },
      },
    }
    // Auto-open the drawer if it's closed so the user sees the new tab.
    if (taskId === '__workspace__') {
      if (!s.isWorkspaceTerminalOpen) patch.isWorkspaceTerminalOpen = true
    } else if (!s.terminalOpenTasks.has(taskId)) {
      const next = new Set(s.terminalOpenTasks)
      next.add(taskId)
      patch.terminalOpenTasks = next
    }
    return patch
  }),

  consumeTerminalRequest: (taskId, requestId) => set((s) => {
    const cur = s.pendingTerminalRequests[taskId]
    // Only clear if the consumed request is still the latest — avoids
    // dropping a newer request that landed between dispatch and consume.
    if (!cur || cur.requestId !== requestId) return s
    const { [taskId]: _drop, ...rest } = s.pendingTerminalRequests
    return { pendingTerminalRequests: rest }
  }),

  setTaskMode: (taskId, modeId) => {
    if (get().taskModes[taskId] === modeId) return
    set((s) => ({ taskModes: { ...s.taskModes, [taskId]: modeId } }))
    get().persistUiState()
  },

  setTaskModel: (taskId, modelId) => {
    if (get().taskModels[taskId] === modelId) return
    set((s) => ({ taskModels: { ...s.taskModels, [taskId]: modelId } }))
    get().persistUiState()
  },

  loadTasks: async () => {
    try {
      const list = await ipc.listTasks()
      const tasks: Record<string, AgentTask> = Object.fromEntries(list.map((t) => [t.id, t]))

      // Load persisted history (archived threads from previous sessions).
      // We project to lightweight metadata only — never inflate full message
      // arrays into `tasks`. They're hydrated on demand when the user opens
      // an archived thread (see hydrateArchivedTask).
      try {
        const [savedThreads, savedProjects, savedSoftDeleted] = await Promise.all([
          historyStore.loadThreads(),
          historyStore.loadProjects(),
          historyStore.loadSoftDeleted(),
        ])
        const softDeletedIds = new Set(savedSoftDeleted.map((sd) => sd.task.id))
        const archivedMeta: Record<string, ArchivedThreadMeta> = {}
        const liveNeedingDb: string[] = []
        for (const saved of savedThreads) {
          if (softDeletedIds.has(saved.id)) continue
          if (tasks[saved.id]) {
            // Live task exists — merge worktree metadata the backend doesn't
            // track (without copying messages or other heavy fields).
            const live = tasks[saved.id]
            // If the live task has fewer messages than the persisted version,
            // the backend likely lost assistant responses on restart. Prefer
            // the richer persisted message history in that case.
            let savedMessages: TaskMessage[] | null = null
            const savedCount = saved.messageCount ?? saved.messages.length
            if (saved.messages.length === 0 && savedCount > live.messages.length) {
              // Thin entry with more history than the backend kept: the
              // messages live in SQLite now. Remember the id; hydrated in one
              // batch after the loop.
              liveNeedingDb.push(saved.id)
            } else if (saved.messages.length > live.messages.length) {
              savedMessages = saved.messages.map((m) => ({
                role: m.role as TaskMessage['role'],
                content: m.content,
                timestamp: m.timestamp,
                ...(m.thinking ? { thinking: m.thinking } : {}),
                ...(m.toolCalls && m.toolCalls.length > 0 ? { toolCalls: m.toolCalls } : {}),
                ...(m.toolCallSplits && m.toolCallSplits.length > 0 ? { toolCallSplits: m.toolCallSplits } : {}),
              }))
            }

            tasks[saved.id] = {
              ...live,
              ...(savedMessages ? { messages: savedMessages } : {}),
              ...(!live.worktreePath && saved.worktreePath ? { worktreePath: saved.worktreePath } : {}),
              ...(!live.originalWorkspace && saved.originalWorkspace ? { originalWorkspace: saved.originalWorkspace } : {}),
              ...(!live.projectId && saved.projectId ? { projectId: saved.projectId } : {}),
              ...(!live.parentTaskId && saved.parentTaskId ? { parentTaskId: saved.parentTaskId } : {}),
            }
          } else {
            archivedMeta[saved.id] = projectMeta(saved)
          }
        }
        // Derive projects AFTER merge so worktree tasks use restored originalWorkspace.
        // Start with saved project order, then append any new workspaces drawn
        // from live tasks AND archived metadata (so projects with only archived
        // threads still show up).
        const savedOrder = savedProjects.map((sp) => sp.workspace)
        const projectsSet = new Set(savedOrder)
        const projects = [...projectsSet]
        for (const t of Object.values(tasks)) {
          const ws = t.originalWorkspace ?? t.workspace
          if (!projectsSet.has(ws)) { projectsSet.add(ws); projects.push(ws) }
        }
        for (const m of Object.values(archivedMeta)) {
          const ws = m.originalWorkspace ?? m.workspace
          if (!projectsSet.has(ws)) { projectsSet.add(ws); projects.push(ws) }
        }
        // Merge project workspaces from history (already in savedOrder, but handle edge cases)
        for (const sp of savedProjects) {
          if (!projectsSet.has(sp.workspace)) { projectsSet.add(sp.workspace); projects.push(sp.workspace) }
        }
        // Restore project display names and projectIds
        const projectNames: Record<string, string> = {}
        const projectIds: Record<string, string> = {}
        for (const sp of savedProjects) {
          if (sp.displayName) projectNames[sp.workspace] = sp.displayName
          if (sp.projectId) projectIds[sp.workspace] = sp.projectId
        }
        // Generate UUIDs for projects that don't have one yet
        for (const ws of projects) {
          if (!projectIds[ws]) projectIds[ws] = crypto.randomUUID()
        }
        // Restore soft-deleted threads and rebuild deletedTaskIds guard
        const softDeleted: Record<string, import('@/types').SoftDeletedThread> = {}
        const deletedTaskIds = new Set<string>()
        for (const sd of savedSoftDeleted) {
          softDeleted[sd.task.id] = sd
          deletedTaskIds.add(sd.task.id)
          // Remove from tasks/meta so deleted threads don't appear in sidebar
          delete tasks[sd.task.id]
          delete archivedMeta[sd.task.id]
        }
        // Restore missing threads from backup (covers data lost during update relaunch).
        // Backup threads also become metadata — don't inflate them.
        try {
          const backup = await historyStore.loadBackup()
          if (backup.threads.length > 0) {
            for (const bt of backup.threads) {
              if (tasks[bt.id]) continue
              if (deletedTaskIds.has(bt.id)) continue
              if (archivedMeta[bt.id]) continue
              archivedMeta[bt.id] = projectMeta(bt)
            }
            for (const bp of backup.projects) {
              if (bp.displayName && !projectNames[bp.workspace]) projectNames[bp.workspace] = bp.displayName
              if (bp.projectId && !projectIds[bp.workspace]) projectIds[bp.workspace] = bp.projectId
              if (!projects.includes(bp.workspace) && !isChatWorkspace(bp.workspace)) projects.push(bp.workspace)
            }
            for (const sd of backup.softDeleted) {
              if (!softDeleted[sd.task.id] && !tasks[sd.task.id]) {
                softDeleted[sd.task.id] = sd
                deletedTaskIds.add(sd.task.id)
                delete archivedMeta[sd.task.id]
              }
            }
          }
        } catch { /* backup load is best-effort */ }
        // Never overwrite tasks that have an active session (running/paused) —
        // they have live messages, streaming chunks, and tool calls that would be lost.
        const existing = get().tasks
        for (const [id, t] of Object.entries(existing)) {
          if (t.status === 'running' || t.status === 'paused') {
            tasks[id] = t
            delete archivedMeta[id]
          }
        }
        // Preserve any archived threads the user has hydrated this session.
        for (const [id, t] of Object.entries(existing)) {
          if (t.isArchived && !tasks[id]) {
            tasks[id] = t
            delete archivedMeta[id]
          }
        }
        // Thin index entries for live threads: pull the conversation back out
        // of SQLite in one batch. This is the read half of the storage flip.
        await Promise.all(liveNeedingDb.map(async (id) => {
          try {
            const full = await threadDb.loadFullThread(id)
            if (full && tasks[id] && full.messages.length > tasks[id].messages.length) {
              tasks[id] = { ...tasks[id], messages: full.messages }
            }
          } catch {
            // The read failed, so this task sits in memory with zero messages.
            // Bar it from thin writes: saveThreads preserves its on-disk entry
            // verbatim instead of overwriting it with an empty shell.
            backfillPendingIds.add(id)
          }
        }))

        // Streaming crash recovery: replay the constant-size partial that the
        // mid-turn persist keeps per streaming thread, so a crash or dev
        // reload keeps the text that was on screen.
        try {
          const snapshots = await historyStore.loadStreamingSnapshots()
          // A completed turn supersedes its snapshot, but not by exact match:
          // the snapshot is up to 10 s stale while the final message carries
          // the flushed remainder. Prefix containment (either direction) is
          // the real "same turn" signal.
          const supersedes = (last: { role: string; content: string } | undefined, snapContent: string): boolean =>
            !!last && last.role === 'assistant'
            && (last.content.startsWith(snapContent) || snapContent.startsWith(last.content))
          const staleSnapshotIds: string[] = []
          for (const [id, snap] of Object.entries(snapshots)) {
            const t = tasks[id]
            if (!t) {
              // A real crash restart: the backend's in-memory task list is
              // empty, so the thread is only archived metadata. Recover the
              // partial into SQLite (the source of truth) — hydration will
              // surface it when the thread is opened.
              if (archivedMeta[id]) {
                const snapMsg: TaskMessage = {
                  role: 'assistant',
                  content: snap.content,
                  timestamp: snap.timestamp,
                  ...(snap.thinking ? { thinking: snap.thinking } : {}),
                  ...(snap.toolCalls?.length ? { toolCalls: snap.toolCalls as ToolCall[] } : {}),
                }
                threadDb.loadMessages(id).then((msgs) => {
                  if (supersedes(msgs[msgs.length - 1], snap.content)) return
                  return threadDb.saveMessage(id, snapMsg).then(() => {})
                }).catch(() => {})
                staleSnapshotIds.push(id)
              }
              continue
            }
            staleSnapshotIds.push(id)
            const last = t.messages[t.messages.length - 1]
            if (supersedes(last, snap.content)) continue
            tasks[id] = {
              ...t,
              messages: [...t.messages, {
                role: 'assistant',
                content: snap.content,
                timestamp: snap.timestamp,
                ...(snap.thinking ? { thinking: snap.thinking } : {}),
                ...(snap.toolCalls?.length ? { toolCalls: snap.toolCalls } : {}),
                ...(snap.toolCallSplits?.length ? { toolCallSplits: snap.toolCallSplits } : {}),
              }],
            }
          }
          // Replayed (or superseded) snapshots are spent — clear them so the
          // next reload doesn't append the same partial again.
          if (staleSnapshotIds.length > 0) {
            historyStore.saveStreamingSnapshots({}, new Set(staleSnapshotIds)).catch(() => {})
          }
        } catch { /* recovery is best-effort */ }

        // SQLite holds the message bodies and is the only store that survives a
        // damaged history.json. Fold in anything it knows about that the JSON
        // index does not, so a lost index costs a reload rather than the
        // conversations themselves.
        await mergeThreadsFromDb(archivedMeta, tasks, deletedTaskIds, projects)

        // Restore per-project thread ordering
        const threadOrders: Record<string, string[]> = {}
        for (const sp of savedProjects) {
          if (sp.threadOrder?.length) threadOrders[sp.workspace] = sp.threadOrder
        }
        set({ tasks, archivedMeta, projects: withoutChatDirs(projects), projectIds, projectNames, softDeleted, deletedTaskIds: capDeletedIds(deletedTaskIds), threadOrders, connected: true, historyLoaded: true })
        // One-time migration: sync JSON history threads into SQLite (background, best-effort).
        // This ensures all historical threads are available via the SQLite store going forward.
        threadDb.migrateFromJsonHistory(historyStore.loadThreads).then((result) => {
          if (result.migrated > 0) {
            console.info(`[thread-db] Migrated ${result.migrated} threads from JSON to SQLite (${result.skipped} already existed, ${result.failed} failed)`)
          }
          // Backfill is confirmed (or was already complete): from here on the
          // JSON index may be written thin. A failed migration leaves the flag
          // down and the legacy full format keeps flowing — safe, just big.
          if (result.failed === 0) {
            useTaskStore.setState({ sqliteReady: true })
          }
        }).catch(() => {})
      } catch (err) {
        // History load failed — derive projects from live tasks, filtering worktree paths.
        // `historyLoaded` deliberately stays false: we do not know what is on
        // disk, and the next autosave would write our partial view over it.
        console.error('[taskStore] history load failed — persistence disabled for this window', err)
        const projects = [...new Set(list.map((t) => t.originalWorkspace ?? t.workspace))]
        set({ tasks, projects: withoutChatDirs(projects), connected: true })
      }
    } catch {
      // Backend not available — try loading from history only.
      // Same lazy-meta strategy as the primary path: archived threads stay
      // as metadata in `archivedMeta` until the user opens one.
      try {
        const [savedThreads, savedProjects, savedSoftDeleted] = await Promise.all([
          historyStore.loadThreads(),
          historyStore.loadProjects(),
          historyStore.loadSoftDeleted(),
        ])
        const softDeletedIds = new Set(savedSoftDeleted.map((sd) => sd.task.id))
        const tasks: Record<string, AgentTask> = {}
        const archivedMeta: Record<string, ArchivedThreadMeta> = {}
        for (const saved of savedThreads) {
          if (softDeletedIds.has(saved.id)) continue
          archivedMeta[saved.id] = projectMeta(saved)
        }
        const projects = [...new Set(savedProjects.map((sp) => sp.workspace))]
        const projectNames: Record<string, string> = {}
        const projectIds: Record<string, string> = {}
        for (const sp of savedProjects) {
          if (sp.displayName) projectNames[sp.workspace] = sp.displayName
          if (sp.projectId) projectIds[sp.workspace] = sp.projectId
        }
        for (const ws of projects) {
          if (!projectIds[ws]) projectIds[ws] = crypto.randomUUID()
        }
        const softDeleted: Record<string, import('@/types').SoftDeletedThread> = {}
        const deletedTaskIds = new Set<string>()
        for (const sd of savedSoftDeleted) {
          softDeleted[sd.task.id] = sd
          deletedTaskIds.add(sd.task.id)
        }
        // Restore missing threads from backup (covers data lost during update relaunch)
        try {
          const backup = await historyStore.loadBackup()
          if (backup.threads.length > 0) {
            for (const bt of backup.threads) {
              if (deletedTaskIds.has(bt.id)) continue
              if (archivedMeta[bt.id]) continue
              archivedMeta[bt.id] = projectMeta(bt)
            }
            for (const bp of backup.projects) {
              if (bp.displayName && !projectNames[bp.workspace]) projectNames[bp.workspace] = bp.displayName
              if (bp.projectId && !projectIds[bp.workspace]) projectIds[bp.workspace] = bp.projectId
              if (!projects.includes(bp.workspace) && !isChatWorkspace(bp.workspace)) projects.push(bp.workspace)
            }
            for (const sd of backup.softDeleted) {
              if (!softDeleted[sd.task.id]) {
                softDeleted[sd.task.id] = sd
                deletedTaskIds.add(sd.task.id)
                delete archivedMeta[sd.task.id]
              }
            }
          }
        } catch { /* backup load is best-effort */ }
        // Preserve live + hydrated archived tasks (same guard as primary path)
        const existing = get().tasks
        for (const [id, t] of Object.entries(existing)) {
          if (t.status === 'running' || t.status === 'paused' || t.isArchived) {
            tasks[id] = t
            delete archivedMeta[id]
          }
        }
        await mergeThreadsFromDb(archivedMeta, tasks, deletedTaskIds, projects)

        // Restore per-project thread ordering
        const threadOrders: Record<string, string[]> = {}
        for (const sp of savedProjects) {
          if (sp.threadOrder?.length) threadOrders[sp.workspace] = sp.threadOrder
        }
        set({ tasks, archivedMeta, projects: withoutChatDirs(projects), projectIds, projectNames, softDeleted, deletedTaskIds, threadOrders, connected: false, historyLoaded: true })
      } catch {
        set({ connected: false })
      }
    }
  },

  hydrateArchivedTask: async (id) => {
    const state = get()
    if (state.tasks[id]) return true
    const meta = state.archivedMeta[id]
    if (!meta) return false
    try {
      // Try SQLite first (source of truth for message content)
      let task: AgentTask | null = null
      try {
        task = await threadDb.loadFullThread(id)
      } catch {
        // SQLite unavailable — fall through to JSON
      }

      // Fall back to JSON history store, then to the backup. `loadTasks` can
      // list a thread from the backup, so hydration has to be able to reach
      // the same place — otherwise clicking a restored thread finds nothing
      // and the row below deletes it from the sidebar.
      if (!task) {
        let saved = await historyStore.loadThread(id)
        if (!saved) {
          const backup = await historyStore.loadBackup().catch(() => null)
          saved = backup?.threads.find((t) => t.id === id) ?? null
        }
        if (!saved) {
          // Stale meta: drop it so the sidebar stops showing this thread
          set((s) => {
            if (!s.archivedMeta[id]) return s
            const { [id]: _drop, ...rest } = s.archivedMeta
            return { archivedMeta: rest }
          })
          return false
        }
        const messages: TaskMessage[] = saved.messages.map((m) => ({
          role: m.role as TaskMessage['role'],
          content: m.content,
          timestamp: m.timestamp,
          ...(m.thinking ? { thinking: m.thinking } : {}),
          ...(m.toolCalls && m.toolCalls.length > 0 ? { toolCalls: m.toolCalls } : {}),
          ...(m.toolCallSplits && m.toolCallSplits.length > 0 ? { toolCallSplits: m.toolCallSplits } : {}),
        }))
        task = {
          id: saved.id,
          name: saved.name,
          workspace: saved.workspace,
          status: 'completed',
          createdAt: saved.createdAt,
          messages,
          isArchived: true,
          ...(saved.parentTaskId ? { parentTaskId: saved.parentTaskId } : {}),
          ...(saved.worktreePath ? { worktreePath: saved.worktreePath } : {}),
          ...(saved.originalWorkspace ? { originalWorkspace: saved.originalWorkspace } : {}),
          ...(saved.projectId ? { projectId: saved.projectId } : {}),
        }
        // Backfill SQLite so future loads are faster and more reliable.
        // Save thread metadata first (required FK for messages), then the
        // messages in one batch. Until this resolves, the thread is barred
        // from thin index writes — thinning while the backfill is mid-flight
        // (or failed) would leave the messages in neither store.
        backfillPendingIds.add(id)
        const backfillTask = task
        threadDb.saveThread(backfillTask).then(() =>
          threadDb.saveAllMessages(backfillTask.id, backfillTask.messages),
        ).then(() => {
          backfillPendingIds.delete(id)
        }).catch((err) => {
          // Deliberately NOT removed from backfillPendingIds: the entry keeps
          // this thread on the legacy full-JSON format, which is where its
          // messages still live.
          console.warn(`[hydrateArchivedTask] SQLite backfill failed for ${id}:`, err)
        })
      }

      set((s) => {
        const { [id]: _drop, ...remainingMeta } = s.archivedMeta
        return { tasks: { ...s.tasks, [id]: task! }, archivedMeta: remainingMeta }
      })
      return true
    } catch {
      return false
    }
  },

  setConnected: (v) => {
    if (get().connected === v) return
    set({ connected: v })
  },

  setConnectionStatus: (status) => {
    set({ connectionStatus: status })
  },

  setDispatchSnapshot: (taskId, snapshot) => {
    set((s) => {
      if (snapshot) {
        return { dispatchSnapshots: { ...s.dispatchSnapshots, [taskId]: snapshot } }
      }
      // Bail out early if the taskId isn't in the map — avoids creating a
      // fresh object identity (and the spurious re-render that follows) for
      // every clear() call on an already-empty key.
      if (!(taskId in s.dispatchSnapshots)) return s
      const { [taskId]: _drop, ...rest } = s.dispatchSnapshots
      return { dispatchSnapshots: rest }
    })
  },

  rekeyDispatchSnapshot: (fromTaskId, toTaskId) => {
    // Atomically move the snapshot from `fromTaskId` to `toTaskId`. Used
    // after `ipc.createTask` returns a backend-assigned id so the snapshot
    // we recorded against the draft id follows the task. We do this in a
    // single setState so a concurrent `turn_end` listener can't observe a
    // half-applied state where the snapshot is missing from both keys.
    set((s) => {
      if (!(fromTaskId in s.dispatchSnapshots)) return s
      const { [fromTaskId]: snapshot, ...rest } = s.dispatchSnapshots
      // If `toTaskId` already has a snapshot (e.g. turn_end fired for the
      // new id while we were re-keying), keep the newer one — the old draft
      // snapshot is stale by definition.
      if (toTaskId in rest) {
        return { dispatchSnapshots: rest }
      }
      return {
        dispatchSnapshots: { ...rest, [toTaskId]: { ...snapshot, taskId: toTaskId } },
      }
    })
  },

  persistHistory: () => {
    const { tasks, projectNames, projectIds, softDeleted, projects, threadOrders, archivedMeta, streamingChunks, thinkingChunks, liveToolCalls, liveToolSplits, historyLoaded, sqliteReady } = get()
    // Writing before we know what is on disk deletes it. Agent events reach
    // every window, including one whose own load is still in flight, so this
    // guard is what stops a second window from erasing the archive.
    if (!historyLoaded) return
    // Tell saveThreads which on-disk archived ids to preserve verbatim.
    // Without this set, saveThreads would drop every archived thread that
    // isn't currently inflated in `tasks`.
    const keepArchivedIds = new Set(Object.keys(archivedMeta))

    // Threads whose messages are confirmed in SQLite are written as thin
    // index entries. Until the one-time backfill has finished this session,
    // everything stays in the legacy full format — thinning before the
    // messages are provably elsewhere would be data loss with extra steps.
    // Two per-thread exceptions: a thread whose own backfill is still in
    // flight is never thinned (its messages are not provably in SQLite yet),
    // and an intentionally /clear-ed thread is always thinned (its truncation
    // has already been written through).
    const thinIds: Set<string> = sqliteReady
      ? new Set(Object.keys(tasks).filter((id) => !backfillPendingIds.has(id)))
      : new Set()
    for (const id of intentionallyClearedIds) {
      if (tasks[id] && !backfillPendingIds.has(id)) thinIds.add(id)
    }

    // Streaming crash recovery: one constant-size partial message per
    // streaming thread, in its own store key. This replaces the old approach
    // of appending the partial into the thread blob, which re-serialized the
    // entire conversation every ten seconds mid-turn.
    const snapshots: Record<string, import('@/lib/history-store').SavedMessage> = {}
    // Events broadcast to every window, so a viewer window also accumulates
    // streamingChunks — but only the dispatching window owns the snapshot
    // lifecycle. Scoping both the writes and the clears to owned ids stops an
    // idle window's autosave from erasing the streaming window's partial.
    const ownedIds = snapshotOwnedIds()
    for (const [taskId, chunk] of Object.entries(streamingChunks)) {
      if (!chunk) continue
      if (!ownedIds.has(taskId)) continue
      const task = tasks[taskId]
      if (!task || task.status !== 'running') continue
      const thinking = thinkingChunks[taskId] ?? ''
      const tools = liveToolCalls[taskId] ?? []
      const splits = liveToolSplits[taskId] ?? []
      snapshots[taskId] = {
        role: 'assistant',
        content: chunk,
        timestamp: new Date().toISOString(),
        ...(thinking ? { thinking } : {}),
        ...(tools.length > 0 ? { toolCalls: tools } : {}),
        ...(splits.length > 0 ? { toolCallSplits: splits } : {}),
      }
    }
    // Written even when empty: turn end is what clears the previous snapshot
    // (for the threads this window owns — other windows' entries survive).
    historyStore.saveStreamingSnapshots(snapshots, ownedIds).catch(() => {})

    historyStore.saveThreads(tasks, projectNames, projectIds, projects, threadOrders, keepArchivedIds, thinIds).catch((err) => {
      console.warn('[persistHistory] saveThreads failed:', err)
    })
    historyStore.saveSoftDeleted(Object.values(softDeleted)).catch((err) => {
      console.warn('[persistHistory] saveSoftDeleted failed:', err)
    })
    // Also persist to SQLite for robust recovery (per-message granularity).
    // This runs in parallel with the JSON save — SQLite is the source of truth
    // for message content, JSON remains for project/ordering metadata.
    // Only save thread metadata here — individual messages are saved
    // incrementally by the turn-end and send handlers.
    for (const task of Object.values(tasks)) {
      if (task.messages.length === 0) continue
      threadDb.saveThread(task).catch(() => {})
    }
  },

  persistUiState: () => {
    const { selectedTaskId, view, splitViews, activeSplitId, pinnedThreadIds, taskModels, taskModes } = get()
    historyStore.saveUiState({
      selectedTaskId,
      view,
      sidePanelOpen: false,
      sidebarCollapsed: false,
      splitViews,
      activeSplitId,
      pinnedThreadIds,
      taskModels,
      taskModes,
    }).catch((err) => {
      console.warn('[persistUiState] failed:', err)
    })
  },

  clearHistory: async () => {
    // Cancel all running tasks first
    const currentTasks = get().tasks
    for (const [id, task] of Object.entries(currentTasks)) {
      if (task.status === 'running' || task.status === 'paused') {
        ipc.cancelTask(id).catch(() => {})
      }
    }
    // Clear the persisted thread/project store (includes uiState)
    await historyStore.clearHistory()
    // Clear the SQLite thread database
    await threadDb.clearAll().catch((err) => {
      console.warn('[clearHistory] Failed to clear SQLite thread DB:', err)
    })
    // Reset all in-memory state
    set({
      tasks: {},
      archivedMeta: {},
      projects: [],
      projectIds: {},
      projectNames: {},
      deletedTaskIds: new Set<string>(),
      softDeleted: {},
      selectedTaskId: null,
      pendingWorkspace: null,
      streamingChunks: {},
      thinkingChunks: {},
      liveToolCalls: {},
      liveToolSplits: {},
      dispatchSnapshots: {},
      queuedMessages: {},
      terminalOpenTasks: new Set<string>(),
      isWorkspaceTerminalOpen: false,
      pendingTerminalRequests: {},
      drafts: {},
      draftAttachments: {},
      draftPastedChunks: {},
      draftMentionedFiles: {},
      _suppressDraftSave: null,
      notifiedTaskIds: [],
      activityFeed: [],
      threadOrders: {},
      taskModes: {},
      taskModels: {},
      sessionIds: {},
      splitViews: [],
      pinnedThreadIds: [],
      activeSplitId: null,
      pendingSplitReplace: null,
      scrollPositions: {},
    })
    // Clear project-specific preferences but preserve core settings (onboarding, CLI path, model, etc.)
    const currentSettings = useSettingsStore.getState().settings
    const updatedSettings = { ...currentSettings, projectPrefs: {} }
    await useSettingsStore.getState().saveSettings(updatedSettings)
    useSettingsStore.setState({ settings: updatedSettings })
  },

  resolveWorktreeCleanup: (removeWorktree) => {
    const pending = get().worktreeCleanupPending
    if (!pending) return
    set({ worktreeCleanupPending: null })
    const { taskId, action, worktreePath, originalWorkspace } = pending
    // Proceed with the actual delete/archive
    if (action === 'archive') {
      const task = get().tasks[taskId]
      if (!task || task.isArchived) return
      void ipc.cancelTask(taskId).catch(() => {})
      set((s) => ({
        tasks: { ...s.tasks, [taskId]: { ...s.tasks[taskId], isArchived: true, status: 'completed' } },
        streamingChunks: { ...s.streamingChunks, [taskId]: '' },
        thinkingChunks: { ...s.thinkingChunks, [taskId]: '' },
        liveToolCalls: { ...s.liveToolCalls, [taskId]: [] },
        liveToolSplits: { ...s.liveToolSplits, [taskId]: [] },
      }))
      attempt(t('Could not delete the thread'), ipc.deleteTask(taskId))
    } else {
      void ipc.cancelTask(taskId).catch(() => {})
      attempt(t('Could not delete the thread'), ipc.deleteTask(taskId))
      set((state) => {
        const { [taskId]: removed, ...rest } = state.tasks
        const { [taskId]: _c, ...chunks } = state.streamingChunks
        const { [taskId]: _t, ...thinking } = state.thinkingChunks
        const { [taskId]: _tc, ...tools } = state.liveToolCalls
        const { [taskId]: _ts, ...splits } = state.liveToolSplits
        const { [taskId]: _m, ...modes } = state.taskModes
        const { [taskId]: _mdl, ...models } = state.taskModels
        const { [taskId]: _ds, ...remainingSnapshots } = state.dispatchSnapshots
        const deletedTaskIds = new Set(state.deletedTaskIds)
        deletedTaskIds.add(taskId)
        const softDeleted = {
          ...state.softDeleted,
          [taskId]: { task: { ...removed, isArchived: true, status: 'completed' as const }, deletedAt: new Date().toISOString() },
        }
        return {
          tasks: rest,
          streamingChunks: chunks,
          thinkingChunks: thinking,
          liveToolCalls: tools,
          liveToolSplits: splits,
          taskModes: modes,
          taskModels: models,
          dispatchSnapshots: remainingSnapshots,
          deletedTaskIds,
          softDeleted,
          selectedTaskId: state.selectedTaskId === taskId ? null : state.selectedTaskId,
        }
      })
    }
    if (removeWorktree) {
      // The user explicitly chose the destructive branch of the cleanup
      // dialog — a silent failure would leave a worktree they believe gone.
      attempt(t('Could not remove the worktree'), ipc.gitWorktreeRemove(originalWorkspace, worktreePath))
    }
    get().persistHistory()
  },

  enterBtwMode: (taskId, question) => {
    const task = get().tasks[taskId]
    if (!task) return
    set({ btwCheckpoint: { taskId, messages: [...task.messages], question } })
  },

  exitBtwMode: (keepTail) => {
    const checkpoint = get().btwCheckpoint
    if (!checkpoint) return
    const { taskId, messages: savedMessages } = checkpoint
    const task = get().tasks[taskId]
    if (!task) {
      set({ btwCheckpoint: null })
      return
    }
    const finalMessages = keepTail
      ? (() => {
          // Find the last user+assistant pair added after the checkpoint
          const newMessages = task.messages.slice(savedMessages.length)
          const lastUser = [...newMessages].reverse().find((m) => m.role === 'user')
          const lastAssistant = [...newMessages].reverse().find((m) => m.role === 'assistant')
          const tail = [lastUser, lastAssistant].filter(Boolean) as import('@/types').TaskMessage[]
          return [...savedMessages, ...tail]
        })()
      : [...savedMessages]
    set((s) => ({
      btwCheckpoint: null,
      tasks: { ...s.tasks, [taskId]: { ...task, messages: finalMessages } },
    }))
    // The tangent's discarded messages are a truncation like any other —
    // SQLite must agree or they resurrect on the next launch.
    attempt(t('Could not save the conversation'), threadDb.replaceMessages(taskId, finalMessages))
    get().persistHistory()
  },

  createSplitView: (left, right) => {
    const id = crypto.randomUUID()
    set((s) => ({
      splitViews: [...s.splitViews, { id, left, right, ratio: 0.5 }],
      activeSplitId: id,
      selectedTaskId: left,
      focusedPanel: 'left',
    }))
    return id
  },
  removeSplitView: (id) => {
    set((s) => ({
      splitViews: s.splitViews.filter((sv) => sv.id !== id),
      activeSplitId: s.activeSplitId === id ? null : s.activeSplitId,
    }))
  },
  replaceSplitThread: (splitId, side, threadId) => {
    set((s) => ({
      splitViews: s.splitViews.map((sv) =>
        sv.id === splitId ? { ...sv, [side]: threadId } : sv,
      ),
    }))
  },
  pinThread: (id) => {
    if (get().pinnedThreadIds.includes(id)) return
    set((s) => ({ pinnedThreadIds: [...s.pinnedThreadIds, id] }))
    get().persistHistory()
  },
  unpinThread: (id) => {
    if (!get().pinnedThreadIds.includes(id)) return
    set((s) => ({ pinnedThreadIds: s.pinnedThreadIds.filter((tid) => tid !== id) }))
    get().persistHistory()
  },
  setActiveSplit: (id) => {
    if (get().activeSplitId === id) return
    const sv = id ? get().splitViews.find((v) => v.id === id) : null
    set({
      activeSplitId: id,
      ...(sv ? { selectedTaskId: sv.left } : {}),
    })
  },
  setSplitRatio: (ratio) => {
    const clamped = Math.max(0.2, Math.min(0.8, ratio))
    const { activeSplitId } = get()
    if (!activeSplitId) return
    set((s) => ({
      splitViews: s.splitViews.map((sv) =>
        sv.id === activeSplitId ? { ...sv, ratio: clamped } : sv,
      ),
    }))
  },
  setFocusedPanel: (panel) => {
    if (get().focusedPanel === panel) return
    set({ focusedPanel: panel })
  },
  closeSplit: () => {
    if (!get().activeSplitId) return
    set({ activeSplitId: null })
  },
  saveScrollPosition: (taskId, scrollTop) => {
    if (scrollTop === null) {
      if (!(taskId in get().scrollPositions)) return
      set((s) => {
        const next = { ...s.scrollPositions }
        delete next[taskId]
        return { scrollPositions: next }
      })
      return
    }
    if (get().scrollPositions[taskId] === scrollTop) return
    set((s) => ({ scrollPositions: { ...s.scrollPositions, [taskId]: scrollTop } }))
  },

  rollbackToMessage: (taskId, messageIndex) => {
    // Keep messages up to and including the target assistant message —
    // rolling back "to here" means this turn is preserved and everything
    // after it is dropped.
    if (messageIndex < 0) return
    get().truncateFromMessage(taskId, messageIndex + 1)
  },

  truncateFromMessage: (taskId, messageIndex) => {
    const task = get().tasks[taskId]
    if (!task) return
    // `messageIndex === messages.length` is a permitted no-op truncation that
    // still clears streaming state (rollback of the final turn relies on it).
    if (messageIndex < 0 || messageIndex > task.messages.length) return
    const truncated = task.messages.slice(0, messageIndex)
    set((s) => ({
      tasks: {
        ...s.tasks,
        [taskId]: { ...task, messages: truncated },
      },
      // Drop any in-flight streaming state for this task — the truncate
      // invalidates whatever the agent was emitting.
      streamingChunks: { ...s.streamingChunks, [taskId]: '' },
      thinkingChunks: { ...s.thinkingChunks, [taskId]: '' },
      liveToolCalls: { ...s.liveToolCalls, [taskId]: [] },
      liveToolSplits: { ...s.liveToolSplits, [taskId]: [] },
    }))
    // Write the truncation through to SQLite (the source of truth) — without
    // this the dropped tail resurrects on the next launch, and anything sent
    // after the rollback lands out of order behind it.
    attempt(t('Could not save the conversation'), threadDb.replaceMessages(taskId, truncated))
    get().persistHistory()
  },

  regenerateTurn: (taskId, assistantMessageIndex) => {
    const task = get().tasks[taskId]
    if (!task || task.status === 'running') return
    // Find the user message that produced this assistant turn.
    const start = Math.min(assistantMessageIndex, task.messages.length) - 1
    let userIndex = -1
    for (let i = start; i >= 0; i--) {
      if (task.messages[i].role === 'user') {
        userIndex = i
        break
      }
    }
    if (userIndex < 0) return
    const content = task.messages[userIndex].content
    if (!content) return
    // Truncate to just before that user message, then re-dispatch its content
    // through the same send pipeline ChatPanel uses — the conversation is
    // identical up to this point, and a fresh answer streams in.
    get().truncateFromMessage(taskId, userIndex)
    void resendMessage(taskId, content)
  },
}))

