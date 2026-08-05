import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createDispatchSnapshot,
  deriveDispatchPhase,
  isDispatchComplete,
  getDispatchPhaseLabel,
} from './dispatch-snapshot'
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

describe('createDispatchSnapshot', () => {
  it('captures task state at dispatch time', () => {
    const task = makeTask({ status: 'paused', messages: [{ role: 'user', content: 'hi', timestamp: '' }] })
    const snapshot = createDispatchSnapshot(task, '')
    expect(snapshot.taskId).toBe('test-1')
    expect(snapshot.taskStatus).toBe('paused')
    expect(snapshot.messageCount).toBe(1)
    expect(snapshot.wasStreaming).toBe(false)
    expect(snapshot.startedAt).toBeGreaterThan(0)
  })

  it('detects streaming state', () => {
    const task = makeTask({ status: 'running' })
    const snapshot = createDispatchSnapshot(task, 'some chunk')
    expect(snapshot.wasStreaming).toBe(true)
  })
})

describe('deriveDispatchPhase', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('returns idle when no snapshot', () => {
    const task = makeTask()
    expect(deriveDispatchPhase(null, task, '')).toBe('idle')
  })

  it('returns idle when task is null', () => {
    const snapshot = createDispatchSnapshot(makeTask(), '')
    expect(deriveDispatchPhase(snapshot, null, '')).toBe('idle')
  })

  it('returns idle when snapshot is for different task', () => {
    const snapshot = createDispatchSnapshot(makeTask({ id: 'other' }), '')
    const task = makeTask({ id: 'test-1' })
    expect(deriveDispatchPhase(snapshot, task, '')).toBe('idle')
  })

  it('returns sending when task status unchanged', () => {
    const task = makeTask({ status: 'paused' })
    const snapshot = createDispatchSnapshot(task, '')
    expect(deriveDispatchPhase(snapshot, task, '')).toBe('sending')
  })

  it('returns acknowledged when task transitions to running', () => {
    const task = makeTask({ status: 'paused' })
    const snapshot = createDispatchSnapshot(task, '')
    const updatedTask = makeTask({ status: 'running' })
    expect(deriveDispatchPhase(snapshot, updatedTask, '')).toBe('acknowledged')
  })

  it('returns streaming when chunks arrive', () => {
    const task = makeTask({ status: 'paused' })
    const snapshot = createDispatchSnapshot(task, '')
    const updatedTask = makeTask({ status: 'running' })
    expect(deriveDispatchPhase(snapshot, updatedTask, 'hello')).toBe('streaming')
  })

  it('returns streaming when new messages appear', () => {
    const task = makeTask({ status: 'paused', messages: [] })
    const snapshot = createDispatchSnapshot(task, '')
    const updatedTask = makeTask({
      status: 'paused', // status unchanged — so message count check triggers
      messages: [{ role: 'assistant', content: 'hi', timestamp: '' }],
    })
    expect(deriveDispatchPhase(snapshot, updatedTask, '')).toBe('streaming')
  })

  it('does not flip to streaming when only the user message has been appended', () => {
    // Continuation send: task is already running, we append a user message
    // pre-dispatch, and `deriveDispatchPhase` runs before the assistant
    // replies. It should stay in `sending`, not jump straight to `streaming`.
    const task = makeTask({ status: 'running', messages: [] })
    const snapshot = createDispatchSnapshot(task, '')
    const updatedTask = makeTask({
      status: 'running',
      messages: [{ role: 'user', content: 'follow up', timestamp: '' }],
    })
    expect(deriveDispatchPhase(snapshot, updatedTask, '')).toBe('sending')
  })

  it('returns stale after threshold', () => {
    const task = makeTask({ status: 'paused' })
    const snapshot = createDispatchSnapshot(task, '')
    vi.advanceTimersByTime(31_000)
    expect(deriveDispatchPhase(snapshot, task, '')).toBe('stale')
  })
})

describe('isDispatchComplete', () => {
  it('returns true for streaming', () => {
    expect(isDispatchComplete('streaming')).toBe(true)
  })

  it('returns true for idle', () => {
    expect(isDispatchComplete('idle')).toBe(true)
  })

  it('returns false for sending', () => {
    expect(isDispatchComplete('sending')).toBe(false)
  })

  it('returns false for acknowledged', () => {
    expect(isDispatchComplete('acknowledged')).toBe(false)
  })

  it('returns false for stale', () => {
    expect(isDispatchComplete('stale')).toBe(false)
  })
})

describe('getDispatchPhaseLabel', () => {
  it('returns null for idle', () => {
    expect(getDispatchPhaseLabel('idle')).toBeNull()
  })

  it('returns Sending for sending', () => {
    expect(getDispatchPhaseLabel('sending')).toBe('Sending…')
  })

  it('returns Agent starting for acknowledged', () => {
    expect(getDispatchPhaseLabel('acknowledged')).toBe('Agent starting…')
  })

  it('returns null for streaming', () => {
    expect(getDispatchPhaseLabel('streaming')).toBeNull()
  })

  it('returns warning for stale', () => {
    expect(getDispatchPhaseLabel('stale')).toBe('Taking longer than expected…')
  })
})
