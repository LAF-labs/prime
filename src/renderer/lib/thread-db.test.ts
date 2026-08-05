import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the ipc module
vi.mock('@/lib/ipc', () => ({
  ipc: {
    threadDbStats: vi.fn(),
    threadDbSave: vi.fn(),
    threadDbSaveMessage: vi.fn(),
    threadDbLoad: vi.fn(),
    threadDbMessages: vi.fn(),
    threadDbList: vi.fn(),
    threadDbDelete: vi.fn(),
    threadDbSearch: vi.fn(),
  },
}))

import { ipc } from '@/lib/ipc'
import * as threadDb from './thread-db'
import type { AgentTask, TaskMessage } from '@/types'

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Helper factories ─────────────────────────────────────────────

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: 'task-1',
    name: 'Test Thread',
    workspace: '/workspace',
    status: 'paused',
    createdAt: '2026-01-01T00:00:00Z',
    messages: [],
    ...overrides,
  }
}

function makeMessage(overrides: Partial<TaskMessage> = {}): TaskMessage {
  return {
    role: 'user',
    content: 'hello',
    timestamp: '2026-01-01T00:00:01Z',
    ...overrides,
  }
}

// ── isAvailable ──────────────────────────────────────────────────

describe('isAvailable', () => {
  it('returns true when backend responds', async () => {
    vi.mocked(ipc.threadDbStats).mockResolvedValueOnce({ totalThreads: 0, totalMessages: 0, threadsByWorkspace: [] })
    expect(await threadDb.isAvailable()).toBe(true)
  })

  it('returns false when backend throws', async () => {
    vi.mocked(ipc.threadDbStats).mockRejectedValueOnce(new Error('unavailable'))
    expect(await threadDb.isAvailable()).toBe(false)
  })
})

// ── saveThread ───────────────────────────────────────────────────

describe('saveThread', () => {
  it('converts AgentTask to DbThread and calls ipc.threadDbSave', async () => {
    vi.mocked(ipc.threadDbSave).mockResolvedValueOnce(undefined)
    const task = makeTask({
      parentTaskId: 'parent-1',
      worktreePath: '/ws/.kiro/worktrees/feat',
      originalWorkspace: '/ws',
      projectId: 'proj-1',
    })

    await threadDb.saveThread(task)

    expect(ipc.threadDbSave).toHaveBeenCalledWith(expect.objectContaining({
      id: 'task-1',
      name: 'Test Thread',
      workspace: '/workspace',
      status: 'paused',
      createdAt: '2026-01-01T00:00:00Z',
      parentThreadId: 'parent-1',
      autoApprove: false,
      metadata: {
        worktreePath: '/ws/.kiro/worktrees/feat',
        originalWorkspace: '/ws',
        projectId: 'proj-1',
      },
    }))
  })

  it('omits undefined metadata fields', async () => {
    vi.mocked(ipc.threadDbSave).mockResolvedValueOnce(undefined)
    await threadDb.saveThread(makeTask())

    const call = vi.mocked(ipc.threadDbSave).mock.calls[0][0]
    expect(call.metadata).toEqual({})
    expect(call.parentThreadId).toBeUndefined()
  })

  it('propagates errors from backend', async () => {
    vi.mocked(ipc.threadDbSave).mockRejectedValueOnce(new Error('DB full'))
    await expect(threadDb.saveThread(makeTask())).rejects.toThrow('DB full')
  })
})

// ── saveMessage ──────────────────────────────────────────────────

describe('saveMessage', () => {
  it('saves a user message with correct structure', async () => {
    vi.mocked(ipc.threadDbSaveMessage).mockResolvedValueOnce(1)

    const msg = makeMessage({ role: 'user', content: 'hello world' })
    const id = await threadDb.saveMessage('thread-1', msg)

    expect(id).toBe(1)
    expect(ipc.threadDbSaveMessage).toHaveBeenCalledWith(expect.objectContaining({
      id: 0,
      threadId: 'thread-1',
      role: 'user',
      content: 'hello world',
      timestamp: '2026-01-01T00:00:01Z',
    }))
  })

  it('saves assistant message with toolCalls and toolCallSplits', async () => {
    vi.mocked(ipc.threadDbSaveMessage).mockResolvedValueOnce(2)

    const msg = makeMessage({
      role: 'assistant',
      content: 'I will edit the file',
      thinking: 'Let me think...',
      toolCalls: [{ toolCallId: 'tc-1', title: 'Edit file', kind: 'edit' as const, status: 'completed' as const, locations: [] }],
      toolCallSplits: [{ toolCallId: 'tc-1', at: 5 }],
    })
    await threadDb.saveMessage('thread-1', msg)

    const call = vi.mocked(ipc.threadDbSaveMessage).mock.calls[0][0]
    expect(call.thinking).toBe('Let me think...')
    expect(call.toolCalls).toEqual({
      toolCalls: [{ toolCallId: 'tc-1', title: 'Edit file', kind: 'edit', status: 'completed', locations: [] }],
      toolCallSplits: [{ toolCallId: 'tc-1', at: 5 }],
    })
  })

  it('truncates oversized rawOutput in tool calls', async () => {
    vi.mocked(ipc.threadDbSaveMessage).mockResolvedValueOnce(3)

    const bigOutput = 'x'.repeat(100_000)
    const msg = makeMessage({
      role: 'assistant',
      content: 'done',
      toolCalls: [{ toolCallId: 'tc-1', title: 'Run command', kind: 'execute' as const, status: 'completed' as const, locations: [], rawOutput: bigOutput }],
    })
    await threadDb.saveMessage('thread-1', msg)

    const call = vi.mocked(ipc.threadDbSaveMessage).mock.calls[0][0]
    const toolData = call.toolCalls as { toolCalls: Array<{ rawOutput: string }> }
    expect(toolData.toolCalls[0].rawOutput.length).toBeLessThan(bigOutput.length)
    expect(toolData.toolCalls[0].rawOutput).toContain('truncated')
  })

  it('does not include toolCalls field when message has no tools', async () => {
    vi.mocked(ipc.threadDbSaveMessage).mockResolvedValueOnce(4)

    const msg = makeMessage({ role: 'user', content: 'plain text' })
    await threadDb.saveMessage('thread-1', msg)

    const call = vi.mocked(ipc.threadDbSaveMessage).mock.calls[0][0]
    expect(call.toolCalls).toBeUndefined()
  })

  it('retries with thread creation on FK constraint violation', async () => {
    vi.mocked(ipc.threadDbSaveMessage)
      .mockRejectedValueOnce(new Error('FOREIGN KEY constraint failed'))
      .mockResolvedValueOnce(5)
    vi.mocked(ipc.threadDbSave).mockResolvedValueOnce(undefined)

    const msg = makeMessage({ role: 'user', content: 'first message', timestamp: '2026-01-01T00:00:01Z' })
    const id = await threadDb.saveMessage('new-thread', msg)

    expect(id).toBe(5)
    // Should have created a minimal thread row
    expect(ipc.threadDbSave).toHaveBeenCalledWith(expect.objectContaining({
      id: 'new-thread',
      createdAt: '2026-01-01T00:00:01Z',
      status: 'running',
    }))
    // Should have retried the message insert
    expect(ipc.threadDbSaveMessage).toHaveBeenCalledTimes(2)
  })

  it('propagates non-FK errors without retry', async () => {
    vi.mocked(ipc.threadDbSaveMessage).mockRejectedValueOnce(new Error('disk full'))

    const msg = makeMessage({ role: 'user', content: 'hello' })
    await expect(threadDb.saveMessage('thread-1', msg)).rejects.toThrow('disk full')
    expect(ipc.threadDbSave).not.toHaveBeenCalled()
  })
})

// ── loadMessages ─────────────────────────────────────────────────

describe('loadMessages', () => {
  it('converts DbMessages to TaskMessages', async () => {
    vi.mocked(ipc.threadDbMessages).mockResolvedValueOnce([
      { id: 1, threadId: 't1', role: 'user', content: 'hi', timestamp: '2026-01-01T00:00:01Z', thinking: undefined, toolCalls: undefined },
      { id: 2, threadId: 't1', role: 'assistant', content: 'hello', timestamp: '2026-01-01T00:00:02Z', thinking: 'hmm', toolCalls: { toolCalls: [{ toolCallId: 'tc-1', kind: 'edit', status: 'completed', locations: [] }], toolCallSplits: [] } },
    ])

    const messages = await threadDb.loadMessages('t1')

    expect(messages).toHaveLength(2)
    expect(messages[0]).toEqual({ role: 'user', content: 'hi', timestamp: '2026-01-01T00:00:01Z' })
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: 'hello',
      timestamp: '2026-01-01T00:00:02Z',
      thinking: 'hmm',
      toolCalls: [{ toolCallId: 'tc-1', kind: 'edit', status: 'completed', locations: [] }],
    })
  })

  it('handles empty toolCalls gracefully', async () => {
    vi.mocked(ipc.threadDbMessages).mockResolvedValueOnce([
      { id: 1, threadId: 't1', role: 'assistant', content: 'text only', timestamp: '2026-01-01', thinking: undefined, toolCalls: { toolCalls: [], toolCallSplits: [] } },
    ])

    const messages = await threadDb.loadMessages('t1')
    expect(messages[0].toolCalls).toBeUndefined()
    expect(messages[0].toolCallSplits).toBeUndefined()
  })

  it('handles null toolCalls from DB', async () => {
    vi.mocked(ipc.threadDbMessages).mockResolvedValueOnce([
      { id: 1, threadId: 't1', role: 'user', content: 'hi', timestamp: '2026-01-01', thinking: undefined, toolCalls: null },
    ])

    const messages = await threadDb.loadMessages('t1')
    expect(messages[0]).toEqual({ role: 'user', content: 'hi', timestamp: '2026-01-01' })
  })

  it('returns empty array for thread with no messages', async () => {
    vi.mocked(ipc.threadDbMessages).mockResolvedValueOnce([])
    const messages = await threadDb.loadMessages('empty-thread')
    expect(messages).toEqual([])
  })
})

// ── loadFullThread ───────────────────────────────────────────────

describe('loadFullThread', () => {
  it('returns null when thread does not exist', async () => {
    vi.mocked(ipc.threadDbLoad).mockResolvedValueOnce(null)
    const result = await threadDb.loadFullThread('nonexistent')
    expect(result).toBeNull()
  })

  it('assembles full AgentTask from metadata + messages', async () => {
    vi.mocked(ipc.threadDbLoad).mockResolvedValueOnce({
      id: 't1',
      name: 'My Thread',
      workspace: '/ws',
      status: 'completed',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:01:00Z',
      parentThreadId: 'parent-1',
      autoApprove: false,
      metadata: { worktreePath: '/ws/.kiro/wt', originalWorkspace: '/ws', projectId: 'p1' },
    })
    vi.mocked(ipc.threadDbMessages).mockResolvedValueOnce([
      { id: 1, threadId: 't1', role: 'user', content: 'hi', timestamp: '2026-01-01T00:00:01Z', thinking: undefined, toolCalls: undefined },
    ])

    const task = await threadDb.loadFullThread('t1')

    expect(task).toEqual({
      id: 't1',
      name: 'My Thread',
      workspace: '/ws',
      status: 'completed',
      createdAt: '2026-01-01T00:00:00Z',
      messages: [{ role: 'user', content: 'hi', timestamp: '2026-01-01T00:00:01Z' }],
      isArchived: true,
      parentTaskId: 'parent-1',
      worktreePath: '/ws/.kiro/wt',
      originalWorkspace: '/ws',
      projectId: 'p1',
    })
  })

  it('returns null when thread exists but has no messages (incomplete migration)', async () => {
    vi.mocked(ipc.threadDbLoad).mockResolvedValueOnce({
      id: 't2',
      name: 'Simple',
      workspace: '/ws',
      status: 'completed',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      autoApprove: false,
      metadata: {},
    })
    vi.mocked(ipc.threadDbMessages).mockResolvedValueOnce([])

    const task = await threadDb.loadFullThread('t2')
    expect(task).toBeNull()
  })
})

// ── saveFullThread ───────────────────────────────────────────────

describe('saveFullThread', () => {
  it('saves thread metadata and all messages', async () => {
    vi.mocked(ipc.threadDbSave).mockResolvedValue(undefined)
    vi.mocked(ipc.threadDbSaveMessage).mockResolvedValue(1)

    const task = makeTask({
      messages: [
        makeMessage({ role: 'user', content: 'q1' }),
        makeMessage({ role: 'assistant', content: 'a1', timestamp: '2026-01-01T00:00:02Z' }),
      ],
    })

    await threadDb.saveFullThread(task)

    expect(ipc.threadDbSave).toHaveBeenCalledTimes(1)
    expect(ipc.threadDbSaveMessage).toHaveBeenCalledTimes(2)
  })

  it('skips message saving for empty thread', async () => {
    vi.mocked(ipc.threadDbSave).mockResolvedValue(undefined)

    await threadDb.saveFullThread(makeTask({ messages: [] }))

    expect(ipc.threadDbSave).toHaveBeenCalledTimes(1)
    expect(ipc.threadDbSaveMessage).not.toHaveBeenCalled()
  })
})

// ── migrateFromJsonHistory ───────────────────────────────────────

describe('migrateFromJsonHistory', () => {
  it('migrates threads that do not exist in SQLite', async () => {
    vi.mocked(ipc.threadDbLoad).mockResolvedValue(null)
    vi.mocked(ipc.threadDbSave).mockResolvedValue(undefined)
    vi.mocked(ipc.threadDbSaveMessage).mockResolvedValue(1)

    const loadFn = vi.fn().mockResolvedValue([
      { id: 't1', name: 'Thread 1', workspace: '/ws', createdAt: '2026-01-01', messages: [{ role: 'user', content: 'hi', timestamp: '2026-01-01' }] },
    ])

    const result = await threadDb.migrateFromJsonHistory(loadFn)

    expect(result).toEqual({ migrated: 1, skipped: 0, failed: 0 })
    expect(ipc.threadDbSave).toHaveBeenCalledTimes(1)
    expect(ipc.threadDbSaveMessage).toHaveBeenCalledTimes(1)
  })

  it('skips threads that already exist in SQLite', async () => {
    vi.mocked(ipc.threadDbLoad).mockResolvedValue({ id: 't1', name: 'Existing', workspace: '/ws', status: 'completed', createdAt: '', updatedAt: '', autoApprove: false })
    vi.mocked(ipc.threadDbSave).mockResolvedValue(undefined)

    const loadFn = vi.fn().mockResolvedValue([
      { id: 't1', name: 'Thread 1', workspace: '/ws', createdAt: '2026-01-01', messages: [] },
    ])

    const result = await threadDb.migrateFromJsonHistory(loadFn)

    expect(result).toEqual({ migrated: 0, skipped: 1, failed: 0 })
    expect(ipc.threadDbSave).not.toHaveBeenCalled()
  })

  it('counts failures without stopping migration', async () => {
    vi.mocked(ipc.threadDbLoad).mockResolvedValue(null)
    vi.mocked(ipc.threadDbSave)
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce(undefined)
    vi.mocked(ipc.threadDbSaveMessage).mockResolvedValue(1)

    const loadFn = vi.fn().mockResolvedValue([
      { id: 't1', name: 'Fail', workspace: '/ws', createdAt: '', messages: [{ role: 'user', content: 'x', timestamp: '' }] },
      { id: 't2', name: 'Success', workspace: '/ws', createdAt: '', messages: [{ role: 'user', content: 'y', timestamp: '' }] },
    ])

    const result = await threadDb.migrateFromJsonHistory(loadFn)

    expect(result).toEqual({ migrated: 1, skipped: 0, failed: 1 })
  })

  it('handles empty thread list gracefully', async () => {
    const loadFn = vi.fn().mockResolvedValue([])
    const result = await threadDb.migrateFromJsonHistory(loadFn)
    expect(result).toEqual({ migrated: 0, skipped: 0, failed: 0 })
  })
})

// ── deleteThread ─────────────────────────────────────────────────

describe('deleteThread', () => {
  it('calls ipc.threadDbDelete', async () => {
    vi.mocked(ipc.threadDbDelete).mockResolvedValueOnce(undefined)
    await threadDb.deleteThread('t1')
    expect(ipc.threadDbDelete).toHaveBeenCalledWith('t1')
  })
})

// ── Edge cases ───────────────────────────────────────────────────

describe('edge cases', () => {
  it('handles message with empty content', async () => {
    vi.mocked(ipc.threadDbSaveMessage).mockResolvedValueOnce(1)
    await threadDb.saveMessage('t1', makeMessage({ content: '' }))
    const call = vi.mocked(ipc.threadDbSaveMessage).mock.calls[0][0]
    expect(call.content).toBe('')
  })

  it('handles message with undefined thinking (not included in DB payload)', async () => {
    vi.mocked(ipc.threadDbSaveMessage).mockResolvedValueOnce(1)
    await threadDb.saveMessage('t1', makeMessage({ thinking: undefined }))
    const call = vi.mocked(ipc.threadDbSaveMessage).mock.calls[0][0]
    expect(call.thinking).toBeUndefined()
  })

  it('handles very long content without truncation (only rawInput/rawOutput are truncated)', async () => {
    vi.mocked(ipc.threadDbSaveMessage).mockResolvedValueOnce(1)
    const longContent = 'x'.repeat(200_000)
    await threadDb.saveMessage('t1', makeMessage({ content: longContent }))
    const call = vi.mocked(ipc.threadDbSaveMessage).mock.calls[0][0]
    expect(call.content).toBe(longContent) // content is NOT truncated
  })
})
