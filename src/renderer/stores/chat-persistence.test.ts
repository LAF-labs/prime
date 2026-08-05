/**
 * Tests for chat message persistence across app restarts.
 *
 * Covers the three fixes:
 * 1. loadFullThread returns null when SQLite has metadata but no messages
 * 2. UI state restoration handles archived threads (not just live tasks)
 * 3. persistHistory saves in-flight streaming chunks as partial messages
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSetActiveWorkspace } = vi.hoisted(() => ({
  mockSetActiveWorkspace: vi.fn(),
}))

vi.mock('@/lib/ipc', () => ({
  ipc: {
    cancelTask: vi.fn().mockResolvedValue(undefined),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    listTasks: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    forkTask: vi.fn().mockResolvedValue({ id: 'fork-1', name: 'Fork', workspace: '/ws', status: 'paused', createdAt: '', messages: [] }),
    gitWorktreeHasChanges: vi.fn().mockResolvedValue(false),
    gitWorktreeRemove: vi.fn().mockResolvedValue(undefined),
    addRecentProject: vi.fn().mockResolvedValue(undefined),
    rebuildRecentMenu: vi.fn().mockResolvedValue(undefined),
    threadDbAutoArchive: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('@/lib/history-store', () => ({
  loadThreads: vi.fn().mockResolvedValue([]),
  loadThread: vi.fn().mockResolvedValue(null),
  loadProjects: vi.fn().mockResolvedValue([]),
  loadSoftDeleted: vi.fn().mockResolvedValue([]),
  loadBackup: vi.fn().mockResolvedValue({ threads: [], projects: [], softDeleted: [] }),
  saveThreads: vi.fn().mockResolvedValue(undefined),
  saveSoftDeleted: vi.fn().mockResolvedValue(undefined),
  toArchivedTasks: vi.fn().mockReturnValue([]),
  clearHistory: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/thread-db', () => ({
  saveThread: vi.fn().mockResolvedValue(undefined),
  saveMessage: vi.fn().mockResolvedValue(undefined),
  saveAllMessages: vi.fn().mockResolvedValue(undefined),
  loadFullThread: vi.fn().mockResolvedValue(null),
  loadMessages: vi.fn().mockResolvedValue([]),
  migrateFromJsonHistory: vi.fn().mockResolvedValue({ migrated: 0, skipped: 0, failed: 0 }),
  clearAll: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./debugStore', () => ({
  useDebugStore: { getState: () => ({ addEntry: vi.fn() }) },
}))

vi.mock('./settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ settings: {}, saveSettings: vi.fn().mockResolvedValue(undefined), setActiveWorkspace: mockSetActiveWorkspace }),
    setState: vi.fn(),
  },
}))

vi.mock('./diffStore', () => ({
  useDiffStore: { getState: () => ({ fetchDiff: vi.fn() }) },
}))

vi.mock('./kiroStore', () => ({
  useKiroStore: { getState: () => ({ setMcpError: vi.fn() }) },
}))

import { useTaskStore } from './taskStore'
import * as historyStore from '@/lib/history-store'
import * as threadDb from '@/lib/thread-db'
import type { AgentTask, TaskMessage, ToolCall, ToolCallSplit } from '@/types'

const makeTask = (overrides?: Partial<AgentTask>): AgentTask => ({
  id: 'task-1',
  name: 'Test Task',
  workspace: '/projects/test',
  status: 'paused',
  createdAt: '2026-01-01T00:00:00Z',
  messages: [],
  ...overrides,
})

const makeMessage = (overrides?: Partial<TaskMessage>): TaskMessage => ({
  role: 'user',
  content: 'hello',
  timestamp: '2026-01-01T00:00:01Z',
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  useTaskStore.setState({
    tasks: {},
    projects: [],
    projectIds: {},
    projectNames: {},
    deletedTaskIds: new Set(),
    softDeleted: {},
    selectedTaskId: null,
    streamingChunks: {},
    thinkingChunks: {},
    liveToolCalls: {},
    liveToolSplits: {},
    queuedMessages: {},
    activityFeed: [],
    connected: false,
    archivedMeta: {},
    terminalOpenTasks: new Set(),
    pendingWorkspace: null,
    view: 'dashboard',
    isNewProjectOpen: false,
    isSettingsOpen: false,
    btwCheckpoint: null,
    splitViews: [],
    activeSplitId: null,
    focusedPanel: 'left' as const,
    scrollPositions: {},
    pinnedThreadIds: [],
    threadOrders: {},
  })
})


// ═══════════════════════════════════════════════════════════════════════════
// FIX 1: loadFullThread returns null when SQLite has metadata but no messages
// ═══════════════════════════════════════════════════════════════════════════

describe('hydrateArchivedTask — SQLite fallback to JSON', () => {
  it('falls through to JSON when SQLite has thread metadata but no messages', async () => {
    const archivedId = 'thread-no-sqlite-msgs'

    // SQLite returns null (our fix: loadFullThread returns null for empty messages)
    vi.mocked(threadDb.loadFullThread).mockResolvedValueOnce(null)

    // JSON history store has the full thread with messages
    vi.mocked(historyStore.loadThread).mockResolvedValueOnce({
      id: archivedId,
      name: 'Thread With History',
      workspace: '/ws',
      createdAt: '2026-01-01T00:00:00Z',
      messages: [
        { role: 'user', content: 'hello world', timestamp: '2026-01-01T00:00:01Z' },
        { role: 'assistant', content: 'hi there!', timestamp: '2026-01-01T00:00:02Z' },
      ],
    })

    // Seed archivedMeta
    useTaskStore.setState({
      archivedMeta: {
        [archivedId]: {
          id: archivedId,
          name: 'Thread With History',
          workspace: '/ws',
          createdAt: '2026-01-01T00:00:00Z',
          lastActivityAt: '2026-01-01T00:00:02Z',
          messageCount: 2,
        },
      },
    })

    const ok = await useTaskStore.getState().hydrateArchivedTask(archivedId)

    expect(ok).toBe(true)
    const hydrated = useTaskStore.getState().tasks[archivedId]
    expect(hydrated).toBeDefined()
    expect(hydrated.messages).toHaveLength(2)
    expect(hydrated.messages[0].content).toBe('hello world')
    expect(hydrated.messages[1].content).toBe('hi there!')
    expect(hydrated.isArchived).toBe(true)
  })

  it('uses SQLite data when messages exist there', async () => {
    const archivedId = 'thread-with-sqlite-msgs'

    // SQLite returns a full thread with messages
    vi.mocked(threadDb.loadFullThread).mockResolvedValueOnce({
      id: archivedId,
      name: 'SQLite Thread',
      workspace: '/ws',
      status: 'completed',
      createdAt: '2026-01-01T00:00:00Z',
      messages: [
        { role: 'user', content: 'from sqlite', timestamp: '2026-01-01T00:00:01Z' },
        { role: 'assistant', content: 'sqlite response', timestamp: '2026-01-01T00:00:02Z' },
      ],
      isArchived: true,
    })

    useTaskStore.setState({
      archivedMeta: {
        [archivedId]: {
          id: archivedId,
          name: 'SQLite Thread',
          workspace: '/ws',
          createdAt: '2026-01-01T00:00:00Z',
          lastActivityAt: '2026-01-01T00:00:02Z',
          messageCount: 2,
        },
      },
    })

    const ok = await useTaskStore.getState().hydrateArchivedTask(archivedId)

    expect(ok).toBe(true)
    const hydrated = useTaskStore.getState().tasks[archivedId]
    expect(hydrated.messages[0].content).toBe('from sqlite')
    // Should NOT have called JSON fallback
    expect(historyStore.loadThread).not.toHaveBeenCalled()
  })

  it('returns false and drops stale meta when both SQLite and JSON have no data', async () => {
    const archivedId = 'stale-thread'

    vi.mocked(threadDb.loadFullThread).mockResolvedValueOnce(null)
    vi.mocked(historyStore.loadThread).mockResolvedValueOnce(null)

    useTaskStore.setState({
      archivedMeta: {
        [archivedId]: {
          id: archivedId,
          name: 'Stale Thread',
          workspace: '/ws',
          createdAt: '2026-01-01T00:00:00Z',
          lastActivityAt: '2026-01-01T00:00:00Z',
          messageCount: 0,
        },
      },
    })

    const ok = await useTaskStore.getState().hydrateArchivedTask(archivedId)

    expect(ok).toBe(false)
    // Stale meta should be removed from archivedMeta
    expect(useTaskStore.getState().archivedMeta[archivedId]).toBeUndefined()
  })

  it('returns false gracefully when SQLite throws and JSON has no data', async () => {
    const archivedId = 'error-thread'

    vi.mocked(threadDb.loadFullThread).mockRejectedValueOnce(new Error('SQLite unavailable'))
    vi.mocked(historyStore.loadThread).mockResolvedValueOnce(null)

    useTaskStore.setState({
      archivedMeta: {
        [archivedId]: {
          id: archivedId,
          name: 'Error Thread',
          workspace: '/ws',
          createdAt: '2026-01-01T00:00:00Z',
          lastActivityAt: '2026-01-01T00:00:00Z',
          messageCount: 1,
        },
      },
    })

    const ok = await useTaskStore.getState().hydrateArchivedTask(archivedId)

    expect(ok).toBe(false)
    expect(useTaskStore.getState().archivedMeta[archivedId]).toBeUndefined()
  })

  it('falls through to JSON when SQLite throws, and JSON has messages', async () => {
    const archivedId = 'sqlite-error-json-ok'

    vi.mocked(threadDb.loadFullThread).mockRejectedValueOnce(new Error('DB locked'))
    vi.mocked(historyStore.loadThread).mockResolvedValueOnce({
      id: archivedId,
      name: 'Recovered Thread',
      workspace: '/ws',
      createdAt: '2026-01-01T00:00:00Z',
      messages: [
        { role: 'user', content: 'recovered message', timestamp: '2026-01-01T00:00:01Z' },
      ],
    })

    useTaskStore.setState({
      archivedMeta: {
        [archivedId]: {
          id: archivedId,
          name: 'Recovered Thread',
          workspace: '/ws',
          createdAt: '2026-01-01T00:00:00Z',
          lastActivityAt: '2026-01-01T00:00:01Z',
          messageCount: 1,
        },
      },
    })

    const ok = await useTaskStore.getState().hydrateArchivedTask(archivedId)

    expect(ok).toBe(true)
    const hydrated = useTaskStore.getState().tasks[archivedId]
    expect(hydrated.messages).toHaveLength(1)
    expect(hydrated.messages[0].content).toBe('recovered message')
  })

  it('no-ops when task is already hydrated in tasks map', async () => {
    const taskId = 'already-hydrated'

    useTaskStore.setState({
      tasks: {
        [taskId]: makeTask({ id: taskId, messages: [makeMessage()] }),
      },
    })

    const ok = await useTaskStore.getState().hydrateArchivedTask(taskId)

    expect(ok).toBe(true)
    // Should not have called any persistence layer
    expect(threadDb.loadFullThread).not.toHaveBeenCalled()
    expect(historyStore.loadThread).not.toHaveBeenCalled()
  })

  it('returns false when id is not in archivedMeta', async () => {
    const ok = await useTaskStore.getState().hydrateArchivedTask('nonexistent')
    expect(ok).toBe(false)
    expect(threadDb.loadFullThread).not.toHaveBeenCalled()
  })

  it('removes thread from archivedMeta after successful hydration', async () => {
    const archivedId = 'to-hydrate'

    vi.mocked(threadDb.loadFullThread).mockResolvedValueOnce({
      id: archivedId,
      name: 'Hydrating',
      workspace: '/ws',
      status: 'completed',
      createdAt: '2026-01-01T00:00:00Z',
      messages: [makeMessage()],
      isArchived: true,
    })

    useTaskStore.setState({
      archivedMeta: {
        [archivedId]: {
          id: archivedId,
          name: 'Hydrating',
          workspace: '/ws',
          createdAt: '2026-01-01T00:00:00Z',
          lastActivityAt: '2026-01-01T00:00:01Z',
          messageCount: 1,
        },
        'other-thread': {
          id: 'other-thread',
          name: 'Other',
          workspace: '/ws',
          createdAt: '2026-01-01T00:00:00Z',
          lastActivityAt: '2026-01-01T00:00:00Z',
          messageCount: 3,
        },
      },
    })

    await useTaskStore.getState().hydrateArchivedTask(archivedId)

    expect(useTaskStore.getState().archivedMeta[archivedId]).toBeUndefined()
    // Other archived threads should be preserved
    expect(useTaskStore.getState().archivedMeta['other-thread']).toBeDefined()
  })

  it('preserves worktreePath and originalWorkspace from JSON fallback', async () => {
    const archivedId = 'worktree-thread'

    vi.mocked(threadDb.loadFullThread).mockResolvedValueOnce(null)
    vi.mocked(historyStore.loadThread).mockResolvedValueOnce({
      id: archivedId,
      name: 'Worktree Thread',
      workspace: '/ws/.kiro/worktrees/feat',
      createdAt: '2026-01-01T00:00:00Z',
      messages: [makeMessage()],
      worktreePath: '/ws/.kiro/worktrees/feat',
      originalWorkspace: '/ws',
      projectId: 'proj-1',
      parentTaskId: 'parent-1',
    })

    useTaskStore.setState({
      archivedMeta: {
        [archivedId]: {
          id: archivedId,
          name: 'Worktree Thread',
          workspace: '/ws/.kiro/worktrees/feat',
          createdAt: '2026-01-01T00:00:00Z',
          lastActivityAt: '2026-01-01T00:00:01Z',
          messageCount: 1,
          worktreePath: '/ws/.kiro/worktrees/feat',
          originalWorkspace: '/ws',
          projectId: 'proj-1',
          parentTaskId: 'parent-1',
        },
      },
    })

    await useTaskStore.getState().hydrateArchivedTask(archivedId)

    const hydrated = useTaskStore.getState().tasks[archivedId]
    expect(hydrated.worktreePath).toBe('/ws/.kiro/worktrees/feat')
    expect(hydrated.originalWorkspace).toBe('/ws')
    expect(hydrated.projectId).toBe('proj-1')
    expect(hydrated.parentTaskId).toBe('parent-1')
  })

  it('triggers SQLite backfill when loading from JSON fallback', async () => {
    const archivedId = 'backfill-thread'

    vi.mocked(threadDb.loadFullThread).mockResolvedValueOnce(null)
    vi.mocked(historyStore.loadThread).mockResolvedValueOnce({
      id: archivedId,
      name: 'Backfill Thread',
      workspace: '/ws',
      createdAt: '2026-01-01T00:00:00Z',
      messages: [
        { role: 'user', content: 'msg1', timestamp: '2026-01-01T00:00:01Z' },
        { role: 'assistant', content: 'msg2', timestamp: '2026-01-01T00:00:02Z' },
      ],
    })

    useTaskStore.setState({
      archivedMeta: {
        [archivedId]: {
          id: archivedId,
          name: 'Backfill Thread',
          workspace: '/ws',
          createdAt: '2026-01-01T00:00:00Z',
          lastActivityAt: '2026-01-01T00:00:02Z',
          messageCount: 2,
        },
      },
    })

    await useTaskStore.getState().hydrateArchivedTask(archivedId)

    // Should have triggered SQLite backfill (saveThread + saveAllMessages)
    // These are fire-and-forget, so we just check they were called
    await vi.waitFor(() => {
      expect(threadDb.saveThread).toHaveBeenCalled()
    })
  })
})


// ═══════════════════════════════════════════════════════════════════════════
// FIX 2: setSelectedTask triggers hydration for archived threads
// ═══════════════════════════════════════════════════════════════════════════

describe('setSelectedTask — archived thread hydration', () => {
  it('triggers hydration when selecting a thread only in archivedMeta', async () => {
    const archivedId = 'archived-select'

    vi.mocked(threadDb.loadFullThread).mockResolvedValueOnce({
      id: archivedId,
      name: 'Archived Thread',
      workspace: '/ws',
      status: 'completed',
      createdAt: '2026-01-01T00:00:00Z',
      messages: [makeMessage({ content: 'restored' })],
      isArchived: true,
    })

    useTaskStore.setState({
      archivedMeta: {
        [archivedId]: {
          id: archivedId,
          name: 'Archived Thread',
          workspace: '/ws',
          createdAt: '2026-01-01T00:00:00Z',
          lastActivityAt: '2026-01-01T00:00:01Z',
          messageCount: 1,
        },
      },
    })

    useTaskStore.getState().setSelectedTask(archivedId)

    // selectedTaskId should be set immediately
    expect(useTaskStore.getState().selectedTaskId).toBe(archivedId)

    // Wait for async hydration to complete
    await vi.waitFor(() => {
      expect(useTaskStore.getState().tasks[archivedId]).toBeDefined()
    })

    expect(useTaskStore.getState().tasks[archivedId].messages[0].content).toBe('restored')
  })

  it('does not re-hydrate when task already exists in tasks map', () => {
    const taskId = 'live-task'

    useTaskStore.setState({
      tasks: {
        [taskId]: makeTask({ id: taskId, messages: [makeMessage()] }),
      },
    })

    useTaskStore.getState().setSelectedTask(taskId)

    expect(useTaskStore.getState().selectedTaskId).toBe(taskId)
    expect(threadDb.loadFullThread).not.toHaveBeenCalled()
  })

  it('does nothing special when selecting null', () => {
    useTaskStore.setState({ selectedTaskId: 'some-task' })
    useTaskStore.getState().setSelectedTask(null)
    expect(useTaskStore.getState().selectedTaskId).toBeNull()
    expect(threadDb.loadFullThread).not.toHaveBeenCalled()
  })

  it('does nothing when selecting a thread not in tasks or archivedMeta', () => {
    useTaskStore.getState().setSelectedTask('ghost-thread')
    // selectedTaskId is still set (UI shows empty state)
    expect(threadDb.loadFullThread).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// FIX 3: persistHistory saves in-flight streaming chunks
// ═══════════════════════════════════════════════════════════════════════════

describe('persistHistory — streaming chunk preservation', () => {
  it('includes streaming chunk as partial assistant message in saved data', () => {
    const taskId = 'streaming-task'

    useTaskStore.setState({
      tasks: {
        [taskId]: makeTask({
          id: taskId,
          status: 'running',
          messages: [makeMessage({ role: 'user', content: 'do something' })],
        }),
      },
      streamingChunks: { [taskId]: 'partial response so far...' },
      thinkingChunks: {},
      liveToolCalls: {},
      liveToolSplits: {},
      archivedMeta: {},
      projects: ['/projects/test'],
      projectNames: {},
      projectIds: { '/projects/test': 'p1' },
      softDeleted: {},
      threadOrders: {},
    })

    useTaskStore.getState().persistHistory()

    // saveThreads should have been called with the streaming chunk appended
    expect(historyStore.saveThreads).toHaveBeenCalledTimes(1)
    const savedTasks = vi.mocked(historyStore.saveThreads).mock.calls[0][0]
    const savedTask = savedTasks[taskId]
    expect(savedTask.messages).toHaveLength(2)
    expect(savedTask.messages[1].role).toBe('assistant')
    expect(savedTask.messages[1].content).toBe('partial response so far...')
  })

  it('includes thinking chunks in the partial assistant message', () => {
    const taskId = 'thinking-task'

    useTaskStore.setState({
      tasks: {
        [taskId]: makeTask({
          id: taskId,
          status: 'running',
          messages: [makeMessage({ role: 'user', content: 'think about this' })],
        }),
      },
      streamingChunks: { [taskId]: 'response text' },
      thinkingChunks: { [taskId]: 'internal reasoning...' },
      liveToolCalls: {},
      liveToolSplits: {},
      archivedMeta: {},
      projects: ['/projects/test'],
      projectNames: {},
      projectIds: { '/projects/test': 'p1' },
      softDeleted: {},
      threadOrders: {},
    })

    useTaskStore.getState().persistHistory()

    const savedTasks = vi.mocked(historyStore.saveThreads).mock.calls[0][0]
    const partialMsg = savedTasks[taskId].messages[1]
    expect(partialMsg.thinking).toBe('internal reasoning...')
  })

  it('includes live tool calls in the partial assistant message', () => {
    const taskId = 'tool-task'
    const toolCall: ToolCall = {
      toolCallId: 'tc-1',
      title: 'Edit file',
      kind: 'edit',
      status: 'in_progress',
      locations: [{ path: 'src/main.ts' }],
    }
    const toolSplit: ToolCallSplit = { toolCallId: 'tc-1', at: 10 }

    useTaskStore.setState({
      tasks: {
        [taskId]: makeTask({
          id: taskId,
          status: 'running',
          messages: [makeMessage({ role: 'user', content: 'edit the file' })],
        }),
      },
      streamingChunks: { [taskId]: 'I will edit' },
      thinkingChunks: {},
      liveToolCalls: { [taskId]: [toolCall] },
      liveToolSplits: { [taskId]: [toolSplit] },
      archivedMeta: {},
      projects: ['/projects/test'],
      projectNames: {},
      projectIds: { '/projects/test': 'p1' },
      softDeleted: {},
      threadOrders: {},
    })

    useTaskStore.getState().persistHistory()

    const savedTasks = vi.mocked(historyStore.saveThreads).mock.calls[0][0]
    const partialMsg = savedTasks[taskId].messages[1]
    expect(partialMsg.toolCalls).toHaveLength(1)
    expect(partialMsg.toolCalls![0].toolCallId).toBe('tc-1')
    expect(partialMsg.toolCallSplits).toHaveLength(1)
    expect(partialMsg.toolCallSplits![0].at).toBe(10)
  })

  it('does not append partial message when streaming chunk is empty', () => {
    const taskId = 'no-chunk-task'

    useTaskStore.setState({
      tasks: {
        [taskId]: makeTask({
          id: taskId,
          status: 'running',
          messages: [makeMessage({ role: 'user', content: 'waiting' })],
        }),
      },
      streamingChunks: { [taskId]: '' },
      thinkingChunks: {},
      liveToolCalls: {},
      liveToolSplits: {},
      archivedMeta: {},
      projects: ['/projects/test'],
      projectNames: {},
      projectIds: { '/projects/test': 'p1' },
      softDeleted: {},
      threadOrders: {},
    })

    useTaskStore.getState().persistHistory()

    const savedTasks = vi.mocked(historyStore.saveThreads).mock.calls[0][0]
    expect(savedTasks[taskId].messages).toHaveLength(1) // only the user message
  })

  it('does not append partial message for non-running tasks', () => {
    const taskId = 'paused-task'

    useTaskStore.setState({
      tasks: {
        [taskId]: makeTask({
          id: taskId,
          status: 'paused',
          messages: [makeMessage({ role: 'user', content: 'done' })],
        }),
      },
      streamingChunks: { [taskId]: 'leftover chunk' },
      thinkingChunks: {},
      liveToolCalls: {},
      liveToolSplits: {},
      archivedMeta: {},
      projects: ['/projects/test'],
      projectNames: {},
      projectIds: { '/projects/test': 'p1' },
      softDeleted: {},
      threadOrders: {},
    })

    useTaskStore.getState().persistHistory()

    const savedTasks = vi.mocked(historyStore.saveThreads).mock.calls[0][0]
    expect(savedTasks[taskId].messages).toHaveLength(1)
  })

  it('does not mutate the original tasks in the store', () => {
    const taskId = 'immutable-task'
    const originalMessages = [makeMessage({ role: 'user', content: 'original' })]

    useTaskStore.setState({
      tasks: {
        [taskId]: makeTask({
          id: taskId,
          status: 'running',
          messages: originalMessages,
        }),
      },
      streamingChunks: { [taskId]: 'streaming...' },
      thinkingChunks: {},
      liveToolCalls: {},
      liveToolSplits: {},
      archivedMeta: {},
      projects: ['/projects/test'],
      projectNames: {},
      projectIds: { '/projects/test': 'p1' },
      softDeleted: {},
      threadOrders: {},
    })

    useTaskStore.getState().persistHistory()

    // Original store state should be unchanged
    const storeTask = useTaskStore.getState().tasks[taskId]
    expect(storeTask.messages).toHaveLength(1)
    expect(storeTask.messages).toBe(originalMessages) // same reference
  })

  it('handles multiple tasks with different streaming states', () => {
    const runningId = 'running-1'
    const pausedId = 'paused-1'
    const completedId = 'completed-1'

    useTaskStore.setState({
      tasks: {
        [runningId]: makeTask({
          id: runningId,
          status: 'running',
          messages: [makeMessage({ role: 'user', content: 'q1' })],
        }),
        [pausedId]: makeTask({
          id: pausedId,
          status: 'paused',
          messages: [
            makeMessage({ role: 'user', content: 'q2' }),
            makeMessage({ role: 'assistant', content: 'a2', timestamp: '2026-01-01T00:00:02Z' }),
          ],
        }),
        [completedId]: makeTask({
          id: completedId,
          status: 'completed',
          messages: [
            makeMessage({ role: 'user', content: 'q3' }),
            makeMessage({ role: 'assistant', content: 'a3', timestamp: '2026-01-01T00:00:02Z' }),
          ],
        }),
      },
      streamingChunks: {
        [runningId]: 'streaming for running',
        [pausedId]: 'stale chunk for paused',
        [completedId]: 'stale chunk for completed',
      },
      thinkingChunks: {},
      liveToolCalls: {},
      liveToolSplits: {},
      archivedMeta: {},
      projects: ['/projects/test'],
      projectNames: {},
      projectIds: { '/projects/test': 'p1' },
      softDeleted: {},
      threadOrders: {},
    })

    useTaskStore.getState().persistHistory()

    const savedTasks = vi.mocked(historyStore.saveThreads).mock.calls[0][0]
    // Only the running task should have the partial message appended
    expect(savedTasks[runningId].messages).toHaveLength(2)
    expect(savedTasks[runningId].messages[1].content).toBe('streaming for running')
    // Paused and completed should NOT have extra messages
    expect(savedTasks[pausedId].messages).toHaveLength(2)
    expect(savedTasks[completedId].messages).toHaveLength(2)
  })

  it('still saves thread metadata to SQLite for tasks with messages', () => {
    const taskId = 'sqlite-meta-task'

    useTaskStore.setState({
      tasks: {
        [taskId]: makeTask({
          id: taskId,
          status: 'running',
          messages: [makeMessage({ role: 'user', content: 'hi' })],
        }),
      },
      streamingChunks: { [taskId]: 'chunk' },
      thinkingChunks: {},
      liveToolCalls: {},
      liveToolSplits: {},
      archivedMeta: {},
      projects: ['/projects/test'],
      projectNames: {},
      projectIds: { '/projects/test': 'p1' },
      softDeleted: {},
      threadOrders: {},
    })

    useTaskStore.getState().persistHistory()

    // SQLite saveThread should be called with the original task (not the one with partial msg)
    expect(threadDb.saveThread).toHaveBeenCalledWith(
      expect.objectContaining({ id: taskId }),
    )
  })

  it('handles task with no streaming chunk key at all', () => {
    const taskId = 'no-key-task'

    useTaskStore.setState({
      tasks: {
        [taskId]: makeTask({
          id: taskId,
          status: 'running',
          messages: [makeMessage({ role: 'user', content: 'hi' })],
        }),
      },
      streamingChunks: {}, // no entry for this task
      thinkingChunks: {},
      liveToolCalls: {},
      liveToolSplits: {},
      archivedMeta: {},
      projects: ['/projects/test'],
      projectNames: {},
      projectIds: { '/projects/test': 'p1' },
      softDeleted: {},
      threadOrders: {},
    })

    useTaskStore.getState().persistHistory()

    const savedTasks = vi.mocked(historyStore.saveThreads).mock.calls[0][0]
    expect(savedTasks[taskId].messages).toHaveLength(1) // no partial appended
  })
})


// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO: Full dev restart simulation
// ═══════════════════════════════════════════════════════════════════════════

describe('dev restart scenario — end-to-end', () => {
  it('simulates: streaming → dev restart → messages restored from JSON', async () => {
    // PHASE 1: Simulate a running task with streaming content
    const taskId = 'dev-restart-thread'

    useTaskStore.setState({
      tasks: {
        [taskId]: makeTask({
          id: taskId,
          status: 'running',
          messages: [
            makeMessage({ role: 'user', content: 'build a feature' }),
            makeMessage({ role: 'assistant', content: 'first response', timestamp: '2026-01-01T00:00:02Z' }),
          ],
        }),
      },
      streamingChunks: { [taskId]: 'partial second response...' },
      thinkingChunks: { [taskId]: 'thinking about it' },
      liveToolCalls: {},
      liveToolSplits: {},
      archivedMeta: {},
      projects: ['/projects/test'],
      projectNames: {},
      projectIds: { '/projects/test': 'p1' },
      softDeleted: {},
      threadOrders: {},
    })

    // persistHistory is called (mid-turn persist or before-unload)
    useTaskStore.getState().persistHistory()

    // Verify the saved data includes the partial message
    const savedTasks = vi.mocked(historyStore.saveThreads).mock.calls[0][0]
    expect(savedTasks[taskId].messages).toHaveLength(3)
    expect(savedTasks[taskId].messages[2].content).toBe('partial second response...')
    expect(savedTasks[taskId].messages[2].thinking).toBe('thinking about it')

    // PHASE 2: Simulate app restart — backend returns empty, frontend loads from history
    vi.clearAllMocks()

    // Reset store to simulate fresh start
    useTaskStore.setState({
      tasks: {},
      archivedMeta: {},
      streamingChunks: {},
      thinkingChunks: {},
      liveToolCalls: {},
      liveToolSplits: {},
      projects: [],
      projectNames: {},
      projectIds: {},
      softDeleted: {},
      threadOrders: {},
      selectedTaskId: null,
    })

    // SQLite has metadata but no messages (migration incomplete)
    vi.mocked(threadDb.loadFullThread).mockResolvedValueOnce(null)

    // JSON history has the full thread (including the partial message from phase 1)
    vi.mocked(historyStore.loadThread).mockResolvedValueOnce({
      id: taskId,
      name: 'Test Task',
      workspace: '/projects/test',
      createdAt: '2026-01-01T00:00:00Z',
      messages: [
        { role: 'user', content: 'build a feature', timestamp: '2026-01-01T00:00:01Z' },
        { role: 'assistant', content: 'first response', timestamp: '2026-01-01T00:00:02Z' },
        { role: 'assistant', content: 'partial second response...', timestamp: '2026-01-01T00:00:03Z', thinking: 'thinking about it' },
      ],
    })

    // Seed archivedMeta as loadTasks would after restart
    useTaskStore.setState({
      archivedMeta: {
        [taskId]: {
          id: taskId,
          name: 'Test Task',
          workspace: '/projects/test',
          createdAt: '2026-01-01T00:00:00Z',
          lastActivityAt: '2026-01-01T00:00:03Z',
          messageCount: 3,
        },
      },
    })

    // PHASE 3: User selects the thread → hydration kicks in
    useTaskStore.getState().setSelectedTask(taskId)

    // Wait for hydration
    await vi.waitFor(() => {
      expect(useTaskStore.getState().tasks[taskId]).toBeDefined()
    })

    const hydrated = useTaskStore.getState().tasks[taskId]
    expect(hydrated.messages).toHaveLength(3)
    expect(hydrated.messages[0].content).toBe('build a feature')
    expect(hydrated.messages[1].content).toBe('first response')
    expect(hydrated.messages[2].content).toBe('partial second response...')
    expect(hydrated.messages[2].thinking).toBe('thinking about it')
    expect(hydrated.isArchived).toBe(true)
  })

  it('simulates: completed task → dev restart → messages restored from SQLite', async () => {
    const taskId = 'completed-restart'

    // SQLite has the full thread (migration completed previously)
    vi.mocked(threadDb.loadFullThread).mockResolvedValueOnce({
      id: taskId,
      name: 'Completed Task',
      workspace: '/ws',
      status: 'completed',
      createdAt: '2026-01-01T00:00:00Z',
      messages: [
        { role: 'user', content: 'question', timestamp: '2026-01-01T00:00:01Z' },
        { role: 'assistant', content: 'answer', timestamp: '2026-01-01T00:00:02Z' },
      ],
      isArchived: true,
    })

    useTaskStore.setState({
      archivedMeta: {
        [taskId]: {
          id: taskId,
          name: 'Completed Task',
          workspace: '/ws',
          createdAt: '2026-01-01T00:00:00Z',
          lastActivityAt: '2026-01-01T00:00:02Z',
          messageCount: 2,
        },
      },
    })

    useTaskStore.getState().setSelectedTask(taskId)

    await vi.waitFor(() => {
      expect(useTaskStore.getState().tasks[taskId]).toBeDefined()
    })

    const hydrated = useTaskStore.getState().tasks[taskId]
    expect(hydrated.messages).toHaveLength(2)
    expect(hydrated.messages[1].content).toBe('answer')
    // JSON fallback should NOT have been called
    expect(historyStore.loadThread).not.toHaveBeenCalled()
  })

  it('simulates: multiple threads survive restart with correct isolation', async () => {
    const thread1 = 'thread-1'
    const thread2 = 'thread-2'

    vi.mocked(threadDb.loadFullThread)
      .mockResolvedValueOnce({
        id: thread1,
        name: 'Thread 1',
        workspace: '/ws',
        status: 'completed',
        createdAt: '2026-01-01T00:00:00Z',
        messages: [{ role: 'user', content: 'thread 1 msg', timestamp: '2026-01-01T00:00:01Z' }],
        isArchived: true,
      })
      .mockResolvedValueOnce(null) // thread2 not in SQLite

    vi.mocked(historyStore.loadThread).mockResolvedValueOnce({
      id: thread2,
      name: 'Thread 2',
      workspace: '/ws',
      createdAt: '2026-01-02T00:00:00Z',
      messages: [{ role: 'user', content: 'thread 2 msg', timestamp: '2026-01-02T00:00:01Z' }],
    })

    useTaskStore.setState({
      archivedMeta: {
        [thread1]: {
          id: thread1,
          name: 'Thread 1',
          workspace: '/ws',
          createdAt: '2026-01-01T00:00:00Z',
          lastActivityAt: '2026-01-01T00:00:01Z',
          messageCount: 1,
        },
        [thread2]: {
          id: thread2,
          name: 'Thread 2',
          workspace: '/ws',
          createdAt: '2026-01-02T00:00:00Z',
          lastActivityAt: '2026-01-02T00:00:01Z',
          messageCount: 1,
        },
      },
    })

    // Hydrate thread 1
    await useTaskStore.getState().hydrateArchivedTask(thread1)
    expect(useTaskStore.getState().tasks[thread1].messages[0].content).toBe('thread 1 msg')

    // Hydrate thread 2
    await useTaskStore.getState().hydrateArchivedTask(thread2)
    expect(useTaskStore.getState().tasks[thread2].messages[0].content).toBe('thread 2 msg')

    // Both should be independent
    expect(useTaskStore.getState().tasks[thread1].messages).toHaveLength(1)
    expect(useTaskStore.getState().tasks[thread2].messages).toHaveLength(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO: loadTasks merge behavior on restart
// ═══════════════════════════════════════════════════════════════════════════

describe('loadTasks — message preservation on restart', () => {
  it('prefers persisted messages when backend returns task with fewer messages', async () => {
    const { ipc } = await import('@/lib/ipc')
    const taskId = 'merge-task'

    // Backend returns task with only the user message (lost assistant response on restart)
    vi.mocked(ipc.listTasks).mockResolvedValueOnce([
      makeTask({
        id: taskId,
        status: 'paused',
        messages: [makeMessage({ role: 'user', content: 'original question' })],
      }),
    ])

    // History store has the full conversation
    vi.mocked(historyStore.loadThreads).mockResolvedValueOnce([
      {
        id: taskId,
        name: 'Test Task',
        workspace: '/projects/test',
        createdAt: '2026-01-01T00:00:00Z',
        messages: [
          { role: 'user', content: 'original question', timestamp: '2026-01-01T00:00:01Z' },
          { role: 'assistant', content: 'full answer', timestamp: '2026-01-01T00:00:02Z' },
        ],
      },
    ])
    vi.mocked(historyStore.loadProjects).mockResolvedValueOnce([])
    vi.mocked(historyStore.loadSoftDeleted).mockResolvedValueOnce([])

    await useTaskStore.getState().loadTasks()

    const task = useTaskStore.getState().tasks[taskId]
    expect(task).toBeDefined()
    // Should have the richer persisted messages
    expect(task.messages).toHaveLength(2)
    expect(task.messages[1].content).toBe('full answer')
  })

  it('uses backend messages when they have more than persisted', async () => {
    const { ipc } = await import('@/lib/ipc')
    const taskId = 'backend-richer'

    // Backend has more messages (continued conversation)
    vi.mocked(ipc.listTasks).mockResolvedValueOnce([
      makeTask({
        id: taskId,
        status: 'paused',
        messages: [
          makeMessage({ role: 'user', content: 'q1' }),
          makeMessage({ role: 'assistant', content: 'a1', timestamp: '2026-01-01T00:00:02Z' }),
          makeMessage({ role: 'user', content: 'q2', timestamp: '2026-01-01T00:00:03Z' }),
        ],
      }),
    ])

    // History store has fewer (stale)
    vi.mocked(historyStore.loadThreads).mockResolvedValueOnce([
      {
        id: taskId,
        name: 'Test Task',
        workspace: '/projects/test',
        createdAt: '2026-01-01T00:00:00Z',
        messages: [
          { role: 'user', content: 'q1', timestamp: '2026-01-01T00:00:01Z' },
        ],
      },
    ])
    vi.mocked(historyStore.loadProjects).mockResolvedValueOnce([])
    vi.mocked(historyStore.loadSoftDeleted).mockResolvedValueOnce([])

    await useTaskStore.getState().loadTasks()

    const task = useTaskStore.getState().tasks[taskId]
    expect(task.messages).toHaveLength(3)
  })

  it('puts threads not in backend into archivedMeta (not tasks)', async () => {
    const { ipc } = await import('@/lib/ipc')

    // Backend returns empty (fresh restart)
    vi.mocked(ipc.listTasks).mockResolvedValueOnce([])

    // History has threads from previous session
    vi.mocked(historyStore.loadThreads).mockResolvedValueOnce([
      {
        id: 'old-thread',
        name: 'Old Thread',
        workspace: '/ws',
        createdAt: '2026-01-01T00:00:00Z',
        messages: [
          { role: 'user', content: 'old msg', timestamp: '2026-01-01T00:00:01Z' },
        ],
      },
    ])
    vi.mocked(historyStore.loadProjects).mockResolvedValueOnce([])
    vi.mocked(historyStore.loadSoftDeleted).mockResolvedValueOnce([])

    await useTaskStore.getState().loadTasks()

    // Should be in archivedMeta, not tasks
    expect(useTaskStore.getState().tasks['old-thread']).toBeUndefined()
    expect(useTaskStore.getState().archivedMeta['old-thread']).toBeDefined()
    expect(useTaskStore.getState().archivedMeta['old-thread'].messageCount).toBe(1)
  })

  it('excludes soft-deleted threads from both tasks and archivedMeta', async () => {
    const { ipc } = await import('@/lib/ipc')

    vi.mocked(ipc.listTasks).mockResolvedValueOnce([])
    vi.mocked(historyStore.loadThreads).mockResolvedValueOnce([
      {
        id: 'deleted-thread',
        name: 'Deleted',
        workspace: '/ws',
        createdAt: '2026-01-01T00:00:00Z',
        messages: [{ role: 'user', content: 'x', timestamp: '2026-01-01T00:00:01Z' }],
      },
    ])
    vi.mocked(historyStore.loadProjects).mockResolvedValueOnce([])
    vi.mocked(historyStore.loadSoftDeleted).mockResolvedValueOnce([
      {
        task: makeTask({ id: 'deleted-thread', messages: [makeMessage()] }),
        deletedAt: '2026-01-02T00:00:00Z',
      },
    ])

    await useTaskStore.getState().loadTasks()

    expect(useTaskStore.getState().tasks['deleted-thread']).toBeUndefined()
    expect(useTaskStore.getState().archivedMeta['deleted-thread']).toBeUndefined()
  })
})
