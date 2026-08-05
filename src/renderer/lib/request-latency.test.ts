import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLatencyTracker, resetLatencyTracker } from './request-latency'

beforeEach(() => {
  vi.useFakeTimers()
  resetLatencyTracker()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createLatencyTracker', () => {
  it('tracks a request and returns a unique ID', () => {
    const tracker = createLatencyTracker()
    const id1 = tracker.trackRequest('task_create')
    const id2 = tracker.trackRequest('task_send_message')
    expect(id1).not.toBe(id2)
    expect(id1).toContain('req_')
    tracker.dispose()
  })

  it('does not report slow requests before threshold', () => {
    const tracker = createLatencyTracker({ slowThresholdMs: 5000 })
    tracker.trackRequest('task_create')
    vi.advanceTimersByTime(4999)
    expect(tracker.getSlowRequests()).toHaveLength(0)
    tracker.dispose()
  })

  it('reports slow requests after threshold', () => {
    const tracker = createLatencyTracker({ slowThresholdMs: 5000 })
    tracker.trackRequest('task_create')
    vi.advanceTimersByTime(5001)
    const slow = tracker.getSlowRequests()
    expect(slow).toHaveLength(1)
    expect(slow[0].tag).toBe('task_create')
    tracker.dispose()
  })

  it('removes request from slow list when acknowledged', () => {
    const tracker = createLatencyTracker({ slowThresholdMs: 1000 })
    const id = tracker.trackRequest('task_create')
    vi.advanceTimersByTime(1500)
    expect(tracker.getSlowRequests()).toHaveLength(1)
    tracker.acknowledgeRequest(id)
    expect(tracker.getSlowRequests()).toHaveLength(0)
    tracker.dispose()
  })

  it('does not add to slow list if acknowledged before threshold', () => {
    const tracker = createLatencyTracker({ slowThresholdMs: 5000 })
    const id = tracker.trackRequest('task_create')
    vi.advanceTimersByTime(2000)
    tracker.acknowledgeRequest(id)
    vi.advanceTimersByTime(5000)
    expect(tracker.getSlowRequests()).toHaveLength(0)
    tracker.dispose()
  })

  it('notifies subscribers when requests become slow', () => {
    const tracker = createLatencyTracker({ slowThresholdMs: 1000 })
    const listener = vi.fn()
    tracker.subscribe(listener)
    tracker.trackRequest('task_create')
    vi.advanceTimersByTime(1500)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ tag: 'task_create' }),
    ]))
    tracker.dispose()
  })

  it('clearAll removes all tracked requests and notifies', () => {
    const tracker = createLatencyTracker({ slowThresholdMs: 1000 })
    const listener = vi.fn()
    tracker.trackRequest('a')
    tracker.trackRequest('b')
    vi.advanceTimersByTime(1500)
    tracker.subscribe(listener)
    tracker.clearAll()
    expect(tracker.getSlowRequests()).toHaveLength(0)
    expect(listener).toHaveBeenCalledWith([])
    tracker.dispose()
  })

  it('evicts oldest when maxTracked is exceeded', () => {
    const tracker = createLatencyTracker({ maxTracked: 2, slowThresholdMs: 1000 })
    tracker.trackRequest('first')
    tracker.trackRequest('second')
    tracker.trackRequest('third') // should evict 'first'
    vi.advanceTimersByTime(1500)
    const slow = tracker.getSlowRequests()
    // Only 'second' and 'third' should be tracked
    expect(slow).toHaveLength(2)
    expect(slow.map((r) => r.tag)).toEqual(['second', 'third'])
    tracker.dispose()
  })

  it('unsubscribe stops notifications', () => {
    const tracker = createLatencyTracker({ slowThresholdMs: 1000 })
    const listener = vi.fn()
    const unsub = tracker.subscribe(listener)
    unsub()
    tracker.trackRequest('task_create')
    vi.advanceTimersByTime(1500)
    expect(listener).not.toHaveBeenCalled()
    tracker.dispose()
  })
})
