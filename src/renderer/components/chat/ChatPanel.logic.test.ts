import { describe, it, expect } from 'vitest'
import {
  deriveInputState,
  shouldQueueMessage,
  isTaskRunning,
  isPanelFocused,
  isBtwModeActive,
  contextUsageEqual,
  permissionEqual,
  needsNewConnection,
  extractProjectName,
  buildUserMessage,
} from './ChatPanel.logic'
import type { AgentTask } from '@/types'

const makeTask = (overrides: Partial<AgentTask> = {}): AgentTask => ({
  id: 'test-1',
  name: 'Test',
  workspace: '/home/user/project',
  status: 'paused',
  createdAt: '2024-01-01',
  messages: [],
  ...overrides,
})

describe('deriveInputState', () => {
  it('returns disabled for null task', () => {
    expect(deriveInputState(null)).toEqual({ disabled: true, disabledReason: undefined })
  })

  it('returns enabled for archived task (stateless resumption)', () => {
    const task = makeTask({ isArchived: true })
    expect(deriveInputState(task)).toEqual({ disabled: false, disabledReason: undefined })
  })

  it('returns disabled with reason for cancelled task', () => {
    const task = makeTask({ status: 'cancelled' })
    expect(deriveInputState(task)).toEqual({ disabled: true, disabledReason: 'Task was cancelled' })
  })

  it('returns enabled for active task', () => {
    const task = makeTask({ status: 'running' })
    expect(deriveInputState(task)).toEqual({ disabled: false, disabledReason: undefined })
  })
})

describe('shouldQueueMessage', () => {
  it('returns false for null task', () => {
    expect(shouldQueueMessage(null, false)).toBe(false)
  })

  it('returns true when running and not in btw mode', () => {
    const task = makeTask({ status: 'running' })
    expect(shouldQueueMessage(task, false)).toBe(true)
  })

  it('returns false when running but in btw mode', () => {
    const task = makeTask({ status: 'running' })
    expect(shouldQueueMessage(task, true)).toBe(false)
  })

  it('returns false when paused', () => {
    const task = makeTask({ status: 'paused' })
    expect(shouldQueueMessage(task, false)).toBe(false)
  })
})

describe('isTaskRunning', () => {
  it('returns true for running', () => {
    expect(isTaskRunning('running')).toBe(true)
  })

  it('returns false for paused', () => {
    expect(isTaskRunning('paused')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isTaskRunning(null)).toBe(false)
  })
})

describe('isPanelFocused', () => {
  it('returns true when no split is active', () => {
    expect(isPanelFocused(null, 'task-1', [], 'left')).toBe(true)
  })

  it('returns true when no taskIdProp', () => {
    expect(isPanelFocused('split-1', null, [], 'left')).toBe(true)
  })

  it('returns true when task matches focused panel', () => {
    const splits = [{ id: 'split-1', left: 'task-1', right: 'task-2' }]
    expect(isPanelFocused('split-1', 'task-1', splits, 'left')).toBe(true)
  })

  it('returns false when task does not match focused panel', () => {
    const splits = [{ id: 'split-1', left: 'task-1', right: 'task-2' }]
    expect(isPanelFocused('split-1', 'task-2', splits, 'left')).toBe(false)
  })
})

describe('isBtwModeActive', () => {
  it('returns false when no checkpoint', () => {
    expect(isBtwModeActive(null, 'task-1')).toBe(false)
  })

  it('returns true when checkpoint matches task', () => {
    expect(isBtwModeActive({ taskId: 'task-1' }, 'task-1')).toBe(true)
  })

  it('returns false when checkpoint is for different task', () => {
    expect(isBtwModeActive({ taskId: 'task-2' }, 'task-1')).toBe(false)
  })
})

describe('contextUsageEqual', () => {
  it('returns true for same reference', () => {
    const a = { used: 10, size: 100 }
    expect(contextUsageEqual(a, a)).toBe(true)
  })

  it('returns true for equal values', () => {
    expect(contextUsageEqual({ used: 10, size: 100 }, { used: 10, size: 100 })).toBe(true)
  })

  it('returns false for different values', () => {
    expect(contextUsageEqual({ used: 10, size: 100 }, { used: 20, size: 100 })).toBe(false)
  })

  it('returns true for both null', () => {
    expect(contextUsageEqual(null, null)).toBe(true)
  })

  it('returns false for one null', () => {
    expect(contextUsageEqual({ used: 10, size: 100 }, null)).toBe(false)
  })
})

describe('permissionEqual', () => {
  it('returns true for same requestId', () => {
    expect(permissionEqual({ requestId: 'a' }, { requestId: 'a' })).toBe(true)
  })

  it('returns false for different requestId', () => {
    expect(permissionEqual({ requestId: 'a' }, { requestId: 'b' })).toBe(false)
  })
})

describe('needsNewConnection', () => {
  it('returns true for draft (no messages, paused)', () => {
    const task = makeTask({ messages: [], status: 'paused' })
    expect(needsNewConnection(task)).toBe(true)
  })

  it('returns true when needsNewConnection flag is set', () => {
    const task = makeTask({ messages: [{ role: 'user', content: 'hi', timestamp: '' }], needsNewConnection: true })
    expect(needsNewConnection(task)).toBe(true)
  })

  it('returns true for archived task (resumed from history)', () => {
    const task = makeTask({
      messages: [{ role: 'user', content: 'hi', timestamp: '' }],
      status: 'completed',
      isArchived: true,
    })
    expect(needsNewConnection(task)).toBe(true)
  })

  it('returns false for active task with messages', () => {
    const task = makeTask({ messages: [{ role: 'user', content: 'hi', timestamp: '' }], status: 'running' })
    expect(needsNewConnection(task)).toBe(false)
  })
})

describe('extractProjectName', () => {
  it('extracts last path segment', () => {
    const task = makeTask({ workspace: '/home/user/my-project' })
    expect(extractProjectName(task)).toBe('my-project')
  })

  it('prefers originalWorkspace', () => {
    const task = makeTask({ workspace: '/worktree/branch', originalWorkspace: '/home/user/real-project' })
    expect(extractProjectName(task)).toBe('real-project')
  })

  it('handles Windows paths', () => {
    const task = makeTask({ workspace: 'C:\\Users\\dev\\project' })
    expect(extractProjectName(task)).toBe('project')
  })
})

describe('buildUserMessage', () => {
  it('creates a user message with current timestamp', () => {
    const msg = buildUserMessage('hello')
    expect(msg.role).toBe('user')
    expect(msg.content).toBe('hello')
    expect(msg.timestamp).toBeTruthy()
  })
})

describe('deriveInputState — edge cases', () => {
  it('returns enabled for paused task', () => {
    const task = makeTask({ status: 'paused' })
    expect(deriveInputState(task)).toEqual({ disabled: false, disabledReason: undefined })
  })

  it('returns enabled for error task (user can retry)', () => {
    const task = makeTask({ status: 'error' })
    expect(deriveInputState(task)).toEqual({ disabled: false, disabledReason: undefined })
  })

  it('returns enabled for completed task (user can send follow-up)', () => {
    const task = makeTask({ status: 'completed' })
    expect(deriveInputState(task)).toEqual({ disabled: false, disabledReason: undefined })
  })

  it('returns enabled for archived task (input drives reconnection)', () => {
    const task = makeTask({ status: 'completed', isArchived: true })
    expect(deriveInputState(task)).toEqual({ disabled: false, disabledReason: undefined })
  })

  it('returns disabled for undefined task', () => {
    expect(deriveInputState(undefined)).toEqual({ disabled: true, disabledReason: undefined })
  })
})

describe('isPanelFocused — edge cases', () => {
  it('returns true when split view not found', () => {
    const splits = [{ id: 'split-1', left: 'task-1', right: 'task-2' }]
    expect(isPanelFocused('split-999', 'task-1', splits, 'left')).toBe(true)
  })

  it('handles right panel focus correctly', () => {
    const splits = [{ id: 'split-1', left: 'task-1', right: 'task-2' }]
    expect(isPanelFocused('split-1', 'task-2', splits, 'right')).toBe(true)
    expect(isPanelFocused('split-1', 'task-1', splits, 'right')).toBe(false)
  })
})

describe('extractProjectName — edge cases', () => {
  it('handles root path', () => {
    const task = makeTask({ workspace: '/' })
    expect(extractProjectName(task)).toBe('')
  })

  it('handles single segment path', () => {
    const task = makeTask({ workspace: 'project' })
    expect(extractProjectName(task)).toBe('project')
  })

  it('handles path with trailing slash', () => {
    const task = makeTask({ workspace: '/home/user/project/' })
    // split('/').pop() on trailing slash gives ''
    expect(extractProjectName(task)).toBe('')
  })
})

describe('shouldQueueMessage — edge cases', () => {
  it('returns false for completed task', () => {
    const task = makeTask({ status: 'completed' })
    expect(shouldQueueMessage(task, false)).toBe(false)
  })

  it('returns false for error task', () => {
    const task = makeTask({ status: 'error' })
    expect(shouldQueueMessage(task, false)).toBe(false)
  })

  it('returns false for undefined task', () => {
    expect(shouldQueueMessage(undefined, false)).toBe(false)
  })
})

describe('needsNewConnection — edge cases', () => {
  it('returns false for running task with messages', () => {
    const task = makeTask({
      messages: [{ role: 'user', content: 'hi', timestamp: '' }],
      status: 'running',
    })
    expect(needsNewConnection(task)).toBe(false)
  })

  it('returns true for paused task with no messages (fresh draft)', () => {
    const task = makeTask({ messages: [], status: 'paused' })
    expect(needsNewConnection(task)).toBe(true)
  })

  it('returns false for paused task with messages (resumed)', () => {
    const task = makeTask({
      messages: [{ role: 'user', content: 'hi', timestamp: '' }],
      status: 'paused',
    })
    expect(needsNewConnection(task)).toBe(false)
  })

  it('returns true for archived completed task (loaded from history)', () => {
    const task = makeTask({
      messages: [{ role: 'user', content: 'hi', timestamp: '' }],
      status: 'completed',
      isArchived: true,
    })
    expect(needsNewConnection(task)).toBe(true)
  })
})

describe('buildUserMessage', () => {
  it('creates message with correct role', () => {
    const msg = buildUserMessage('test content')
    expect(msg.role).toBe('user')
  })

  it('preserves content exactly', () => {
    const msg = buildUserMessage('  spaces preserved  ')
    expect(msg.content).toBe('  spaces preserved  ')
  })

  it('generates ISO timestamp', () => {
    const msg = buildUserMessage('test')
    // Should be a valid ISO date string
    expect(new Date(msg.timestamp).toISOString()).toBe(msg.timestamp)
  })
})
