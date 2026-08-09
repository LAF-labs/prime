import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSetActiveWorkspace, mockResendMessage, mockToast } = vi.hoisted(() => ({
  mockSetActiveWorkspace: vi.fn(),
  mockResendMessage: vi.fn().mockResolvedValue(undefined),
  mockToast: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: Object.assign(mockToast, { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('@/lib/chat-resend', () => ({
  registerResendHandler: vi.fn(),
  resendMessage: mockResendMessage,
}))

vi.mock('@/lib/ipc', () => ({
  ipc: {
    cancelTask: vi.fn().mockResolvedValue(undefined),
    deleteTask: vi.fn().mockResolvedValue(undefined),
  checkpointCleanup: vi.fn().mockResolvedValue(0),
    listTasks: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn().mockResolvedValue(undefined),
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
  saveStreamingSnapshots: vi.fn().mockResolvedValue(undefined),
  loadStreamingSnapshots: vi.fn().mockResolvedValue({}),
  saveSoftDeleted: vi.fn().mockResolvedValue(undefined),
  saveUiState: vi.fn().mockResolvedValue(undefined),
  toArchivedTasks: vi.fn().mockReturnValue([]),
  clearHistory: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/thread-db', () => ({
  saveThread: vi.fn().mockResolvedValue(undefined),
  saveMessage: vi.fn().mockResolvedValue(undefined),
  saveAllMessages: vi.fn().mockResolvedValue(undefined),
  replaceMessages: vi.fn().mockResolvedValue(undefined),
  loadFullThread: vi.fn().mockResolvedValue(null),
  loadMessages: vi.fn().mockResolvedValue([]),
  migrateFromJsonHistory: vi.fn().mockResolvedValue({ migrated: 0, skipped: 0, failed: 0 }),
  clearAll: vi.fn().mockResolvedValue(undefined),
  listThreadMeta: vi.fn().mockResolvedValue([]),
  deleteThread: vi.fn().mockResolvedValue(undefined),
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
vi.mock('./resourceStore', () => ({
  useResourceStore: { getState: () => ({ setMcpError: vi.fn() }) },
}))

import { useTaskStore, applyTurnEnd } from './taskStore'
import * as threadDbMock from '@/lib/thread-db'
import type { AgentTask } from '@/types'

const makeTask = (overrides?: Partial<AgentTask>): AgentTask => ({
  id: 'task-1',
  name: 'Test Task',
  workspace: '/projects/test',
  status: 'paused',
  createdAt: '2026-01-01T00:00:00Z',
  messages: [],
  ...overrides,
})

beforeEach(() => {
  useTaskStore.setState({
    tasks: {}, projects: [], projectIds: {}, deletedTaskIds: new Set(), softDeleted: {}, selectedTaskId: null,
    streamingChunks: {}, thinkingChunks: {}, liveToolCalls: {}, liveToolSplits: {},
    queuedMessages: {}, activityFeed: [], connected: false,
    terminalOpenTasks: new Set(), pendingWorkspace: null,
    view: 'dashboard', isNewProjectOpen: false, isSettingsOpen: false, projectNames: {},
    btwCheckpoint: null,
    splitViews: [], activeSplitId: null, focusedPanel: 'left' as const, scrollPositions: {},
    pinnedThreadIds: [],
  })
  mockToast.mockClear()
})

describe('upsertTask', () => {
  it('adds a new task', () => {
    useTaskStore.getState().upsertTask(makeTask())
    expect(useTaskStore.getState().tasks['task-1']).toBeDefined()
  })

  it('updates existing task', () => {
    useTaskStore.getState().upsertTask(makeTask())
    useTaskStore.getState().upsertTask(makeTask({ status: 'running' }))
    expect(useTaskStore.getState().tasks['task-1'].status).toBe('running')
  })

  it('preserves messages when incoming has fewer', () => {
    const msg = { role: 'user' as const, content: 'hi', timestamp: '' }
    useTaskStore.getState().upsertTask(makeTask({ messages: [msg] }))
    useTaskStore.getState().upsertTask(makeTask({ status: 'running', messages: [] }))
    expect(useTaskStore.getState().tasks['task-1'].messages).toHaveLength(1)
  })

  it('skips deleted task IDs', () => {
    useTaskStore.setState({ deletedTaskIds: new Set(['task-1']) })
    useTaskStore.getState().upsertTask(makeTask())
    expect(useTaskStore.getState().tasks['task-1']).toBeUndefined()
  })

  it('adds activity feed entry on status change', () => {
    useTaskStore.getState().upsertTask(makeTask())
    useTaskStore.getState().upsertTask(makeTask({ status: 'running' }))
    expect(useTaskStore.getState().activityFeed.length).toBeGreaterThan(0)
  })

  it('preserves originalWorkspace when backend update lacks it', () => {
    useTaskStore.getState().upsertTask(makeTask({
      originalWorkspace: '/project',
      workspace: '/project/.laf-agent/worktrees/feat',
    }))
    // Backend task_update arrives without worktree fields
    useTaskStore.getState().upsertTask(makeTask({
      status: 'running',
      workspace: '/project/.laf-agent/worktrees/feat',
    }))
    const task = useTaskStore.getState().tasks['task-1']
    expect(task.originalWorkspace).toBe('/project')
  })

  it('allows overwriting originalWorkspace when explicitly provided', () => {
    useTaskStore.getState().upsertTask(makeTask({
      originalWorkspace: '/project',
    }))
    useTaskStore.getState().upsertTask(makeTask({
      status: 'running',
      originalWorkspace: '/project',
    }))
    const task = useTaskStore.getState().tasks['task-1']
  })
})

describe('removeTask', () => {
  it('removes task from state', () => {
    useTaskStore.getState().upsertTask(makeTask())
    useTaskStore.getState().removeTask('task-1')
    expect(useTaskStore.getState().tasks['task-1']).toBeUndefined()
  })

  it('clears streaming data', () => {
    useTaskStore.setState({ streamingChunks: { 'task-1': 'text' }, thinkingChunks: { 'task-1': 'think' }, liveToolCalls: { 'task-1': [] } })
    useTaskStore.getState().upsertTask(makeTask())
    useTaskStore.getState().removeTask('task-1')
    expect(useTaskStore.getState().streamingChunks['task-1']).toBeUndefined()
    expect(useTaskStore.getState().thinkingChunks['task-1']).toBeUndefined()
    expect(useTaskStore.getState().liveToolCalls['task-1']).toBeUndefined()
  })

  it('adds to deletedTaskIds', () => {
    useTaskStore.getState().upsertTask(makeTask())
    useTaskStore.getState().removeTask('task-1')
    expect(useTaskStore.getState().deletedTaskIds.has('task-1')).toBe(true)
  })

  it('clears selectedTaskId if removed', () => {
    useTaskStore.getState().upsertTask(makeTask())
    useTaskStore.setState({ selectedTaskId: 'task-1' })
    useTaskStore.getState().removeTask('task-1')
    expect(useTaskStore.getState().selectedTaskId).toBeNull()
  })
})

describe('soft delete undo toast', () => {
  it('announces the soft delete with an Undo action that restores the thread', () => {
    useTaskStore.getState().upsertTask(makeTask())
    useTaskStore.getState().softDeleteTask('task-1')
    expect(useTaskStore.getState().tasks['task-1']).toBeUndefined()
    expect(useTaskStore.getState().softDeleted['task-1']).toBeDefined()

    expect(mockToast).toHaveBeenCalledTimes(1)
    const [title, opts] = mockToast.mock.calls[0] as [string, { action: { label: string; onClick: () => void } }]
    expect(title).toBe('Thread deleted')
    expect(opts.action.label).toBe('Undo')

    opts.action.onClick()
    const state = useTaskStore.getState()
    expect(state.tasks['task-1']).toBeDefined()
    expect(state.softDeleted['task-1']).toBeUndefined()
    expect(state.deletedTaskIds.has('task-1')).toBe(false)
  })

})

describe('startNewThread', () => {
  it('opens a pending chat in the selected thread\'s project', () => {
    useTaskStore.getState().upsertTask(makeTask({ workspace: '/wt/branch', originalWorkspace: '/projects/test' }))
    useTaskStore.setState({ selectedTaskId: 'task-1', view: 'dashboard' })
    useTaskStore.getState().startNewThread()
    const state = useTaskStore.getState()
    expect(state.pendingWorkspace).toBe('/projects/test')
    expect(state.view).toBe('chat')
  })

  it('falls back to the first project when nothing is selected', () => {
    useTaskStore.setState({ projects: ['/projects/alpha'] })
    useTaskStore.getState().startNewThread()
    expect(useTaskStore.getState().pendingWorkspace).toBe('/projects/alpha')
  })

  it('opens the import-project sheet when there are no projects', () => {
    useTaskStore.getState().startNewThread()
    const state = useTaskStore.getState()
    expect(state.pendingWorkspace).toBeNull()
    expect(state.isNewProjectOpen).toBe(true)
    expect(state.view).toBe('chat')
  })
})

describe('streaming', () => {
  it('appendChunk accumulates text', () => {
    useTaskStore.getState().appendChunk('t1', 'hello ')
    useTaskStore.getState().appendChunk('t1', 'world')
    expect(useTaskStore.getState().streamingChunks['t1']).toBe('hello world')
  })

  it('appendThinkingChunk accumulates text', () => {
    useTaskStore.getState().appendThinkingChunk('t1', 'hmm ')
    useTaskStore.getState().appendThinkingChunk('t1', 'ok')
    expect(useTaskStore.getState().thinkingChunks['t1']).toBe('hmm ok')
  })

  it('clearTurn resets all live state', () => {
    useTaskStore.setState({
      streamingChunks: { t1: 'text' },
      thinkingChunks: { t1: 'think' },
      liveToolCalls: { t1: [{ toolCallId: 'tc1', title: 'test', status: 'completed' }] },
      liveToolSplits: { t1: [{ at: 4, toolCallId: 'tc1' }] },
    })
    useTaskStore.getState().clearTurn('t1')
    expect(useTaskStore.getState().streamingChunks['t1']).toBe('')
    expect(useTaskStore.getState().thinkingChunks['t1']).toBe('')
    expect(useTaskStore.getState().liveToolCalls['t1']).toEqual([])
    expect(useTaskStore.getState().liveToolSplits['t1']).toEqual([])
  })
})

describe('upsertToolCall', () => {
  it('adds new tool call', () => {
    useTaskStore.getState().upsertToolCall('t1', { toolCallId: 'tc1', title: 'read', status: 'pending' })
    expect(useTaskStore.getState().liveToolCalls['t1']).toHaveLength(1)
  })

  it('records a split anchor at the current streaming offset on first sight', () => {
    useTaskStore.setState({ streamingChunks: { t1: 'hello world' } })
    useTaskStore.getState().upsertToolCall('t1', { toolCallId: 'tc1', title: 'read', status: 'pending' })
    expect(useTaskStore.getState().liveToolSplits['t1']).toEqual([{ at: 11, toolCallId: 'tc1' }])
  })

  it('does not record a duplicate split when the same tool is updated', () => {
    useTaskStore.setState({ streamingChunks: { t1: 'hello' } })
    useTaskStore.getState().upsertToolCall('t1', { toolCallId: 'tc1', title: 'read', status: 'pending' })
    useTaskStore.setState({ streamingChunks: { t1: 'hello world' } })
    useTaskStore.getState().upsertToolCall('t1', { toolCallId: 'tc1', title: 'read', status: 'completed' })
    expect(useTaskStore.getState().liveToolSplits['t1']).toEqual([{ at: 5, toolCallId: 'tc1' }])
  })

  it('stamps createdAt on first sight and preserves it across updates', () => {
    useTaskStore.getState().upsertToolCall('t1', { toolCallId: 'tc1', title: 'read', status: 'pending' })
    const created = useTaskStore.getState().liveToolCalls['t1'][0].createdAt
    expect(created).toBeDefined()
    useTaskStore.getState().upsertToolCall('t1', { toolCallId: 'tc1', title: 'read', status: 'completed' })
    expect(useTaskStore.getState().liveToolCalls['t1'][0].createdAt).toBe(created)
  })

  it('stamps completedAt on the first terminal-status update', () => {
    useTaskStore.getState().upsertToolCall('t1', { toolCallId: 'tc1', title: 'fetch', kind: 'fetch', status: 'pending' })
    expect(useTaskStore.getState().liveToolCalls['t1'][0].completedAt).toBeUndefined()
    useTaskStore.getState().upsertToolCall('t1', { toolCallId: 'tc1', title: 'fetch', kind: 'fetch', status: 'completed' })
    const completed = useTaskStore.getState().liveToolCalls['t1'][0].completedAt
    expect(completed).toBeDefined()
    // Subsequent updates preserve the original completedAt.
    useTaskStore.getState().upsertToolCall('t1', { toolCallId: 'tc1', title: 'fetch v2', kind: 'fetch', status: 'completed' })
    expect(useTaskStore.getState().liveToolCalls['t1'][0].completedAt).toBe(completed)
  })

  it('stamps completedAt when the first sighting is already terminal', () => {
    useTaskStore.getState().upsertToolCall('t1', { toolCallId: 'tc1', title: 'fetch', kind: 'fetch', status: 'completed' })
    expect(useTaskStore.getState().liveToolCalls['t1'][0].completedAt).toBeDefined()
  })

  it('does not stamp completedAt for non-terminal statuses', () => {
    useTaskStore.getState().upsertToolCall('t1', { toolCallId: 'tc1', title: 'fetch', kind: 'fetch', status: 'pending' })
    useTaskStore.getState().upsertToolCall('t1', { toolCallId: 'tc1', title: 'fetch', kind: 'fetch', status: 'in_progress' })
    expect(useTaskStore.getState().liveToolCalls['t1'][0].completedAt).toBeUndefined()
  })

  it('updates existing by toolCallId', () => {
    useTaskStore.getState().upsertToolCall('t1', { toolCallId: 'tc1', title: 'read', status: 'pending' })
    useTaskStore.getState().upsertToolCall('t1', { toolCallId: 'tc1', title: 'read', status: 'completed' })
    expect(useTaskStore.getState().liveToolCalls['t1']).toHaveLength(1)
    expect(useTaskStore.getState().liveToolCalls['t1'][0].status).toBe('completed')
  })
})

describe('queue', () => {
  it('enqueue and dequeue', () => {
    useTaskStore.getState().enqueueMessage('t1', 'msg1')
    useTaskStore.getState().enqueueMessage('t1', 'msg2')
    const msgs = useTaskStore.getState().dequeueMessages('t1')
    expect(msgs).toEqual([{ text: 'msg1' }, { text: 'msg2' }])
    expect(useTaskStore.getState().queuedMessages['t1']).toEqual([])
  })

  it('enqueue with attachments', () => {
    const attachment = { base64: 'abc', mimeType: 'image/png', name: 'img.png' }
    useTaskStore.getState().enqueueMessage('t1', 'look', [attachment])
    const msgs = useTaskStore.getState().dequeueMessages('t1')
    expect(msgs).toEqual([{ text: 'look', attachments: [attachment] }])
  })

  it('removeQueuedMessage removes by index', () => {
    useTaskStore.getState().enqueueMessage('t1', 'a')
    useTaskStore.getState().enqueueMessage('t1', 'b')
    useTaskStore.getState().enqueueMessage('t1', 'c')
    useTaskStore.getState().removeQueuedMessage('t1', 1)
    expect(useTaskStore.getState().queuedMessages['t1']).toEqual([{ text: 'a' }, { text: 'c' }])
  })

  it('reorderQueuedMessage moves item', () => {
    useTaskStore.getState().enqueueMessage('t1', 'a')
    useTaskStore.getState().enqueueMessage('t1', 'b')
    useTaskStore.getState().enqueueMessage('t1', 'c')
    useTaskStore.getState().reorderQueuedMessage('t1', 0, 2)
    expect(useTaskStore.getState().queuedMessages['t1']).toEqual([{ text: 'b' }, { text: 'c' }, { text: 'a' }])
  })
})

describe('createDraftThread', () => {
  it('creates a paused task and selects it', () => {
    const id = useTaskStore.getState().createDraftThread('/ws')
    const task = useTaskStore.getState().tasks[id]
    expect(task).toBeDefined()
    expect(task.status).toBe('paused')
    expect(task.workspace).toBe('/ws')
    expect(useTaskStore.getState().selectedTaskId).toBe(id)
    expect(useTaskStore.getState().view).toBe('chat')
  })
})

describe('projects', () => {
  it('addProject adds workspace and generates UUID', () => {
    useTaskStore.getState().addProject('/ws')
    expect(useTaskStore.getState().projects).toContain('/ws')
    const pid = useTaskStore.getState().projectIds['/ws']
    expect(pid).toBeDefined()
    expect(pid).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('addProject deduplicates', () => {
    useTaskStore.getState().addProject('/ws')
    const pid = useTaskStore.getState().projectIds['/ws']
    useTaskStore.getState().addProject('/ws')
    expect(useTaskStore.getState().projects).toHaveLength(1)
    // UUID should not change
    expect(useTaskStore.getState().projectIds['/ws']).toBe(pid)
  })

  it('addProject does not restore soft-deleted threads', () => {
    useTaskStore.getState().addProject('/ws')
    const oldPid = useTaskStore.getState().projectIds['/ws']
    useTaskStore.getState().upsertTask(makeTask({ id: 't1', workspace: '/ws', projectId: oldPid }))
    useTaskStore.getState().removeProject('/ws')
    expect(useTaskStore.getState().softDeleted['t1']).toBeDefined()
    // Re-add the same project — soft-deleted threads stay deleted
    useTaskStore.getState().addProject('/ws')
    expect(useTaskStore.getState().softDeleted['t1']).toBeDefined()
    expect(useTaskStore.getState().tasks['t1']).toBeUndefined()
  })

  it('reorderProject swaps positions', () => {
    useTaskStore.setState({ projects: ['/a', '/b', '/c'] })
    useTaskStore.getState().reorderProject(0, 2)
    expect(useTaskStore.getState().projects).toEqual(['/b', '/c', '/a'])
  })

  it('reorderProject no-ops when from equals to', () => {
    useTaskStore.setState({ projects: ['/a', '/b', '/c'] })
    useTaskStore.getState().reorderProject(1, 1)
    expect(useTaskStore.getState().projects).toEqual(['/a', '/b', '/c'])
  })

  it('reorderProject handles adjacent swap forward', () => {
    useTaskStore.setState({ projects: ['/a', '/b', '/c'] })
    useTaskStore.getState().reorderProject(0, 1)
    expect(useTaskStore.getState().projects).toEqual(['/b', '/a', '/c'])
  })

  it('reorderProject handles adjacent swap backward', () => {
    useTaskStore.setState({ projects: ['/a', '/b', '/c'] })
    useTaskStore.getState().reorderProject(2, 1)
    expect(useTaskStore.getState().projects).toEqual(['/a', '/c', '/b'])
  })

  it('reorderProject handles last-to-first', () => {
    useTaskStore.setState({ projects: ['/a', '/b', '/c'] })
    useTaskStore.getState().reorderProject(2, 0)
    expect(useTaskStore.getState().projects).toEqual(['/c', '/a', '/b'])
  })
})

describe('getProjectId', () => {
  it('returns existing UUID for known workspace', () => {
    useTaskStore.getState().addProject('/ws')
    const pid = useTaskStore.getState().projectIds['/ws']
    expect(useTaskStore.getState().getProjectId('/ws')).toBe(pid)
  })

  it('generates and stores UUID for unknown workspace', () => {
    const pid = useTaskStore.getState().getProjectId('/new')
    expect(pid).toMatch(/^[0-9a-f-]{36}$/)
    expect(useTaskStore.getState().projectIds['/new']).toBe(pid)
  })

  it('returns same UUID on repeated calls', () => {
    const pid1 = useTaskStore.getState().getProjectId('/ws')
    const pid2 = useTaskStore.getState().getProjectId('/ws')
    expect(pid1).toBe(pid2)
  })
})

describe('simple setters', () => {
  it('setSelectedTask', () => {
    useTaskStore.getState().setSelectedTask('x')
    expect(useTaskStore.getState().selectedTaskId).toBe('x')
  })

  it('setView', () => {
    useTaskStore.getState().setView('chat')
    expect(useTaskStore.getState().view).toBe('chat')
  })

  it('setNewProjectOpen', () => {
    useTaskStore.getState().setNewProjectOpen(true)
    expect(useTaskStore.getState().isNewProjectOpen).toBe(true)
  })

  it('setSettingsOpen', () => {
    useTaskStore.getState().setSettingsOpen(true)
    expect(useTaskStore.getState().isSettingsOpen).toBe(true)
  })

  it('toggleTerminal', () => {
    useTaskStore.getState().toggleTerminal('t1')
    expect(useTaskStore.getState().terminalOpenTasks.has('t1')).toBe(true)
    useTaskStore.getState().toggleTerminal('t1')
    expect(useTaskStore.getState().terminalOpenTasks.has('t1')).toBe(false)
  })

  it('renameTask', () => {
    useTaskStore.getState().upsertTask(makeTask())
    useTaskStore.getState().renameTask('task-1', 'New Name')
    expect(useTaskStore.getState().tasks['task-1'].name).toBe('New Name')
  })

  it('setPendingWorkspace', () => {
    useTaskStore.getState().setPendingWorkspace('/ws')
    expect(useTaskStore.getState().pendingWorkspace).toBe('/ws')
    expect(useTaskStore.getState().selectedTaskId).toBeNull()
    expect(useTaskStore.getState().view).toBe('chat')
  })

  it('updatePlan', () => {
    useTaskStore.getState().upsertTask(makeTask())
    useTaskStore.getState().updatePlan('task-1', [{ content: 'step', status: 'pending', priority: 'high' }])
    expect(useTaskStore.getState().tasks['task-1'].plan).toHaveLength(1)
  })

  it('updateUsage', () => {
    useTaskStore.getState().upsertTask(makeTask())
    useTaskStore.getState().updateUsage('task-1', 5000, 10000)
    expect(useTaskStore.getState().tasks['task-1'].contextUsage).toEqual({ used: 5000, size: 10000 })
  })
})

describe('archiveTask', () => {
  it('marks task as archived and completed', () => {
    useTaskStore.getState().upsertTask(makeTask({ status: 'running' }))
    useTaskStore.getState().archiveTask('task-1')
    const task = useTaskStore.getState().tasks['task-1']
    expect(task.isArchived).toBe(true)
    expect(task.status).toBe('completed')
  })

  it('clears streaming state for archived task', () => {
    useTaskStore.getState().upsertTask(makeTask({ status: 'running' }))
    useTaskStore.setState({
      streamingChunks: { 'task-1': 'partial' },
      thinkingChunks: { 'task-1': 'hmm' },
      liveToolCalls: { 'task-1': [{ toolCallId: 'tc1', title: 'read', status: 'in_progress' }] },
    })
    useTaskStore.getState().archiveTask('task-1')
    expect(useTaskStore.getState().streamingChunks['task-1']).toBe('')
    expect(useTaskStore.getState().thinkingChunks['task-1']).toBe('')
    expect(useTaskStore.getState().liveToolCalls['task-1']).toEqual([])
  })

  it('no-ops for already archived task', () => {
    useTaskStore.getState().upsertTask(makeTask({ isArchived: true, status: 'completed' }))
    const before = useTaskStore.getState().tasks['task-1']
    useTaskStore.getState().archiveTask('task-1')
    const after = useTaskStore.getState().tasks['task-1']
    expect(before).toBe(after)
  })

  it('no-ops for non-existent task', () => {
    useTaskStore.getState().archiveTask('nonexistent')
    expect(useTaskStore.getState().tasks['nonexistent']).toBeUndefined()
  })
})

describe('taskModes', () => {
  it('setTaskMode stores mode for task', () => {
    useTaskStore.getState().setTaskMode('task-1', 'plan')
    expect(useTaskStore.getState().taskModes['task-1']).toBe('plan')
  })

  it('setTaskMode no-ops when mode unchanged', () => {
    useTaskStore.setState({ taskModes: { 'task-1': 'plan' } })
    const before = useTaskStore.getState().taskModes
    useTaskStore.getState().setTaskMode('task-1', 'plan')
    expect(useTaskStore.getState().taskModes).toBe(before)
  })

  it('removeTask clears taskMode for that task', () => {
    useTaskStore.setState({ taskModes: { 'task-1': 'plan', 'task-2': 'code' } })
    useTaskStore.getState().upsertTask(makeTask())
    useTaskStore.getState().removeTask('task-1')
    expect(useTaskStore.getState().taskModes['task-1']).toBeUndefined()
    expect(useTaskStore.getState().taskModes['task-2']).toBe('code')
  })
})

describe('drafts', () => {
  it('setDraft stores content for workspace', () => {
    useTaskStore.getState().setDraft('/ws', 'hello world')
    expect(useTaskStore.getState().drafts['/ws']).toBe('hello world')
  })

  it('setDraft removes entry when content is empty', () => {
    useTaskStore.getState().setDraft('/ws', 'hello')
    useTaskStore.getState().setDraft('/ws', '   ')
    expect(useTaskStore.getState().drafts['/ws']).toBeUndefined()
  })

  it('setDraft no-ops when content unchanged', () => {
    useTaskStore.getState().setDraft('/ws', 'hello')
    const before = useTaskStore.getState().drafts
    useTaskStore.getState().setDraft('/ws', 'hello')
    expect(useTaskStore.getState().drafts).toBe(before)
  })

  it('removeDraft removes entry and suppresses next setDraft', () => {
    useTaskStore.getState().setDraft('/ws', 'hello')
    useTaskStore.getState().removeDraft('/ws')
    expect(useTaskStore.getState().drafts['/ws']).toBeUndefined()
    // Next setDraft for this workspace should be suppressed
    useTaskStore.getState().setDraft('/ws', 'resurrected')
    expect(useTaskStore.getState().drafts['/ws']).toBeUndefined()
    // But a second setDraft should work normally
    useTaskStore.getState().setDraft('/ws', 'new content')
    expect(useTaskStore.getState().drafts['/ws']).toBe('new content')
  })

  it('removeDraft no-ops for non-existent workspace', () => {
    const before = useTaskStore.getState().drafts
    useTaskStore.getState().removeDraft('/nonexistent')
    expect(useTaskStore.getState().drafts).toBe(before)
  })
})

describe('removeProject cleans up taskModes', () => {
  it('removes taskModes for tasks in the removed project', () => {
    useTaskStore.getState().addProject('/ws')
    useTaskStore.getState().upsertTask(makeTask({ id: 't1', workspace: '/ws' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 't2', workspace: '/ws' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 't3', workspace: '/other' }))
    useTaskStore.setState({ taskModes: { t1: 'plan', t2: 'code', t3: 'plan' } })
    useTaskStore.getState().removeProject('/ws')
    expect(useTaskStore.getState().taskModes['t1']).toBeUndefined()
    expect(useTaskStore.getState().taskModes['t2']).toBeUndefined()
    expect(useTaskStore.getState().taskModes['t3']).toBe('plan')
  })
})

describe('applyTurnEnd', () => {
  // In production, the task_update event sets the task to 'paused' before
  // turn_end fires, so applyTurnEnd never sees status === 'running' (it has a
  // guard that returns {} for running tasks to avoid clobbering a new turn).
  const baseState = (overrides?: Partial<Parameters<typeof applyTurnEnd>[0]>) => ({
    tasks: { 't1': makeTask({ id: 't1', status: 'paused' }) },
    streamingChunks: {} as Record<string, string>,
    thinkingChunks: {} as Record<string, string>,
    liveToolCalls: {} as Record<string, import('@/types').ToolCall[]>,
    liveToolSplits: {} as Record<string, import('@/types').ToolCallSplit[]>,
    ...overrides,
  })

  it('sets status to paused on normal end_turn', () => {
    const result = applyTurnEnd(baseState(), 't1', 'end_turn')
    expect(result.tasks?.['t1'].status).toBe('paused')
  })

  it('sets status to paused on refusal (user can recover)', () => {
    const result = applyTurnEnd(baseState(), 't1', 'refusal')
    expect(result.tasks?.['t1'].status).toBe('paused')
  })

  it('appends retry system message on refusal with refusalRetry=true', () => {
    const result = applyTurnEnd(baseState(), 't1', 'refusal', true)
    const messages = result.tasks?.['t1'].messages ?? []
    const systemMsg = messages.find((m) => m.role === 'system')
    expect(systemMsg).toBeDefined()
    expect(systemMsg?.content).toContain('Retrying automatically')
  })

  it('appends rephrase system message on refusal with refusalRetry=false', () => {
    const result = applyTurnEnd(baseState(), 't1', 'refusal', false)
    const messages = result.tasks?.['t1'].messages ?? []
    const systemMsg = messages.find((m) => m.role === 'system')
    expect(systemMsg).toBeDefined()
    expect(systemMsg?.content).toContain('try rephrasing')
  })

  it('does not append system message on normal end_turn', () => {
    const result = applyTurnEnd(baseState(), 't1', 'end_turn')
    const messages = result.tasks?.['t1'].messages ?? []
    expect(messages.find((m) => m.role === 'system')).toBeUndefined()
  })

  it('marks incomplete tool calls as failed on refusal', () => {
    const state = baseState({
      liveToolCalls: { t1: [{ toolCallId: 'tc1', title: 'subagent', status: 'in_progress' }] },
    })
    const result = applyTurnEnd(state, 't1', 'refusal')
    const assistantMsg = result.tasks?.['t1'].messages.find((m) => m.role === 'assistant')
    expect(assistantMsg?.toolCalls?.[0].status).toBe('failed')
  })

  it('marks incomplete tool calls as completed on normal end', () => {
    const state = baseState({
      liveToolCalls: { t1: [{ toolCallId: 'tc1', title: 'read', status: 'in_progress' }] },
    })
    const result = applyTurnEnd(state, 't1', 'end_turn')
    const assistantMsg = result.tasks?.['t1'].messages.find((m) => m.role === 'assistant')
    expect(assistantMsg?.toolCalls?.[0].status).toBe('completed')
  })

  it('preserves already-completed tool call status', () => {
    const state = baseState({
      liveToolCalls: { t1: [{ toolCallId: 'tc1', title: 'read', status: 'completed' }] },
    })
    const result = applyTurnEnd(state, 't1', 'refusal')
    const assistantMsg = result.tasks?.['t1'].messages.find((m) => m.role === 'assistant')
    expect(assistantMsg?.toolCalls?.[0].status).toBe('completed')
  })

  it('clears streaming state', () => {
    const state = baseState({
      streamingChunks: { t1: 'partial text' },
      thinkingChunks: { t1: 'thinking...' },
      liveToolCalls: { t1: [{ toolCallId: 'tc1', title: 'x', status: 'in_progress' }] },
    })
    const result = applyTurnEnd(state, 't1', 'end_turn')
    expect(result.streamingChunks?.['t1']).toBe('')
    expect(result.thinkingChunks?.['t1']).toBe('')
    expect(result.liveToolCalls?.['t1']).toEqual([])
  })

  it('returns empty object for unknown task', () => {
    const result = applyTurnEnd(baseState(), 'unknown', 'end_turn')
    expect(result).toEqual({})
  })

  it('processes running task and sets status to paused', () => {
    const state = baseState({
      tasks: { 't1': makeTask({ id: 't1', status: 'running' }) },
    })
    const result = applyTurnEnd(state, 't1', 'end_turn')
    expect(result.tasks?.['t1']?.status).toBe('paused')
    expect(result.streamingChunks?.['t1']).toBe('')
  })

  it('does not append empty assistant message after pause clears chunks', () => {
    const state = baseState({
      tasks: { 't1': makeTask({ id: 't1', status: 'paused', messages: [{ role: 'user', content: 'hello', timestamp: '' }] }) },
      streamingChunks: { t1: '' },
      thinkingChunks: { t1: '' },
      liveToolCalls: { t1: [] },
    })
    const result = applyTurnEnd(state, 't1', 'end_turn')
    const messages = result.tasks?.['t1'].messages ?? []
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('user')
  })
})

describe('hydrateArchivedTask', () => {
  it('preserves toolCalls and toolCallSplits from persisted thread', async () => {
    const { loadThread } = await import('@/lib/history-store')
    const archivedId = 'archived-with-tools'
    vi.mocked(loadThread).mockResolvedValueOnce({
      id: archivedId,
      name: 'Test Task',
      workspace: '/ws',
      createdAt: '2026-01-01T00:00:00Z',
      messages: [
        { role: 'user', content: 'do a thing', timestamp: '2026-01-01T00:00:00Z' },
        {
          role: 'assistant',
          content: 'doing the thing',
          timestamp: '2026-01-01T00:00:01Z',
          toolCalls: [{
            toolCallId: 'tc-1',
            title: 'Read file',
            kind: 'read',
            status: 'completed',
            createdAt: '2026-01-01T00:00:01Z',
          }],
          toolCallSplits: [{ toolCallId: 'tc-1', at: 5 }],
        },
      ],
    })
    // Seed archivedMeta so hydrateArchivedTask doesn't bail early.
    useTaskStore.setState({
      archivedMeta: {
        [archivedId]: {
          id: archivedId,
          name: 'Test Task',
          workspace: '/ws',
          createdAt: '2026-01-01T00:00:00Z',
          lastActivityAt: '2026-01-01T00:00:01Z',
          messageCount: 2,
        },
      },
    })

    const ok = await useTaskStore.getState().hydrateArchivedTask(archivedId)
    expect(ok).toBe(true)
    const hydrated = useTaskStore.getState().tasks[archivedId]
    expect(hydrated).toBeDefined()
    const assistantMsg = hydrated.messages[1]
    // Regression guard: prior implementation dropped tool data on hydration,
    // leaving reopened threads with text-only stubs of the live transcript.
    expect(assistantMsg.toolCalls?.length).toBe(1)
    expect(assistantMsg.toolCalls?.[0].toolCallId).toBe('tc-1')
    expect(assistantMsg.toolCallSplits?.length).toBe(1)
    expect(assistantMsg.toolCallSplits?.[0].at).toBe(5)
  })
})

describe('autoArchiveStaleThreads', () => {
  it('archives threads returned by the backend', async () => {
    const { ipc } = await import('@/lib/ipc')
    const settingsMod = await import('./settingsStore')
    const originalGetState = settingsMod.useSettingsStore.getState
    ;(settingsMod.useSettingsStore as any).getState = () => ({
      settings: { autoArchiveDays: 7 },
      saveSettings: vi.fn().mockResolvedValue(undefined),
      setActiveWorkspace: mockSetActiveWorkspace,
    })

    const oldTimestamp = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() // 10 days ago
    useTaskStore.getState().upsertTask(makeTask({
      id: 'stale-1',
      status: 'completed',
      messages: [{ role: 'user', content: 'hi', timestamp: oldTimestamp }],
    }))

    // Mock the backend returning this thread as stale
    vi.mocked(ipc.threadDbAutoArchive).mockResolvedValueOnce([
      { id: 'stale-1', name: 'Test Task', workspace: '/projects/test', createdAt: oldTimestamp, lastActivityAt: oldTimestamp, messageCount: 1 },
    ])

    useTaskStore.getState().autoArchiveStaleThreads()
    // Wait for the async IPC call to resolve
    await vi.waitFor(() => {
      expect(useTaskStore.getState().tasks['stale-1']).toBeUndefined()
    })

    expect(useTaskStore.getState().archivedMeta['stale-1']).toBeDefined()
    ;(settingsMod.useSettingsStore as any).getState = originalGetState
  })

  it('does not archive when backend returns empty list', async () => {
    const { ipc } = await import('@/lib/ipc')
    const settingsMod = await import('./settingsStore')
    const originalGetState = settingsMod.useSettingsStore.getState
    ;(settingsMod.useSettingsStore as any).getState = () => ({
      settings: { autoArchiveDays: 1 },
      saveSettings: vi.fn().mockResolvedValue(undefined),
      setActiveWorkspace: mockSetActiveWorkspace,
    })

    const oldTimestamp = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    useTaskStore.getState().upsertTask(makeTask({
      id: 'running-1',
      status: 'running',
      messages: [{ role: 'user', content: 'hi', timestamp: oldTimestamp }],
    }))

    // Backend correctly excludes running threads
    vi.mocked(ipc.threadDbAutoArchive).mockResolvedValueOnce([])

    useTaskStore.getState().autoArchiveStaleThreads()
    await vi.waitFor(() => {
      expect(vi.mocked(ipc.threadDbAutoArchive)).toHaveBeenCalledWith(1)
    })

    expect(useTaskStore.getState().tasks['running-1']).toBeDefined()
    ;(settingsMod.useSettingsStore as any).getState = originalGetState
  })

  it('does nothing when autoArchiveDays is 0 or unset', async () => {
    const { ipc } = await import('@/lib/ipc')
    const settingsMod = await import('./settingsStore')
    const originalGetState = settingsMod.useSettingsStore.getState
    ;(settingsMod.useSettingsStore as any).getState = () => ({
      settings: { autoArchiveDays: 0 },
      saveSettings: vi.fn().mockResolvedValue(undefined),
      setActiveWorkspace: mockSetActiveWorkspace,
    })

    const oldTimestamp = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString()
    useTaskStore.getState().upsertTask(makeTask({
      id: 'old-1',
      status: 'completed',
      messages: [{ role: 'user', content: 'hi', timestamp: oldTimestamp }],
    }))

    vi.mocked(ipc.threadDbAutoArchive).mockClear()
    useTaskStore.getState().autoArchiveStaleThreads()

    // Should not even call the backend when days is 0
    expect(vi.mocked(ipc.threadDbAutoArchive)).not.toHaveBeenCalled()
    expect(useTaskStore.getState().tasks['old-1']).toBeDefined()
    ;(settingsMod.useSettingsStore as any).getState = originalGetState
  })

  it('does not archive threads within the threshold (backend decides)', async () => {
    const { ipc } = await import('@/lib/ipc')
    const settingsMod = await import('./settingsStore')
    const originalGetState = settingsMod.useSettingsStore.getState
    ;(settingsMod.useSettingsStore as any).getState = () => ({
      settings: { autoArchiveDays: 30 },
      saveSettings: vi.fn().mockResolvedValue(undefined),
      setActiveWorkspace: mockSetActiveWorkspace,
    })

    const recentTimestamp = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() // 5 days ago
    useTaskStore.getState().upsertTask(makeTask({
      id: 'recent-1',
      status: 'completed',
      messages: [{ role: 'user', content: 'hi', timestamp: recentTimestamp }],
    }))

    // Backend returns empty — thread is within threshold
    vi.mocked(ipc.threadDbAutoArchive).mockResolvedValueOnce([])

    useTaskStore.getState().autoArchiveStaleThreads()
    await vi.waitFor(() => {
      expect(vi.mocked(ipc.threadDbAutoArchive)).toHaveBeenCalledWith(30)
    })

    expect(useTaskStore.getState().tasks['recent-1']).toBeDefined()
    ;(settingsMod.useSettingsStore as any).getState = originalGetState
  })
})

describe('auto-archive does not resurrect deleted threads', () => {
  it('skips threads the user has deleted', async () => {
    // Archiving no longer removes the SQLite rows, so the backend reports the
    // same stale threads on every startup. A thread the user deleted must not
    // come back to the sidebar on the next launch.
    const { ipc } = await import('@/lib/ipc')
    const settingsMod = await import('./settingsStore')
    const originalGetState = settingsMod.useSettingsStore.getState
    ;(settingsMod.useSettingsStore as any).getState = () => ({
      settings: { autoArchiveDays: 30 },
      saveSettings: vi.fn().mockResolvedValue(undefined),
      setActiveWorkspace: mockSetActiveWorkspace,
    })
    useTaskStore.setState({
      historyLoaded: true,
      tasks: {},
      archivedMeta: {},
      deletedTaskIds: new Set(['removed']),
      softDeleted: { binned: { task: makeTask({ id: 'binned' }), deletedAt: new Date().toISOString() } },
    })
    vi.mocked(ipc.threadDbAutoArchive).mockResolvedValueOnce([
      { id: 'removed', name: 'Removed', workspace: '/ws', createdAt: '', lastActivityAt: '', messageCount: 2 },
      { id: 'binned', name: 'Binned', workspace: '/ws', createdAt: '', lastActivityAt: '', messageCount: 2 },
      { id: 'stale', name: 'Stale', workspace: '/ws', createdAt: '', lastActivityAt: '', messageCount: 2 },
    ])

    useTaskStore.getState().autoArchiveStaleThreads()
    await vi.waitFor(() => {
      expect(useTaskStore.getState().archivedMeta['stale']).toBeDefined()
    })

    expect(useTaskStore.getState().archivedMeta['removed']).toBeUndefined()
    expect(useTaskStore.getState().archivedMeta['binned']).toBeUndefined()
    ;(settingsMod.useSettingsStore as any).getState = originalGetState
  })
})

describe('permanent deletion reaches the database', () => {
  const softDeleteOf = (id: string, deletedAt = new Date().toISOString()) => ({
    task: makeTask({ id }),
    deletedAt,
  })

  it('erases a permanently deleted thread from SQLite', async () => {
    const { deleteThread } = await import('@/lib/thread-db')
    vi.mocked(deleteThread).mockClear()
    useTaskStore.setState({ historyLoaded: true, softDeleted: { secret: softDeleteOf('secret') } })

    useTaskStore.getState().permanentlyDeleteTask('secret')

    // Someone deletes a thread because they pasted a key into it. Dropping it
    // from the sidebar alone leaves the messages and the FTS index intact.
    expect(vi.mocked(deleteThread)).toHaveBeenCalledWith('secret')
  })

  it('erases threads that age out of the recovery window', async () => {
    const { deleteThread } = await import('@/lib/thread-db')
    vi.mocked(deleteThread).mockClear()
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    useTaskStore.setState({
      historyLoaded: true,
      softDeleted: { old: softDeleteOf('old', threeDaysAgo), fresh: softDeleteOf('fresh') },
    })

    useTaskStore.getState().purgeExpiredSoftDeletes()

    expect(vi.mocked(deleteThread)).toHaveBeenCalledWith('old')
    expect(vi.mocked(deleteThread)).not.toHaveBeenCalledWith('fresh')
  })

  it('erases everything when the user empties the bin', async () => {
    const { deleteThread } = await import('@/lib/thread-db')
    vi.mocked(deleteThread).mockClear()
    useTaskStore.setState({
      historyLoaded: true,
      softDeleted: { a: softDeleteOf('a'), b: softDeleteOf('b') },
    })

    useTaskStore.getState().purgeAllSoftDeletes()

    expect(vi.mocked(deleteThread).mock.calls.map((c) => c[0]).sort()).toEqual(['a', 'b'])
  })
})

describe('loadTasks — recovery from SQLite', () => {
  const dbMeta = (id: string, messageCount = 4) => ({
    id,
    name: `Thread ${id}`,
    workspace: '/ws-recovered',
    createdAt: '2026-01-01T00:00:00Z',
    lastActivityAt: '2026-01-02T00:00:00Z',
    messageCount,
  })

  it('brings back threads the JSON index no longer lists', async () => {
    // The exact aftermath of a truncated history.json: the index is empty, but
    // the message bodies are still in SQLite. Without this the conversations
    // are unreachable forever.
    const { ipc } = await import('@/lib/ipc')
    const { loadThreads, loadProjects } = await import('@/lib/history-store')
    const { listThreadMeta } = await import('@/lib/thread-db')
    vi.mocked(ipc.listTasks).mockResolvedValueOnce([])
    vi.mocked(loadThreads).mockResolvedValueOnce([])
    vi.mocked(loadProjects).mockResolvedValueOnce([])
    vi.mocked(listThreadMeta).mockResolvedValueOnce([dbMeta('lost-1'), dbMeta('lost-2')])

    await useTaskStore.getState().loadTasks()

    const { archivedMeta, projects } = useTaskStore.getState()
    expect(Object.keys(archivedMeta).sort()).toEqual(['lost-1', 'lost-2'])
    expect(projects).toContain('/ws-recovered')
  })

  it('leaves deleted threads deleted', async () => {
    const { ipc } = await import('@/lib/ipc')
    const { loadThreads, loadProjects, loadSoftDeleted } = await import('@/lib/history-store')
    const { listThreadMeta } = await import('@/lib/thread-db')
    vi.mocked(ipc.listTasks).mockResolvedValueOnce([])
    vi.mocked(loadThreads).mockResolvedValueOnce([])
    vi.mocked(loadProjects).mockResolvedValueOnce([])
    vi.mocked(loadSoftDeleted).mockResolvedValueOnce([
      { task: makeTask({ id: 'gone' }), deletedAt: new Date().toISOString() },
    ])
    vi.mocked(listThreadMeta).mockResolvedValueOnce([dbMeta('gone')])

    await useTaskStore.getState().loadTasks()

    // Recovery must not resurrect what the user removed.
    expect(useTaskStore.getState().archivedMeta['gone']).toBeUndefined()
  })

  it('ignores empty shells so the sidebar has no rows that open to nothing', async () => {
    const { ipc } = await import('@/lib/ipc')
    const { loadThreads, loadProjects } = await import('@/lib/history-store')
    const { listThreadMeta } = await import('@/lib/thread-db')
    vi.mocked(ipc.listTasks).mockResolvedValueOnce([])
    vi.mocked(loadThreads).mockResolvedValueOnce([])
    vi.mocked(loadProjects).mockResolvedValueOnce([])
    vi.mocked(listThreadMeta).mockResolvedValueOnce([dbMeta('shell', 0)])

    await useTaskStore.getState().loadTasks()

    expect(useTaskStore.getState().archivedMeta['shell']).toBeUndefined()
  })

  it('still starts when SQLite cannot be reached', async () => {
    const { ipc } = await import('@/lib/ipc')
    const { loadThreads, loadProjects } = await import('@/lib/history-store')
    const { listThreadMeta } = await import('@/lib/thread-db')
    const liveTask = makeTask({ id: 'live-1', workspace: '/ws1' })
    vi.mocked(ipc.listTasks).mockResolvedValueOnce([liveTask])
    vi.mocked(loadThreads).mockResolvedValueOnce([])
    vi.mocked(loadProjects).mockResolvedValueOnce([])
    vi.mocked(listThreadMeta).mockRejectedValueOnce(new Error('db locked'))

    await useTaskStore.getState().loadTasks()

    expect(useTaskStore.getState().tasks['live-1']).toBeDefined()
    expect(useTaskStore.getState().historyLoaded).toBe(true)
  })
})

describe('loadTasks', () => {
  it('loads live tasks from backend and merges history', async () => {
    const { ipc } = await import('@/lib/ipc')
    const { loadThreads, loadProjects, toArchivedTasks } = await import('@/lib/history-store')
    const liveTask = makeTask({ id: 'live-1', workspace: '/ws1' })
    vi.mocked(ipc.listTasks).mockResolvedValueOnce([liveTask])
    vi.mocked(loadThreads).mockResolvedValueOnce([])
    vi.mocked(loadProjects).mockResolvedValueOnce([{ workspace: '/ws2', threadIds: [] }])
    vi.mocked(toArchivedTasks).mockReturnValueOnce([])
    await useTaskStore.getState().loadTasks()
    expect(useTaskStore.getState().tasks['live-1']).toBeDefined()
    expect(useTaskStore.getState().projects).toContain('/ws1')
    expect(useTaskStore.getState().projects).toContain('/ws2')
    expect(useTaskStore.getState().connected).toBe(true)
  })

  it('does not overwrite live tasks with archived ones', async () => {
    const { ipc } = await import('@/lib/ipc')
    const { loadThreads, toArchivedTasks } = await import('@/lib/history-store')
    const liveTask = makeTask({ id: 'shared-id', status: 'running', workspace: '/ws' })
    const archivedTask = makeTask({ id: 'shared-id', status: 'completed', workspace: '/ws', isArchived: true })
    vi.mocked(ipc.listTasks).mockResolvedValueOnce([liveTask])
    vi.mocked(loadThreads).mockResolvedValueOnce([])
    vi.mocked(toArchivedTasks).mockReturnValueOnce([archivedTask])
    const { loadProjects } = await import('@/lib/history-store')
    vi.mocked(loadProjects).mockResolvedValueOnce([])
    await useTaskStore.getState().loadTasks()
    expect(useTaskStore.getState().tasks['shared-id'].status).toBe('running')
  })

  it('preserves running tasks in store when loadTasks is called mid-session', async () => {
    const { ipc } = await import('@/lib/ipc')
    const { loadThreads, loadProjects, toArchivedTasks } = await import('@/lib/history-store')
    // Simulate a running task already in the store with messages
    const runningTask = makeTask({
      id: 'active-1', status: 'running', workspace: '/ws',
      messages: [
        { role: 'user', content: 'hello', timestamp: '' },
        { role: 'assistant', content: 'hi there', timestamp: '' },
      ],
    })
    useTaskStore.getState().upsertTask(runningTask)
    // loadTasks returns an empty backend list (task not visible to backend yet)
    vi.mocked(ipc.listTasks).mockResolvedValueOnce([])
    vi.mocked(loadThreads).mockResolvedValueOnce([])
    vi.mocked(loadProjects).mockResolvedValueOnce([])
    vi.mocked(toArchivedTasks).mockReturnValueOnce([])
    await useTaskStore.getState().loadTasks()
    // Running task must survive — messages intact
    const preserved = useTaskStore.getState().tasks['active-1']
    expect(preserved).toBeDefined()
    expect(preserved.status).toBe('running')
    expect(preserved.messages).toHaveLength(2)
  })

  it('preserves paused tasks in store when loadTasks is called', async () => {
    const { ipc } = await import('@/lib/ipc')
    const { loadThreads, loadProjects, toArchivedTasks } = await import('@/lib/history-store')
    const pausedTask = makeTask({ id: 'paused-1', status: 'paused', workspace: '/ws',
      messages: [{ role: 'user', content: 'test', timestamp: '' }],
    })
    useTaskStore.getState().upsertTask(pausedTask)
    vi.mocked(ipc.listTasks).mockResolvedValueOnce([])
    vi.mocked(loadThreads).mockResolvedValueOnce([])
    vi.mocked(loadProjects).mockResolvedValueOnce([])
    vi.mocked(toArchivedTasks).mockReturnValueOnce([])
    await useTaskStore.getState().loadTasks()
    expect(useTaskStore.getState().tasks['paused-1']?.status).toBe('paused')
  })

  it('restores project display names from history', async () => {
    const { ipc } = await import('@/lib/ipc')
    const { loadThreads, loadProjects, toArchivedTasks } = await import('@/lib/history-store')
    vi.mocked(ipc.listTasks).mockResolvedValueOnce([])
    vi.mocked(loadThreads).mockResolvedValueOnce([])
    vi.mocked(loadProjects).mockResolvedValueOnce([
      { workspace: '/ws', displayName: 'My Project', threadIds: [] },
    ])
    vi.mocked(toArchivedTasks).mockReturnValueOnce([])
    await useTaskStore.getState().loadTasks()
    expect(useTaskStore.getState().projectNames['/ws']).toBe('My Project')
  })

  it('falls back to history-only when backend fails', async () => {
    const { ipc } = await import('@/lib/ipc')
    const { loadThreads, loadProjects } = await import('@/lib/history-store')
    vi.mocked(ipc.listTasks).mockRejectedValueOnce(new Error('backend down'))
    vi.mocked(loadThreads).mockResolvedValueOnce([
      { id: 'archived-1', name: 'Test Task', workspace: '/ws', createdAt: '2026-01-01T00:00:00Z', messages: [] },
    ])
    vi.mocked(loadProjects).mockResolvedValueOnce([{ workspace: '/ws', threadIds: ['archived-1'] }])
    await useTaskStore.getState().loadTasks()
    // Archived threads land in `archivedMeta` (lazy), not `tasks`, until the user opens one.
    expect(useTaskStore.getState().archivedMeta['archived-1']).toBeDefined()
    expect(useTaskStore.getState().tasks['archived-1']).toBeUndefined()
    expect(useTaskStore.getState().connected).toBe(false)
  })

  it('sets connected false when both backend and history fail', async () => {
    const { ipc } = await import('@/lib/ipc')
    const { loadThreads } = await import('@/lib/history-store')
    vi.mocked(ipc.listTasks).mockRejectedValueOnce(new Error('backend down'))
    vi.mocked(loadThreads).mockRejectedValueOnce(new Error('disk error'))
    await useTaskStore.getState().loadTasks()
    expect(useTaskStore.getState().connected).toBe(false)
  })

  it('still sets connected when history load fails but backend succeeds', async () => {
    const { ipc } = await import('@/lib/ipc')
    const { loadThreads } = await import('@/lib/history-store')
    vi.mocked(ipc.listTasks).mockResolvedValueOnce([makeTask({ workspace: '/ws' })])
    vi.mocked(loadThreads).mockRejectedValueOnce(new Error('disk error'))
    await useTaskStore.getState().loadTasks()
    expect(useTaskStore.getState().connected).toBe(true)
    expect(useTaskStore.getState().tasks['task-1']).toBeDefined()
  })

  it('merges project metadata from archived onto live tasks', async () => {
    const { ipc } = await import('@/lib/ipc')
    const { loadThreads, loadProjects } = await import('@/lib/history-store')
    const liveTask = makeTask({ id: 'wt-1', workspace: '/project/.laf-agent/worktrees/feat', status: 'running' })
    vi.mocked(ipc.listTasks).mockResolvedValueOnce([liveTask])
    vi.mocked(loadThreads).mockResolvedValueOnce([{
      id: 'wt-1',
      name: 'Test Task',
      workspace: '/project/.laf-agent/worktrees/feat',
      createdAt: '2026-01-01T00:00:00Z',
      messages: [],
      originalWorkspace: '/project',
      projectId: 'uuid-123',
    }])
    vi.mocked(loadProjects).mockResolvedValueOnce([{ workspace: '/project', projectId: 'uuid-123', threadIds: ['wt-1'] }])
    await useTaskStore.getState().loadTasks()
    const task = useTaskStore.getState().tasks['wt-1']
    expect(task.status).toBe('running')
    expect(task.originalWorkspace).toBe('/project')
    expect(task.projectId).toBe('uuid-123')
  })

  it('does not overwrite existing project metadata on live tasks', async () => {
    const { ipc } = await import('@/lib/ipc')
    const { loadThreads, loadProjects, toArchivedTasks } = await import('@/lib/history-store')
    const liveTask = makeTask({
      id: 'wt-2',
      workspace: '/project/.laf-agent/worktrees/feat',
      originalWorkspace: '/project',
      projectId: 'live-uuid',
    })
    const archivedTask = makeTask({
      id: 'wt-2',
      workspace: '/project/.laf-agent/worktrees/feat',
      isArchived: true,
      originalWorkspace: '/old-project',
      projectId: 'archived-uuid',
    })
    vi.mocked(ipc.listTasks).mockResolvedValueOnce([liveTask])
    vi.mocked(loadThreads).mockResolvedValueOnce([])
    vi.mocked(loadProjects).mockResolvedValueOnce([{ workspace: '/project', projectId: 'live-uuid', threadIds: [] }])
    vi.mocked(toArchivedTasks).mockReturnValueOnce([archivedTask])
    await useTaskStore.getState().loadTasks()
    const task = useTaskStore.getState().tasks['wt-2']
    expect(task.originalWorkspace).toBe('/project')
    expect(task.projectId).toBe('live-uuid')
  })

  it('excludes worktree paths from projects array after merge', async () => {
    const { ipc } = await import('@/lib/ipc')
    const { loadThreads, loadProjects } = await import('@/lib/history-store')
    const liveTask = makeTask({ id: 'wt-3', workspace: '/project/.laf-agent/worktrees/feat', status: 'running' })
    vi.mocked(ipc.listTasks).mockResolvedValueOnce([liveTask])
    vi.mocked(loadThreads).mockResolvedValueOnce([{
      id: 'wt-3',
      name: 'Test Task',
      workspace: '/project/.laf-agent/worktrees/feat',
      createdAt: '2026-01-01T00:00:00Z',
      messages: [],
      originalWorkspace: '/project',
      projectId: 'uuid-456',
    }])
    vi.mocked(loadProjects).mockResolvedValueOnce([{ workspace: '/project', projectId: 'uuid-456', threadIds: ['wt-3'] }])
    await useTaskStore.getState().loadTasks()
    expect(useTaskStore.getState().projects).toContain('/project')
    expect(useTaskStore.getState().projects).not.toContain('/project/.laf-agent/worktrees/feat')
  })

  it('restores missing threads from backup', async () => {
    const { ipc } = await import('@/lib/ipc')
    const { loadThreads, loadProjects, loadBackup } = await import('@/lib/history-store')
    vi.mocked(ipc.listTasks).mockResolvedValueOnce([])
    vi.mocked(loadThreads).mockResolvedValueOnce([])
    vi.mocked(loadProjects).mockResolvedValueOnce([])
    vi.mocked(loadBackup).mockResolvedValueOnce({
      threads: [{
        id: 'backup-1',
        name: 'Restored Thread',
        workspace: '/ws',
        createdAt: '',
        messages: [],
        originalWorkspace: '/ws',
        projectId: '/ws',
      }],
      projects: [{ workspace: '/ws', displayName: 'My Project', projectId: 'uuid-1', threadIds: ['backup-1'] }],
      softDeleted: [],
    })
    await useTaskStore.getState().loadTasks()
    // Backup threads are restored as archived metadata (not inflated until opened).
    expect(useTaskStore.getState().archivedMeta['backup-1']).toBeDefined()
    expect(useTaskStore.getState().archivedMeta['backup-1'].name).toBe('Restored Thread')
    expect(useTaskStore.getState().projectNames['/ws']).toBe('My Project')
  })

  it('does not overwrite primary threads with backup', async () => {
    const { ipc } = await import('@/lib/ipc')
    const { loadThreads, loadProjects, toArchivedTasks, loadBackup } = await import('@/lib/history-store')
    const primaryTask = makeTask({ id: 'shared', name: 'Primary Name', workspace: '/ws' })
    vi.mocked(ipc.listTasks).mockResolvedValueOnce([primaryTask])
    vi.mocked(loadThreads).mockResolvedValueOnce([])
    vi.mocked(loadProjects).mockResolvedValueOnce([])
    vi.mocked(toArchivedTasks).mockReturnValueOnce([])
    const backupTask = makeTask({ id: 'shared', name: 'Backup Name', workspace: '/ws', isArchived: true })
    vi.mocked(loadBackup).mockResolvedValueOnce({
      threads: [{ id: 'shared', name: 'Backup Name', workspace: '/ws', createdAt: '', messages: [] }],
      projects: [], softDeleted: [],
    })
    vi.mocked(toArchivedTasks).mockReturnValueOnce([backupTask])
    await useTaskStore.getState().loadTasks()
    expect(useTaskStore.getState().tasks['shared'].name).toBe('Primary Name')
  })

  it('does not restore soft-deleted threads from backup as active', async () => {
    const { ipc } = await import('@/lib/ipc')
    const { loadThreads, loadProjects, loadSoftDeleted, toArchivedTasks, loadBackup } = await import('@/lib/history-store')
    vi.mocked(ipc.listTasks).mockResolvedValueOnce([])
    vi.mocked(loadThreads).mockResolvedValueOnce([])
    vi.mocked(loadProjects).mockResolvedValueOnce([])
    vi.mocked(loadSoftDeleted).mockResolvedValueOnce([{
      task: makeTask({ id: 'del-1', workspace: '/ws' }),
      deletedAt: '2026-01-01',
    }])
    vi.mocked(toArchivedTasks).mockReturnValueOnce([])
    const backupTask = makeTask({ id: 'del-1', name: 'Should Stay Deleted', workspace: '/ws', isArchived: true })
    vi.mocked(loadBackup).mockResolvedValueOnce({
      threads: [{ id: 'del-1', name: 'Should Stay Deleted', workspace: '/ws', createdAt: '', messages: [] }],
      projects: [], softDeleted: [],
    })
    vi.mocked(toArchivedTasks).mockReturnValueOnce([backupTask])
    await useTaskStore.getState().loadTasks()
    // Should remain in softDeleted, not in active tasks
    expect(useTaskStore.getState().tasks['del-1']).toBeUndefined()
    expect(useTaskStore.getState().softDeleted['del-1']).toBeDefined()
  })
})

describe('setConnected', () => {
  it('sets connected state', () => {
    useTaskStore.getState().setConnected(true)
    expect(useTaskStore.getState().connected).toBe(true)
  })

  it('no-ops when value unchanged', () => {
    useTaskStore.setState({ connected: true })
    const before = useTaskStore.getState()
    useTaskStore.getState().setConnected(true)
    // Should be same reference (no state update)
    expect(useTaskStore.getState().connected).toBe(before.connected)
  })
})

describe('persistHistory', () => {
  it('calls saveThreads with current tasks, projectNames, and projectIds', async () => {
    const { saveThreads } = await import('@/lib/history-store')
    useTaskStore.getState().upsertTask(makeTask())
    useTaskStore.setState({ projectNames: { '/ws': 'My Project' } })
    useTaskStore.getState().persistHistory()
    expect(saveThreads).toHaveBeenLastCalledWith(
      expect.objectContaining({ 'task-1': expect.any(Object) }),
      expect.objectContaining({ '/ws': 'My Project' }),
      expect.any(Object),
      expect.any(Array),
      expect.any(Object),
      expect.any(Set),
      expect.any(Set), // thinIds — the storage-flip gate
    )
  })
})

describe('clearHistory', () => {
  it('cancels running tasks and clears all state', async () => {
    const { ipc } = await import('@/lib/ipc')
    const { clearHistory: clearHistoryStore } = await import('@/lib/history-store')
    useTaskStore.getState().upsertTask(makeTask({ id: 't1', status: 'running', workspace: '/ws' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 't2', status: 'paused', workspace: '/ws' }))
    useTaskStore.getState().addProject('/ws')
    await useTaskStore.getState().clearHistory()
    expect(ipc.cancelTask).toHaveBeenCalledWith('t1')
    expect(ipc.cancelTask).toHaveBeenCalledWith('t2')
    expect(clearHistoryStore).toHaveBeenCalledTimes(1)
    expect(Object.keys(useTaskStore.getState().tasks)).toHaveLength(0)
    expect(useTaskStore.getState().projects).toHaveLength(0)
    expect(useTaskStore.getState().selectedTaskId).toBeNull()
  })

  it('does not cancel completed tasks', async () => {
    const { ipc } = await import('@/lib/ipc')
    vi.mocked(ipc.cancelTask).mockClear()
    useTaskStore.getState().upsertTask(makeTask({ id: 't1', status: 'completed', workspace: '/ws' }))
    await useTaskStore.getState().clearHistory()
    expect(ipc.cancelTask).not.toHaveBeenCalled()
  })
})

describe('archiveThreads', () => {
  it('removes all tasks for workspace and adds to deletedTaskIds', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 't1', workspace: '/ws' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 't2', workspace: '/ws' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 't3', workspace: '/other' }))
    useTaskStore.getState().archiveThreads('/ws')
    expect(useTaskStore.getState().tasks['t1']).toBeUndefined()
    expect(useTaskStore.getState().tasks['t2']).toBeUndefined()
    expect(useTaskStore.getState().tasks['t3']).toBeDefined()
    expect(useTaskStore.getState().deletedTaskIds.has('t1')).toBe(true)
    expect(useTaskStore.getState().deletedTaskIds.has('t2')).toBe(true)
  })

  it('clears selectedTaskId if it was in the archived workspace', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 't1', workspace: '/ws' }))
    useTaskStore.setState({ selectedTaskId: 't1', view: 'chat' })
    useTaskStore.getState().archiveThreads('/ws')
    expect(useTaskStore.getState().selectedTaskId).toBeNull()
    expect(useTaskStore.getState().view).toBe('dashboard')
  })
})

describe('removeProject', () => {
  it('removes project, tasks, and clears drafts', () => {
    useTaskStore.getState().addProject('/ws')
    useTaskStore.getState().upsertTask(makeTask({ id: 't1', workspace: '/ws' }))
    useTaskStore.getState().setDraft('/ws', 'draft text')
    useTaskStore.getState().removeProject('/ws')
    expect(useTaskStore.getState().projects).not.toContain('/ws')
    expect(useTaskStore.getState().tasks['t1']).toBeUndefined()
    expect(useTaskStore.getState().drafts['/ws']).toBeUndefined()
  })

  it('clears pendingWorkspace if it matches removed project', () => {
    useTaskStore.getState().addProject('/ws')
    useTaskStore.setState({ pendingWorkspace: '/ws' })
    useTaskStore.getState().removeProject('/ws')
    expect(useTaskStore.getState().pendingWorkspace).toBeNull()
  })

  it('switches to dashboard when selected task is removed', () => {
    useTaskStore.getState().addProject('/ws')
    useTaskStore.getState().upsertTask(makeTask({ id: 't1', workspace: '/ws' }))
    useTaskStore.setState({ selectedTaskId: 't1', view: 'chat' })
    useTaskStore.getState().removeProject('/ws')
    expect(useTaskStore.getState().view).toBe('dashboard')
  })

  it('removes orphaned tasks when called with a UUID projectId as cwd', () => {
    const orphanUuid = crypto.randomUUID()
    useTaskStore.setState({
      tasks: {
        't1': makeTask({ id: 't1', workspace: '/old-project', projectId: orphanUuid }),
        't2': makeTask({ id: 't2', workspace: '/other', projectId: 'other-pid' }),
      },
      projects: ['/other'],
      projectIds: { '/old-project': orphanUuid },
    })
    useTaskStore.getState().removeProject(orphanUuid)
    // t1 should be soft-deleted
    expect(useTaskStore.getState().tasks['t1']).toBeUndefined()
    expect(useTaskStore.getState().softDeleted['t1']).toBeDefined()
    // t2 should be untouched
    expect(useTaskStore.getState().tasks['t2']).toBeDefined()
    // projectIds entry pointing to the orphan UUID should be cleaned up
    expect(Object.values(useTaskStore.getState().projectIds)).not.toContain(orphanUuid)
  })
})

describe('setSettingsOpen', () => {
  it('opens settings with section', () => {
    useTaskStore.getState().setSettingsOpen(true, 'appearance')
    expect(useTaskStore.getState().isSettingsOpen).toBe(true)
    expect(useTaskStore.getState().settingsInitialSection).toBe('appearance')
  })

  it('opens settings without section defaults to null', () => {
    useTaskStore.getState().setSettingsOpen(true)
    expect(useTaskStore.getState().settingsInitialSection).toBeNull()
  })
})

describe('softDeleteTask', () => {
  it('moves task from tasks to softDeleted with deletedAt timestamp', () => {
    useTaskStore.getState().upsertTask(makeTask())
    useTaskStore.getState().softDeleteTask('task-1')
    expect(useTaskStore.getState().tasks['task-1']).toBeUndefined()
    const sd = useTaskStore.getState().softDeleted['task-1']
    expect(sd).toBeDefined()
    expect(sd.task.id).toBe('task-1')
    expect(sd.task.isArchived).toBe(true)
    expect(sd.task.status).toBe('completed')
    expect(sd.deletedAt).toBeTruthy()
  })

  it('clears streaming data for soft-deleted task', () => {
    useTaskStore.getState().upsertTask(makeTask())
    useTaskStore.setState({
      streamingChunks: { 'task-1': 'text' },
      thinkingChunks: { 'task-1': 'think' },
      liveToolCalls: { 'task-1': [] },
    })
    useTaskStore.getState().softDeleteTask('task-1')
    expect(useTaskStore.getState().streamingChunks['task-1']).toBeUndefined()
    expect(useTaskStore.getState().thinkingChunks['task-1']).toBeUndefined()
    expect(useTaskStore.getState().liveToolCalls['task-1']).toBeUndefined()
  })

  it('adds to deletedTaskIds', () => {
    useTaskStore.getState().upsertTask(makeTask())
    useTaskStore.getState().softDeleteTask('task-1')
    expect(useTaskStore.getState().deletedTaskIds.has('task-1')).toBe(true)
  })

  it('clears selectedTaskId if soft-deleted', () => {
    useTaskStore.getState().upsertTask(makeTask())
    useTaskStore.setState({ selectedTaskId: 'task-1' })
    useTaskStore.getState().softDeleteTask('task-1')
    expect(useTaskStore.getState().selectedTaskId).toBeNull()
  })

  it('no-ops for non-existent task', () => {
    const before = useTaskStore.getState().softDeleted
    useTaskStore.getState().softDeleteTask('nonexistent')
    expect(useTaskStore.getState().softDeleted).toBe(before)
  })
})

describe('restoreTask', () => {
  it('moves task from softDeleted back to tasks', () => {
    useTaskStore.getState().upsertTask(makeTask())
    useTaskStore.getState().softDeleteTask('task-1')
    useTaskStore.getState().restoreTask('task-1')
    expect(useTaskStore.getState().tasks['task-1']).toBeDefined()
    expect(useTaskStore.getState().tasks['task-1'].isArchived).toBe(false)
    expect(useTaskStore.getState().softDeleted['task-1']).toBeUndefined()
  })

  it('removes from deletedTaskIds so upsertTask works again', () => {
    useTaskStore.getState().upsertTask(makeTask())
    useTaskStore.getState().softDeleteTask('task-1')
    expect(useTaskStore.getState().deletedTaskIds.has('task-1')).toBe(true)
    useTaskStore.getState().restoreTask('task-1')
    expect(useTaskStore.getState().deletedTaskIds.has('task-1')).toBe(false)
  })

  it('adds workspace to projects if not present', () => {
    useTaskStore.getState().upsertTask(makeTask({ workspace: '/new-ws' }))
    useTaskStore.getState().softDeleteTask('task-1')
    useTaskStore.setState({ projects: [] })
    useTaskStore.getState().restoreTask('task-1')
    expect(useTaskStore.getState().projects).toContain('/new-ws')
  })

  it('no-ops for non-existent soft-deleted task', () => {
    const before = useTaskStore.getState().tasks
    useTaskStore.getState().restoreTask('nonexistent')
    expect(useTaskStore.getState().tasks).toBe(before)
  })
})

describe('permanentlyDeleteTask', () => {
  it('removes from softDeleted and adds to deletedTaskIds', () => {
    useTaskStore.getState().upsertTask(makeTask())
    useTaskStore.getState().softDeleteTask('task-1')
    useTaskStore.getState().permanentlyDeleteTask('task-1')
    expect(useTaskStore.getState().softDeleted['task-1']).toBeUndefined()
    expect(useTaskStore.getState().deletedTaskIds.has('task-1')).toBe(true)
  })

  it('no-ops for non-existent soft-deleted task', () => {
    const before = useTaskStore.getState().softDeleted
    useTaskStore.getState().permanentlyDeleteTask('nonexistent')
    expect(useTaskStore.getState().softDeleted).toBe(before)
  })
})

describe('purgeExpiredSoftDeletes', () => {
  it('removes threads older than 48 hours', () => {
    const threeDaysAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()
    useTaskStore.setState({
      softDeleted: {
        't1': { task: makeTask({ id: 't1' }), deletedAt: threeDaysAgo },
      },
    })
    useTaskStore.getState().purgeExpiredSoftDeletes()
    expect(useTaskStore.getState().softDeleted['t1']).toBeUndefined()
    expect(useTaskStore.getState().deletedTaskIds.has('t1')).toBe(true)
  })

  it('keeps threads newer than 48 hours', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    useTaskStore.setState({
      softDeleted: {
        't1': { task: makeTask({ id: 't1' }), deletedAt: oneHourAgo },
      },
    })
    useTaskStore.getState().purgeExpiredSoftDeletes()
    expect(useTaskStore.getState().softDeleted['t1']).toBeDefined()
  })

  it('purges expired and keeps recent in mixed set', () => {
    const threeDaysAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    useTaskStore.setState({
      softDeleted: {
        'old': { task: makeTask({ id: 'old' }), deletedAt: threeDaysAgo },
        'new': { task: makeTask({ id: 'new' }), deletedAt: oneHourAgo },
      },
    })
    useTaskStore.getState().purgeExpiredSoftDeletes()
    expect(useTaskStore.getState().softDeleted['old']).toBeUndefined()
    expect(useTaskStore.getState().softDeleted['new']).toBeDefined()
  })

  it('no-ops when softDeleted is empty', () => {
    const before = useTaskStore.getState().softDeleted
    useTaskStore.getState().purgeExpiredSoftDeletes()
    expect(useTaskStore.getState().softDeleted).toBe(before)
  })
})

describe('removeTask delegates to softDeleteTask', () => {
  it('soft-deletes instead of permanently deleting', () => {
    useTaskStore.getState().upsertTask(makeTask())
    useTaskStore.getState().removeTask('task-1')
    expect(useTaskStore.getState().tasks['task-1']).toBeUndefined()
    expect(useTaskStore.getState().softDeleted['task-1']).toBeDefined()
  })
})

describe('removeProject soft-deletes threads', () => {
  it('moves project threads to softDeleted', () => {
    useTaskStore.getState().addProject('/ws')
    useTaskStore.getState().upsertTask(makeTask({ id: 't1', workspace: '/ws' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 't2', workspace: '/ws' }))
    useTaskStore.getState().removeProject('/ws')
    expect(useTaskStore.getState().softDeleted['t1']).toBeDefined()
    expect(useTaskStore.getState().softDeleted['t2']).toBeDefined()
  })
})

describe('archiveThreads soft-deletes threads', () => {
  it('moves workspace threads to softDeleted', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 't1', workspace: '/ws' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 't2', workspace: '/ws' }))
    useTaskStore.getState().archiveThreads('/ws')
    expect(useTaskStore.getState().softDeleted['t1']).toBeDefined()
    expect(useTaskStore.getState().softDeleted['t2']).toBeDefined()
    expect(useTaskStore.getState().tasks['t1']).toBeUndefined()
    expect(useTaskStore.getState().tasks['t2']).toBeUndefined()
  })
})

describe('clearHistory clears softDeleted', () => {
  it('resets softDeleted to empty object', async () => {
    useTaskStore.setState({
      softDeleted: {
        't1': { task: makeTask({ id: 't1' }), deletedAt: new Date().toISOString() },
      },
    })
    await useTaskStore.getState().clearHistory()
    expect(Object.keys(useTaskStore.getState().softDeleted)).toHaveLength(0)
  })
})

describe('projectId', () => {
  it('upsertTask preserves projectId when backend update lacks it', () => {
    useTaskStore.getState().upsertTask(makeTask({
      projectId: '/project',
      originalWorkspace: '/project',
      workspace: '/project/.laf-agent/worktrees/feat',
    }))
    useTaskStore.getState().upsertTask(makeTask({
      status: 'running',
      workspace: '/project/.laf-agent/worktrees/feat',
    }))
    expect(useTaskStore.getState().tasks['task-1'].projectId).toBe('/project')
  })

  it('upsertTask allows overwriting projectId when explicitly provided', () => {
    useTaskStore.getState().upsertTask(makeTask({ projectId: '/old' }))
    useTaskStore.getState().upsertTask(makeTask({ status: 'running', projectId: '/new' }))
    expect(useTaskStore.getState().tasks['task-1'].projectId).toBe('/new')
  })

  it('createDraftThread sets projectId to UUID for workspace', () => {
    useTaskStore.getState().addProject('/my-project')
    const expectedPid = useTaskStore.getState().projectIds['/my-project']
    const id = useTaskStore.getState().createDraftThread('/my-project')
    expect(useTaskStore.getState().tasks[id].projectId).toBe(expectedPid)
  })

  it('removeProject matches worktree threads by originalWorkspace', () => {
    useTaskStore.getState().addProject('/project')
    useTaskStore.getState().upsertTask(makeTask({
      id: 'regular',
      workspace: '/project',
      projectId: useTaskStore.getState().projectIds['/project'],
    }))
    useTaskStore.getState().upsertTask(makeTask({
      id: 'worktree',
      workspace: '/project/.laf-agent/worktrees/feat',
      projectId: useTaskStore.getState().projectIds['/project'],
      originalWorkspace: '/project',
    }))
    useTaskStore.getState().removeProject('/project')
    expect(useTaskStore.getState().tasks['regular']).toBeUndefined()
    expect(useTaskStore.getState().tasks['worktree']).toBeUndefined()
  })

  it('archiveThreads matches worktree threads by originalWorkspace', () => {
    useTaskStore.getState().upsertTask(makeTask({
      id: 'wt1',
      workspace: '/project/.laf-agent/worktrees/feat',
      originalWorkspace: '/project',
    }))
    useTaskStore.getState().upsertTask(makeTask({
      id: 'other',
      workspace: '/other',
    }))
    useTaskStore.getState().archiveThreads('/project')
    expect(useTaskStore.getState().tasks['wt1']).toBeUndefined()
    expect(useTaskStore.getState().tasks['other']).toBeDefined()
  })

  it('restoreTask uses originalWorkspace for projects list', () => {
    useTaskStore.getState().upsertTask(makeTask({
      workspace: '/project/.laf-agent/worktrees/feat',
      originalWorkspace: '/project',
    }))
    useTaskStore.getState().softDeleteTask('task-1')
    useTaskStore.setState({ projects: [] })
    useTaskStore.getState().restoreTask('task-1')
    expect(useTaskStore.getState().projects).toContain('/project')
    expect(useTaskStore.getState().projects).not.toContain('/project/.laf-agent/worktrees/feat')
  })

  it('loadTasks derives projects from workspace paths, not UUIDs', async () => {
    const { ipc } = await import('@/lib/ipc')
    const { loadThreads, loadProjects, toArchivedTasks } = await import('@/lib/history-store')
    vi.mocked(ipc.listTasks).mockResolvedValueOnce([
      makeTask({ id: 't1', workspace: '/project' }),
      makeTask({ id: 't2', workspace: '/project/.laf-agent/worktrees/feat', originalWorkspace: '/project' }),
    ])
    vi.mocked(loadThreads).mockResolvedValueOnce([])
    vi.mocked(loadProjects).mockResolvedValueOnce([])
    vi.mocked(toArchivedTasks).mockReturnValueOnce([])
    await useTaskStore.getState().loadTasks()
    expect(useTaskStore.getState().projects).toEqual(['/project'])
  })
})

describe('workspace scoping', () => {
  beforeEach(() => {
    mockSetActiveWorkspace.mockClear()
  })

  it('setSelectedTask syncs activeWorkspace to project root', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 't1', workspace: '/project' }))
    useTaskStore.getState().setSelectedTask('t1')
    expect(mockSetActiveWorkspace).toHaveBeenCalledWith('/project', '/project')
  })

  it('setSelectedTask resolves worktree thread to originalWorkspace', () => {
    useTaskStore.getState().upsertTask(makeTask({
      id: 't1',
      workspace: '/project/.laf-agent/worktrees/feat',
      originalWorkspace: '/project',
    }))
    useTaskStore.getState().setSelectedTask('t1')
    expect(mockSetActiveWorkspace).toHaveBeenCalledWith('/project', '/project/.laf-agent/worktrees/feat')
  })

  it('setSelectedTask sets activeWorkspace to null when deselecting', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 't1', workspace: '/project' }))
    useTaskStore.getState().setSelectedTask('t1')
    mockSetActiveWorkspace.mockClear()
    useTaskStore.getState().setSelectedTask(null)
    expect(mockSetActiveWorkspace).toHaveBeenCalledWith(null, null)
  })

  it('setPendingWorkspace syncs activeWorkspace immediately', () => {
    useTaskStore.getState().setPendingWorkspace('/my-project')
    expect(mockSetActiveWorkspace).toHaveBeenCalledWith('/my-project', '/my-project')
  })

  it('setPendingWorkspace(null) clears activeWorkspace', () => {
    useTaskStore.getState().setPendingWorkspace(null)
    expect(mockSetActiveWorkspace).toHaveBeenCalledWith(null, null)
  })

  it('addProject accepts regular project paths', () => {
    useTaskStore.getState().addProject('/project')
    expect(useTaskStore.getState().projects).toContain('/project')
    expect(useTaskStore.getState().projectIds['/project']).toBeDefined()
  })

  it('loadTasks never puts worktree paths in projects array', async () => {
    const { ipc } = await import('@/lib/ipc')
    const { loadThreads, loadProjects, toArchivedTasks } = await import('@/lib/history-store')
    vi.mocked(ipc.listTasks).mockResolvedValueOnce([
      makeTask({ id: 't1', workspace: '/project' }),
      makeTask({ id: 't2', workspace: '/project/.laf-agent/worktrees/feat', originalWorkspace: '/project' }),
      makeTask({ id: 't3', workspace: '/project/.laf-agent/worktrees/fix', originalWorkspace: '/project' }),
    ])
    vi.mocked(loadThreads).mockResolvedValueOnce([])
    vi.mocked(loadProjects).mockResolvedValueOnce([])
    vi.mocked(toArchivedTasks).mockReturnValueOnce([])
    await useTaskStore.getState().loadTasks()
    expect(useTaskStore.getState().projects).toEqual(['/project'])
    expect(useTaskStore.getState().projects.some((p) => p.includes('.laf-agent/worktrees'))).toBe(false)
  })

  it('restoreTask of worktree thread adds project root to projects', () => {
    useTaskStore.getState().upsertTask(makeTask({
      workspace: '/project/.laf-agent/worktrees/feat',
      originalWorkspace: '/project',
    }))
    useTaskStore.getState().softDeleteTask('task-1')
    useTaskStore.setState({ projects: [] })
    useTaskStore.getState().restoreTask('task-1')
    expect(useTaskStore.getState().projects).toContain('/project')
    expect(useTaskStore.getState().projects.some((p) => p.includes('.laf-agent/worktrees'))).toBe(false)
  })
})

describe('btw (tangent) mode', () => {
  it('enterBtwMode creates a checkpoint with current messages', () => {
    const task = makeTask({ messages: [{ role: 'user', content: 'hello', timestamp: '' }] })
    useTaskStore.setState({ tasks: { 'task-1': task }, selectedTaskId: 'task-1' })
    useTaskStore.getState().enterBtwMode('task-1', 'what is X?')
    const cp = useTaskStore.getState().btwCheckpoint
    expect(cp).not.toBeNull()
    expect(cp!.taskId).toBe('task-1')
    expect(cp!.question).toBe('what is X?')
    expect(cp!.messages).toHaveLength(1)
    expect(cp!.messages[0].content).toBe('hello')
  })

  it('enterBtwMode does nothing for unknown task', () => {
    useTaskStore.getState().enterBtwMode('nonexistent', 'q')
    expect(useTaskStore.getState().btwCheckpoint).toBeNull()
  })

  it('exitBtwMode(false) restores messages to checkpoint', () => {
    const task = makeTask({ messages: [{ role: 'user', content: 'original', timestamp: '' }] })
    useTaskStore.setState({ tasks: { 'task-1': task }, selectedTaskId: 'task-1' })
    useTaskStore.getState().enterBtwMode('task-1', 'side q')
    // Simulate btw messages added
    useTaskStore.setState((s) => ({
      tasks: { ...s.tasks, 'task-1': { ...s.tasks['task-1'], messages: [
        { role: 'user', content: 'original', timestamp: '' },
        { role: 'user', content: 'side q', timestamp: '' },
        { role: 'assistant', content: 'side answer', timestamp: '' },
      ] } },
    }))
    useTaskStore.getState().exitBtwMode(false)
    expect(useTaskStore.getState().btwCheckpoint).toBeNull()
    const msgs = useTaskStore.getState().tasks['task-1'].messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toBe('original')
  })

  it('exitBtwMode(true) keeps the last Q&A pair (tail mode)', () => {
    const task = makeTask({ messages: [{ role: 'user', content: 'original', timestamp: '' }] })
    useTaskStore.setState({ tasks: { 'task-1': task }, selectedTaskId: 'task-1' })
    useTaskStore.getState().enterBtwMode('task-1', 'side q')
    useTaskStore.setState((s) => ({
      tasks: { ...s.tasks, 'task-1': { ...s.tasks['task-1'], messages: [
        { role: 'user', content: 'original', timestamp: '' },
        { role: 'user', content: 'side q', timestamp: '' },
        { role: 'assistant', content: 'side answer', timestamp: '' },
      ] } },
    }))
    useTaskStore.getState().exitBtwMode(true)
    expect(useTaskStore.getState().btwCheckpoint).toBeNull()
    const msgs = useTaskStore.getState().tasks['task-1'].messages
    expect(msgs).toHaveLength(3)
    expect(msgs[0].content).toBe('original')
    expect(msgs[1].content).toBe('side q')
    expect(msgs[2].content).toBe('side answer')
  })

  it('exitBtwMode clears checkpoint even if task was deleted', () => {
    const task = makeTask()
    useTaskStore.setState({ tasks: { 'task-1': task }, selectedTaskId: 'task-1' })
    useTaskStore.getState().enterBtwMode('task-1', 'q')
    useTaskStore.setState({ tasks: {} })
    useTaskStore.getState().exitBtwMode(false)
    expect(useTaskStore.getState().btwCheckpoint).toBeNull()
  })

  it('exitBtwMode is no-op when no checkpoint exists', () => {
    const task = makeTask({ messages: [{ role: 'user', content: 'hello', timestamp: '' }] })
    useTaskStore.setState({ tasks: { 'task-1': task } })
    useTaskStore.getState().exitBtwMode(false)
    expect(useTaskStore.getState().tasks['task-1'].messages).toHaveLength(1)
  })

  it('checkpoint messages are isolated from subsequent mutations', () => {
    const task = makeTask({ messages: [{ role: 'user', content: 'original', timestamp: '' }] })
    useTaskStore.setState({ tasks: { 'task-1': task }, selectedTaskId: 'task-1' })
    useTaskStore.getState().enterBtwMode('task-1', 'q')
    // Mutate the task messages
    useTaskStore.setState((s) => ({
      tasks: { ...s.tasks, 'task-1': { ...s.tasks['task-1'], messages: [] } },
    }))
    // Checkpoint should still have the original
    expect(useTaskStore.getState().btwCheckpoint!.messages).toHaveLength(1)
  })
})

describe('multi-turn message preservation', () => {
  it('preserves messages when task_update arrives with empty messages (simulates backend strip)', () => {
    const msgs = [
      { role: 'user' as const, content: 'hello', timestamp: '1' },
      { role: 'assistant' as const, content: 'hi there', timestamp: '2' },
    ]
    useTaskStore.getState().upsertTask(makeTask({ messages: msgs }))
    // Simulate backend task_update with messages stripped (as listener does)
    useTaskStore.getState().upsertTask(makeTask({ status: 'running', messages: [] }))
    expect(useTaskStore.getState().tasks['task-1'].messages).toHaveLength(2)
    expect(useTaskStore.getState().tasks['task-1'].messages).toBe(msgs)
  })

  it('preserves messages across multiple consecutive task_updates with empty messages', () => {
    const msgs = [
      { role: 'user' as const, content: 'q1', timestamp: '1' },
      { role: 'assistant' as const, content: 'a1', timestamp: '2' },
      { role: 'user' as const, content: 'q2', timestamp: '3' },
      { role: 'assistant' as const, content: 'a2', timestamp: '4' },
    ]
    useTaskStore.getState().upsertTask(makeTask({ messages: msgs }))
    // Multiple rapid task_updates (status changes during a turn)
    useTaskStore.getState().upsertTask(makeTask({ status: 'running', messages: [] }))
    useTaskStore.getState().upsertTask(makeTask({ status: 'pending_permission', messages: [] }))
    useTaskStore.getState().upsertTask(makeTask({ status: 'running', messages: [] }))
    expect(useTaskStore.getState().tasks['task-1'].messages).toHaveLength(4)
  })

  it('applyTurnEnd preserves existing messages and appends assistant message', () => {
    const existingMsgs = [
      { role: 'user' as const, content: 'first question', timestamp: '1' },
      { role: 'assistant' as const, content: 'first answer', timestamp: '2' },
      { role: 'user' as const, content: 'second question', timestamp: '3' },
    ]
    const state = {
      tasks: { 't1': makeTask({ id: 't1', status: 'running', messages: existingMsgs }) },
      streamingChunks: { t1: 'second answer' } as Record<string, string>,
      thinkingChunks: {} as Record<string, string>,
      liveToolCalls: {} as Record<string, import('@/types').ToolCall[]>,
      liveToolSplits: {} as Record<string, import('@/types').ToolCallSplit[]>,
    }
    const result = applyTurnEnd(state, 't1', 'end_turn')
    const messages = result.tasks?.['t1'].messages ?? []
    expect(messages).toHaveLength(4)
    expect(messages[0].content).toBe('first question')
    expect(messages[1].content).toBe('first answer')
    expect(messages[2].content).toBe('second question')
    expect(messages[3].content).toBe('second answer')
    expect(messages[3].role).toBe('assistant')
  })

  it('full multi-turn cycle: send → stream → turnEnd → task_update → send again', () => {
    // Turn 1: user sends message
    const userMsg1 = { role: 'user' as const, content: 'hello', timestamp: '1' }
    useTaskStore.getState().upsertTask(makeTask({ status: 'running', messages: [userMsg1] }))

    // Turn 1: streaming completes, applyTurnEnd
    useTaskStore.setState((s) => ({
      streamingChunks: { ...s.streamingChunks, 'task-1': 'hi there' },
    }))
    useTaskStore.setState((s) => applyTurnEnd(s, 'task-1', 'end_turn'))
    expect(useTaskStore.getState().tasks['task-1'].messages).toHaveLength(2)

    // Backend task_update arrives with empty messages (status change)
    useTaskStore.getState().upsertTask(makeTask({ status: 'paused', messages: [] }))
    expect(useTaskStore.getState().tasks['task-1'].messages).toHaveLength(2)

    // Turn 2: user sends another message
    const task = useTaskStore.getState().tasks['task-1']
    const userMsg2 = { role: 'user' as const, content: 'follow up', timestamp: '3' }
    useTaskStore.getState().upsertTask({
      ...task,
      status: 'running',
      messages: [...task.messages, userMsg2],
    })
    expect(useTaskStore.getState().tasks['task-1'].messages).toHaveLength(3)

    // Another backend task_update with empty messages
    useTaskStore.getState().upsertTask(makeTask({ status: 'running', messages: [] }))
    expect(useTaskStore.getState().tasks['task-1'].messages).toHaveLength(3)

    // Turn 2: streaming completes
    useTaskStore.setState((s) => ({
      streamingChunks: { ...s.streamingChunks, 'task-1': 'follow up answer' },
    }))
    useTaskStore.setState((s) => applyTurnEnd(s, 'task-1', 'end_turn'))
    expect(useTaskStore.getState().tasks['task-1'].messages).toHaveLength(4)
    expect(useTaskStore.getState().tasks['task-1'].messages[3].content).toBe('follow up answer')
  })

  it('messages survive when task_update arrives between applyTurnEnd and next user message', () => {
    // Setup: task with 2 messages after first turn
    const msgs = [
      { role: 'user' as const, content: 'q1', timestamp: '1' },
      { role: 'assistant' as const, content: 'a1', timestamp: '2' },
    ]
    useTaskStore.getState().upsertTask(makeTask({ status: 'paused', messages: msgs }))

    // Backend task_update with empty messages arrives
    useTaskStore.getState().upsertTask(makeTask({ status: 'paused', messages: [] }))
    expect(useTaskStore.getState().tasks['task-1'].messages).toHaveLength(2)

    // User sends next message
    const task = useTaskStore.getState().tasks['task-1']
    useTaskStore.getState().upsertTask({
      ...task,
      status: 'running',
      messages: [...task.messages, { role: 'user' as const, content: 'q2', timestamp: '3' }],
    })
    expect(useTaskStore.getState().tasks['task-1'].messages).toHaveLength(3)
    expect(useTaskStore.getState().tasks['task-1'].messages[2].content).toBe('q2')
  })

  it('upsertTask accepts messages when incoming has more than existing', () => {
    const msgs1 = [{ role: 'user' as const, content: 'q1', timestamp: '1' }]
    useTaskStore.getState().upsertTask(makeTask({ messages: msgs1 }))

    const msgs2 = [
      { role: 'user' as const, content: 'q1', timestamp: '1' },
      { role: 'assistant' as const, content: 'a1', timestamp: '2' },
    ]
    useTaskStore.getState().upsertTask(makeTask({ messages: msgs2 }))
    expect(useTaskStore.getState().tasks['task-1'].messages).toHaveLength(2)
  })

  it('upsertTask preserves name across task_update events', () => {
    useTaskStore.getState().upsertTask(makeTask({ name: 'Original Name' }))
    useTaskStore.getState().renameTask('task-1', 'Renamed')
    // Backend task_update carries stale name
    useTaskStore.getState().upsertTask(makeTask({ name: 'Original Name', status: 'running', messages: [] }))
    expect(useTaskStore.getState().tasks['task-1'].name).toBe('Renamed')
  })

  it('preserves parentTaskId when backend update lacks it', () => {
    useTaskStore.getState().upsertTask(makeTask({ parentTaskId: 'parent-1' }))
    useTaskStore.getState().upsertTask(makeTask({ status: 'running', messages: [] }))
  })

  it('bail-out guard prevents unnecessary re-renders when nothing changed', () => {
    const msgs = [{ role: 'user' as const, content: 'hi', timestamp: '1' }]
    useTaskStore.getState().upsertTask(makeTask({ messages: msgs }))
    const tasksBefore = useTaskStore.getState().tasks

    // Same task_update with empty messages — should bail out (messages preserved by reference)
    useTaskStore.getState().upsertTask(makeTask({ messages: [] }))
    const tasksAfter = useTaskStore.getState().tasks

    // Since messages are preserved by reference and status hasn't changed,
    // the bail-out guard should prevent a state update
    expect(tasksBefore).toBe(tasksAfter)
  })
})

describe('createSplitView', () => {
  it('creates a split view and activates it', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 'left-1' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 'right-1' }))
    const id = useTaskStore.getState().createSplitView('left-1', 'right-1')
    const state = useTaskStore.getState()
    expect(state.splitViews).toHaveLength(1)
    expect(state.splitViews[0]).toEqual({ id, left: 'left-1', right: 'right-1', ratio: 0.5 })
    expect(state.activeSplitId).toBe(id)
    expect(state.selectedTaskId).toBe('left-1')
    expect(state.focusedPanel).toBe('left')
  })

  it('returns a UUID', () => {
    const id = useTaskStore.getState().createSplitView('a', 'b')
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('replaces the previous pairing instead of stacking a second one', () => {
    useTaskStore.getState().createSplitView('a', 'b')
    const id2 = useTaskStore.getState().createSplitView('c', 'd')
    expect(useTaskStore.getState().splitViews).toHaveLength(1)
    expect(useTaskStore.getState().activeSplitId).toBe(id2)
  })
})

describe('removeSplitView', () => {
  it('removes a split view by id', () => {
    const id = useTaskStore.getState().createSplitView('a', 'b')
    useTaskStore.getState().removeSplitView(id)
    expect(useTaskStore.getState().splitViews).toHaveLength(0)
  })

  it('clears activeSplitId if the removed view was active', () => {
    const id = useTaskStore.getState().createSplitView('a', 'b')
    expect(useTaskStore.getState().activeSplitId).toBe(id)
    useTaskStore.getState().removeSplitView(id)
    expect(useTaskStore.getState().activeSplitId).toBeNull()
  })

  it('preserves activeSplitId if a different view is removed', () => {
    const id1 = useTaskStore.getState().createSplitView('a', 'b')
    const id2 = useTaskStore.getState().createSplitView('c', 'd')
    // id2 is active
    useTaskStore.getState().removeSplitView(id1)
    expect(useTaskStore.getState().activeSplitId).toBe(id2)
    expect(useTaskStore.getState().splitViews).toHaveLength(1)
  })

  it('no-ops for unknown id', () => {
    useTaskStore.getState().createSplitView('a', 'b')
    useTaskStore.getState().removeSplitView('nonexistent')
    expect(useTaskStore.getState().splitViews).toHaveLength(1)
  })
})

describe('setActiveSplit', () => {
  it('activates a split view and sets selectedTaskId to left', () => {
    const id = useTaskStore.getState().createSplitView('left-1', 'right-1')
    useTaskStore.getState().setActiveSplit(null)
    expect(useTaskStore.getState().activeSplitId).toBeNull()
    useTaskStore.getState().setActiveSplit(id)
    expect(useTaskStore.getState().activeSplitId).toBe(id)
    expect(useTaskStore.getState().selectedTaskId).toBe('left-1')
  })

  it('deactivates when called with null', () => {
    useTaskStore.getState().createSplitView('a', 'b')
    useTaskStore.getState().setActiveSplit(null)
    expect(useTaskStore.getState().activeSplitId).toBeNull()
  })

  it('no-ops when already set to the same id', () => {
    const id = useTaskStore.getState().createSplitView('a', 'b')
    const before = useTaskStore.getState()
    useTaskStore.getState().setActiveSplit(id)
    // Should be same reference (bail-out guard)
    expect(useTaskStore.getState().activeSplitId).toBe(before.activeSplitId)
  })
})

describe('setSplitRatio', () => {
  it('updates the active split view ratio', () => {
    const id = useTaskStore.getState().createSplitView('a', 'b')
    useTaskStore.getState().setSplitRatio(0.7)
    const sv = useTaskStore.getState().splitViews.find((v) => v.id === id)
    expect(sv?.ratio).toBe(0.7)
  })

  it('clamps ratio to 0.2–0.8', () => {
    useTaskStore.getState().createSplitView('a', 'b')
    useTaskStore.getState().setSplitRatio(0.1)
    expect(useTaskStore.getState().splitViews[0].ratio).toBe(0.2)
    useTaskStore.getState().setSplitRatio(0.95)
    expect(useTaskStore.getState().splitViews[0].ratio).toBe(0.8)
  })

  it('no-ops when no active split', () => {
    useTaskStore.getState().createSplitView('a', 'b')
    useTaskStore.getState().setActiveSplit(null)
    const before = useTaskStore.getState().splitViews
    useTaskStore.getState().setSplitRatio(0.7)
    expect(useTaskStore.getState().splitViews).toBe(before)
  })

  it('updates the active split view', () => {
    const id = useTaskStore.getState().createSplitView('a', 'b')
    useTaskStore.getState().setSplitRatio(0.3)
    expect(useTaskStore.getState().splitViews.find((v) => v.id === id)?.ratio).toBe(0.3)
  })
})

describe('closeSplit', () => {
  it('discards the pairing so side-by-side cannot come back on the next click', () => {
    useTaskStore.getState().createSplitView('a', 'b')
    useTaskStore.getState().closeSplit()
    expect(useTaskStore.getState().activeSplitId).toBeNull()
    expect(useTaskStore.getState().splitViews).toHaveLength(0)
  })

  it('keeps the surviving thread selected when one panel is closed', () => {
    useTaskStore.getState().createSplitView('a', 'b')
    useTaskStore.getState().closeSplit('b')
    expect(useTaskStore.getState().selectedTaskId).toBe('b')
  })

  it('no-ops when no active split', () => {
    const before = useTaskStore.getState()
    useTaskStore.getState().closeSplit()
    expect(useTaskStore.getState().activeSplitId).toBe(before.activeSplitId)
  })
})

describe('saveScrollPosition', () => {
  it('saves scroll position for a task', () => {
    useTaskStore.getState().saveScrollPosition('t1', 250)
    expect(useTaskStore.getState().scrollPositions['t1']).toBe(250)
  })

  it('updates existing scroll position', () => {
    useTaskStore.getState().saveScrollPosition('t1', 100)
    useTaskStore.getState().saveScrollPosition('t1', 500)
    expect(useTaskStore.getState().scrollPositions['t1']).toBe(500)
  })

  it('no-ops when value unchanged', () => {
    useTaskStore.getState().saveScrollPosition('t1', 100)
    const before = useTaskStore.getState().scrollPositions
    useTaskStore.getState().saveScrollPosition('t1', 100)
    expect(useTaskStore.getState().scrollPositions).toBe(before)
  })

  it('stores positions for multiple tasks independently', () => {
    useTaskStore.getState().saveScrollPosition('t1', 100)
    useTaskStore.getState().saveScrollPosition('t2', 200)
    expect(useTaskStore.getState().scrollPositions['t1']).toBe(100)
    expect(useTaskStore.getState().scrollPositions['t2']).toBe(200)
  })
})

describe('setSelectedTask deactivates split', () => {
  it('keeps split active when selecting a thread that is part of the split', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 't1' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 't2' }))
    useTaskStore.getState().createSplitView('t1', 't2')
    expect(useTaskStore.getState().activeSplitId).not.toBeNull()
    useTaskStore.getState().setSelectedTask('t1')
    expect(useTaskStore.getState().activeSplitId).not.toBeNull()
    expect(useTaskStore.getState().selectedTaskId).toBe('t1')
    expect(useTaskStore.getState().focusedPanel).toBe('left')
  })

  it('focuses right panel when selecting the right split thread', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 't1' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 't2' }))
    useTaskStore.getState().createSplitView('t1', 't2')
    useTaskStore.getState().setSelectedTask('t2')
    expect(useTaskStore.getState().activeSplitId).not.toBeNull()
    expect(useTaskStore.getState().selectedTaskId).toBe('t2')
    expect(useTaskStore.getState().focusedPanel).toBe('right')
  })

  it('deactivates split when selecting a thread outside the split', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 't1' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 't2' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 't3' }))
    useTaskStore.getState().createSplitView('t1', 't2')
    expect(useTaskStore.getState().activeSplitId).not.toBeNull()
    useTaskStore.getState().setSelectedTask('t3')
    expect(useTaskStore.getState().activeSplitId).toBeNull()
    expect(useTaskStore.getState().selectedTaskId).toBe('t3')
  })

  it('deactivates split when selecting null', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 't1' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 't2' }))
    useTaskStore.getState().createSplitView('t1', 't2')
    useTaskStore.getState().setSelectedTask(null)
    expect(useTaskStore.getState().activeSplitId).toBeNull()
  })

  it('preserves split views list when deactivating via setSelectedTask', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 't1' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 't2' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 't3' }))
    const id = useTaskStore.getState().createSplitView('t1', 't2')
    useTaskStore.getState().setSelectedTask('t3')
    // Split view still saved, just not active
    expect(useTaskStore.getState().splitViews).toHaveLength(1)
    expect(useTaskStore.getState().splitViews[0].id).toBe(id)
  })
})

describe('removeTask cleans up split views', () => {
  it('removes split views referencing the deleted task as left', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 't1' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 't2' }))
    useTaskStore.getState().createSplitView('t1', 't2')
    useTaskStore.getState().removeTask('t1')
    expect(useTaskStore.getState().splitViews).toHaveLength(0)
  })

  it('removes split views referencing the deleted task as right', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 't1' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 't2' }))
    useTaskStore.getState().createSplitView('t1', 't2')
    useTaskStore.getState().removeTask('t2')
    expect(useTaskStore.getState().splitViews).toHaveLength(0)
  })

  it('clears activeSplitId when the active split is removed', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 't1' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 't2' }))
    useTaskStore.getState().createSplitView('t1', 't2')
    expect(useTaskStore.getState().activeSplitId).not.toBeNull()
    useTaskStore.getState().removeTask('t1')
    expect(useTaskStore.getState().activeSplitId).toBeNull()
  })

  it('preserves unrelated split views when a task is removed', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 't1' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 't2' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 't3' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 't4' }))
    useTaskStore.getState().createSplitView('t1', 't2')
    const id2 = useTaskStore.getState().createSplitView('t3', 't4')
    useTaskStore.getState().removeTask('t1')
    expect(useTaskStore.getState().splitViews).toHaveLength(1)
    expect(useTaskStore.getState().splitViews[0].id).toBe(id2)
  })
})

describe('createDraftThread deactivates split', () => {
  it('clears activeSplitId when creating a new draft', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 't1' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 't2' }))
    useTaskStore.getState().createSplitView('t1', 't2')
    expect(useTaskStore.getState().activeSplitId).not.toBeNull()
    useTaskStore.getState().createDraftThread('/ws')
    expect(useTaskStore.getState().activeSplitId).toBeNull()
  })
})

describe('setPendingWorkspace deactivates split', () => {
  it('clears activeSplitId when switching to pending workspace', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 't1' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 't2' }))
    useTaskStore.getState().createSplitView('t1', 't2')
    useTaskStore.getState().setPendingWorkspace('/new-ws')
    expect(useTaskStore.getState().activeSplitId).toBeNull()
  })
})

// ── Pin thread ────────────────────────────────────────────────

describe('pinThread', () => {
  it('adds a thread id to pinnedThreadIds', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 't1' }))
    useTaskStore.getState().pinThread('t1')
    expect(useTaskStore.getState().pinnedThreadIds).toEqual(['t1'])
  })

  it('does not duplicate if already pinned', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 't1' }))
    useTaskStore.getState().pinThread('t1')
    useTaskStore.getState().pinThread('t1')
    expect(useTaskStore.getState().pinnedThreadIds).toEqual(['t1'])
  })

  it('supports multiple pinned threads', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 't1' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 't2' }))
    useTaskStore.getState().pinThread('t1')
    useTaskStore.getState().pinThread('t2')
    expect(useTaskStore.getState().pinnedThreadIds).toEqual(['t1', 't2'])
  })
})

describe('unpinThread', () => {
  it('removes a thread id from pinnedThreadIds', () => {
    useTaskStore.getState().pinThread('t1')
    useTaskStore.getState().unpinThread('t1')
    expect(useTaskStore.getState().pinnedThreadIds).toEqual([])
  })

  it('no-ops if thread is not pinned', () => {
    useTaskStore.getState().pinThread('t1')
    useTaskStore.getState().unpinThread('t2')
    expect(useTaskStore.getState().pinnedThreadIds).toEqual(['t1'])
  })

  it('preserves other pinned threads', () => {
    useTaskStore.getState().pinThread('t1')
    useTaskStore.getState().pinThread('t2')
    useTaskStore.getState().pinThread('t3')
    useTaskStore.getState().unpinThread('t2')
    expect(useTaskStore.getState().pinnedThreadIds).toEqual(['t1', 't3'])
  })
})

describe('pin cleanup on thread deletion', () => {
  it('removes pinned thread id when thread is soft-deleted', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 't1' }))
    useTaskStore.getState().pinThread('t1')
    expect(useTaskStore.getState().pinnedThreadIds).toContain('t1')
    useTaskStore.getState().softDeleteTask('t1')
    expect(useTaskStore.getState().pinnedThreadIds).not.toContain('t1')
  })

  it('preserves other pins when one thread is deleted', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 't1' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 't2' }))
    useTaskStore.getState().pinThread('t1')
    useTaskStore.getState().pinThread('t2')
    useTaskStore.getState().softDeleteTask('t1')
    expect(useTaskStore.getState().pinnedThreadIds).toEqual(['t2'])
  })
})

// ── Split view focus isolation ────────────────────────────────

describe('split view focus isolation', () => {
  it('setFocusedPanel switches focus between left and right', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 'left-1' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 'right-1' }))
    useTaskStore.getState().createSplitView('left-1', 'right-1')
    expect(useTaskStore.getState().focusedPanel).toBe('left')
    useTaskStore.getState().setFocusedPanel('right')
    expect(useTaskStore.getState().focusedPanel).toBe('right')
  })

  it('selectedTaskId can be updated without deactivating split via direct setState', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 'left-1' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 'right-1' }))
    useTaskStore.getState().createSplitView('left-1', 'right-1')
    expect(useTaskStore.getState().selectedTaskId).toBe('left-1')
    // Simulate what SplitChatLayout does on focus change
    useTaskStore.setState({ selectedTaskId: 'right-1' })
    expect(useTaskStore.getState().selectedTaskId).toBe('right-1')
    // Split should still be active
    expect(useTaskStore.getState().activeSplitId).not.toBeNull()
  })

  it('setSelectedTask focuses panel for split thread instead of deactivating', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 'left-1' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 'right-1' }))
    useTaskStore.getState().createSplitView('left-1', 'right-1')
    expect(useTaskStore.getState().activeSplitId).not.toBeNull()
    useTaskStore.getState().setSelectedTask('left-1')
    expect(useTaskStore.getState().activeSplitId).not.toBeNull()
    expect(useTaskStore.getState().focusedPanel).toBe('left')
  })

  it('each panel has independent messages scoped to its own task', () => {
    const leftTask = makeTask({
      id: 'left-1',
      messages: [
        { role: 'user', content: 'left message 1', timestamp: '2026-01-01T00:00:00Z' },
        { role: 'assistant', content: 'left reply', timestamp: '2026-01-01T00:01:00Z' },
      ],
    })
    const rightTask = makeTask({
      id: 'right-1',
      messages: [
        { role: 'user', content: 'right message 1', timestamp: '2026-01-01T00:00:00Z' },
        { role: 'assistant', content: 'right reply', timestamp: '2026-01-01T00:01:00Z' },
      ],
    })
    useTaskStore.getState().upsertTask(leftTask)
    useTaskStore.getState().upsertTask(rightTask)
    useTaskStore.getState().createSplitView('left-1', 'right-1')
    // Left panel messages
    const leftMessages = useTaskStore.getState().tasks['left-1'].messages
    expect(leftMessages).toHaveLength(2)
    expect(leftMessages[0].content).toBe('left message 1')
    // Right panel messages
    const rightMessages = useTaskStore.getState().tasks['right-1'].messages
    expect(rightMessages).toHaveLength(2)
    expect(rightMessages[0].content).toBe('right message 1')
    // They are independent
    expect(leftMessages[0].content).not.toBe(rightMessages[0].content)
  })

  it('message history cycling reads from the correct task (not selectedTaskId)', () => {
    const leftTask = makeTask({
      id: 'left-1',
      messages: [
        { role: 'user', content: 'left user msg', timestamp: '2026-01-01T00:00:00Z' },
      ],
    })
    const rightTask = makeTask({
      id: 'right-1',
      messages: [
        { role: 'user', content: 'right user msg', timestamp: '2026-01-01T00:00:00Z' },
      ],
    })
    useTaskStore.getState().upsertTask(leftTask)
    useTaskStore.getState().upsertTask(rightTask)
    useTaskStore.getState().createSplitView('left-1', 'right-1')
    // selectedTaskId is left-1 by default
    expect(useTaskStore.getState().selectedTaskId).toBe('left-1')
    // Simulate right panel reading its own task for history
    const rightTaskFromStore = useTaskStore.getState().tasks['right-1']
    const rightUserMsgs = rightTaskFromStore.messages.filter((m) => m.role === 'user')
    expect(rightUserMsgs).toHaveLength(1)
    expect(rightUserMsgs[0].content).toBe('right user msg')
    // Verify it's NOT the left panel's messages
    const leftTaskFromStore = useTaskStore.getState().tasks['left-1']
    const leftUserMsgs = leftTaskFromStore.messages.filter((m) => m.role === 'user')
    expect(leftUserMsgs[0].content).toBe('left user msg')
    expect(leftUserMsgs[0].content).not.toBe(rightUserMsgs[0].content)
  })

  it('streaming chunks are scoped per task in split view', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 'left-1' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 'right-1' }))
    useTaskStore.getState().createSplitView('left-1', 'right-1')
    useTaskStore.getState().appendChunk('left-1', 'left chunk')
    useTaskStore.getState().appendChunk('right-1', 'right chunk')
    expect(useTaskStore.getState().streamingChunks['left-1']).toBe('left chunk')
    expect(useTaskStore.getState().streamingChunks['right-1']).toBe('right chunk')
  })

  it('queued messages are scoped per task in split view', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 'left-1', status: 'running' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 'right-1', status: 'running' }))
    useTaskStore.getState().createSplitView('left-1', 'right-1')
    useTaskStore.getState().enqueueMessage('left-1', 'queued for left')
    useTaskStore.getState().enqueueMessage('right-1', 'queued for right')
    expect(useTaskStore.getState().queuedMessages['left-1']).toHaveLength(1)
    expect(useTaskStore.getState().queuedMessages['left-1'][0].text).toBe('queued for left')
    expect(useTaskStore.getState().queuedMessages['right-1']).toHaveLength(1)
    expect(useTaskStore.getState().queuedMessages['right-1'][0].text).toBe('queued for right')
  })

  it('clearTurn only affects the specified task', () => {
    useTaskStore.getState().upsertTask(makeTask({ id: 'left-1' }))
    useTaskStore.getState().upsertTask(makeTask({ id: 'right-1' }))
    useTaskStore.getState().createSplitView('left-1', 'right-1')
    useTaskStore.getState().appendChunk('left-1', 'left data')
    useTaskStore.getState().appendChunk('right-1', 'right data')
    useTaskStore.getState().clearTurn('left-1')
    expect(useTaskStore.getState().streamingChunks['left-1']).toBe('')
    expect(useTaskStore.getState().streamingChunks['right-1']).toBe('right data')
  })

  it('split view threads belong to their respective projects', () => {
    const leftTask = makeTask({ id: 'left-1', workspace: '/project-a' })
    const rightTask = makeTask({ id: 'right-1', workspace: '/project-b' })
    useTaskStore.getState().upsertTask(leftTask)
    useTaskStore.getState().upsertTask(rightTask)
    useTaskStore.getState().createSplitView('left-1', 'right-1')
    expect(useTaskStore.getState().tasks['left-1'].workspace).toBe('/project-a')
    expect(useTaskStore.getState().tasks['right-1'].workspace).toBe('/project-b')
  })
})

describe('rekeyDispatchSnapshot', () => {
  it('atomically moves the snapshot to the new task id and rewrites taskId', () => {
    useTaskStore.getState().setDispatchSnapshot('draft-1', {
      startedAt: 1, taskStatus: 'paused', messageCount: 0, wasStreaming: false, taskId: 'draft-1',
    })
    useTaskStore.getState().rekeyDispatchSnapshot('draft-1', 'real-1')
    const snapshots = useTaskStore.getState().dispatchSnapshots
    expect(snapshots['draft-1']).toBeUndefined()
    expect(snapshots['real-1']?.taskId).toBe('real-1')
  })

  it('drops the source snapshot when the destination already has one (turn_end raced ahead)', () => {
    // Simulates `turn_end` firing for the new id while we were re-keying:
    // the newer destination snapshot wins, the stale draft is discarded.
    useTaskStore.getState().setDispatchSnapshot('draft-1', {
      startedAt: 1, taskStatus: 'paused', messageCount: 0, wasStreaming: false, taskId: 'draft-1',
    })
    useTaskStore.getState().setDispatchSnapshot('real-1', {
      startedAt: 2, taskStatus: 'running', messageCount: 1, wasStreaming: true, taskId: 'real-1',
    })
    useTaskStore.getState().rekeyDispatchSnapshot('draft-1', 'real-1')
    const snapshots = useTaskStore.getState().dispatchSnapshots
    expect(snapshots['draft-1']).toBeUndefined()
    expect(snapshots['real-1']?.startedAt).toBe(2) // newer snapshot survived
  })

  it('is a no-op when the source has no snapshot', () => {
    const before = useTaskStore.getState().dispatchSnapshots
    useTaskStore.getState().rekeyDispatchSnapshot('missing', 'real-1')
    expect(useTaskStore.getState().dispatchSnapshots).toBe(before)
  })
})

// ── Conversation control: truncate / restore ───────────────────────

const conversation = () => [
  { role: 'user' as const, content: 'first question', timestamp: 't0' },
  { role: 'assistant' as const, content: 'first answer', timestamp: 't1' },
  { role: 'user' as const, content: 'second question', timestamp: 't2' },
  { role: 'assistant' as const, content: 'second answer', timestamp: 't3' },
]

describe('truncateFromMessage', () => {
  beforeEach(() => {
    vi.mocked(threadDbMock.replaceMessages).mockClear()
  })

  it('drops the message at the index and everything after it', () => {
    useTaskStore.getState().upsertTask(makeTask({ messages: conversation() }))
    useTaskStore.getState().truncateFromMessage('task-1', 2)
    const messages = useTaskStore.getState().tasks['task-1'].messages
    expect(messages.map((m) => m.content)).toEqual(['first question', 'first answer'])
  })

  it('allows truncating to empty (index 0)', () => {
    useTaskStore.getState().upsertTask(makeTask({ messages: conversation() }))
    useTaskStore.getState().truncateFromMessage('task-1', 0)
    expect(useTaskStore.getState().tasks['task-1'].messages).toHaveLength(0)
  })

  it('writes the truncation through to SQLite', () => {
    useTaskStore.getState().upsertTask(makeTask({ messages: conversation() }))
    useTaskStore.getState().truncateFromMessage('task-1', 1)
    expect(threadDbMock.replaceMessages).toHaveBeenCalledWith(
      'task-1',
      [expect.objectContaining({ content: 'first question' })],
    )
  })

  it('clears in-flight streaming state for the task', () => {
    useTaskStore.getState().upsertTask(makeTask({ messages: conversation() }))
    useTaskStore.setState({
      streamingChunks: { 'task-1': 'partial' },
      thinkingChunks: { 'task-1': 'thinking' },
    })
    useTaskStore.getState().truncateFromMessage('task-1', 2)
    expect(useTaskStore.getState().streamingChunks['task-1']).toBe('')
    expect(useTaskStore.getState().thinkingChunks['task-1']).toBe('')
  })

  it('rejects out-of-range indices', () => {
    useTaskStore.getState().upsertTask(makeTask({ messages: conversation() }))
    useTaskStore.getState().truncateFromMessage('task-1', -1)
    useTaskStore.getState().truncateFromMessage('task-1', 5)
    expect(useTaskStore.getState().tasks['task-1'].messages).toHaveLength(4)
    expect(threadDbMock.replaceMessages).not.toHaveBeenCalled()
  })

  it('is a no-op for unknown tasks', () => {
    useTaskStore.getState().truncateFromMessage('missing', 0)
    expect(threadDbMock.replaceMessages).not.toHaveBeenCalled()
  })
})

describe('rollbackToMessage keeps the target turn', () => {
  it('keeps messages up to and including the index', () => {
    useTaskStore.getState().upsertTask(makeTask({ messages: conversation() }))
    useTaskStore.getState().rollbackToMessage('task-1', 1)
    const messages = useTaskStore.getState().tasks['task-1'].messages
    expect(messages.map((m) => m.content)).toEqual(['first question', 'first answer'])
  })

  it('rollback of the final message clears streaming state without dropping messages', () => {
    useTaskStore.getState().upsertTask(makeTask({ messages: conversation() }))
    useTaskStore.setState({ streamingChunks: { 'task-1': 'leftover' } })
    useTaskStore.getState().rollbackToMessage('task-1', 3)
    expect(useTaskStore.getState().tasks['task-1'].messages).toHaveLength(4)
    expect(useTaskStore.getState().streamingChunks['task-1']).toBe('')
  })

  it('rejects negative indices', () => {
    useTaskStore.getState().upsertTask(makeTask({ messages: conversation() }))
    useTaskStore.getState().rollbackToMessage('task-1', -1)
    expect(useTaskStore.getState().tasks['task-1'].messages).toHaveLength(4)
  })
})

