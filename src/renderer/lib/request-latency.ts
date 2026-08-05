/**
 * Request Latency Tracking — Surface slow IPC operations to the user.
 *
 * Tracks IPC requests that exceed a configurable threshold and surfaces them
 * for UI indicators. Bounded to prevent memory leaks, auto-clears on
 * reconnection.
 *
 * Usage:
 *   const tracker = createLatencyTracker()
 *   const requestId = tracker.trackRequest('task_create')
 *   // ... later when response arrives:
 *   tracker.acknowledgeRequest(requestId)
 */

// ── Types ─────────────────────────────────────────────────────────

export interface SlowRequest {
  readonly requestId: string
  readonly tag: string
  readonly startedAt: number
  readonly thresholdMs: number
}

export interface LatencyTrackerConfig {
  /** Threshold in ms before a request is considered slow (default: 5000) */
  slowThresholdMs?: number
  /** Maximum number of tracked requests to prevent memory leaks (default: 128) */
  maxTracked?: number
}

export interface LatencyTracker {
  /** Start tracking a request. Returns a unique request ID. */
  trackRequest: (tag: string) => string
  /** Acknowledge a request completed (removes from tracking). */
  acknowledgeRequest: (requestId: string) => void
  /** Get all currently slow (unacknowledged, past threshold) requests. */
  getSlowRequests: () => readonly SlowRequest[]
  /** Clear all tracked requests (e.g., on reconnection). */
  clearAll: () => void
  /** Subscribe to slow request changes. Returns unsubscribe function. */
  subscribe: (listener: (slow: readonly SlowRequest[]) => void) => () => void
  /** Dispose the tracker and clear all timers. */
  dispose: () => void
}

// ── Constants ─────────────────────────────────────────────────────

const DEFAULT_SLOW_THRESHOLD_MS = 5_000
const DEFAULT_MAX_TRACKED = 128

// ── Implementation ────────────────────────────────────────────────

let nextId = 0

interface PendingRequest {
  readonly request: SlowRequest
  readonly timeoutId: ReturnType<typeof setTimeout>
}

export function createLatencyTracker(config: LatencyTrackerConfig = {}): LatencyTracker {
  const slowThresholdMs = config.slowThresholdMs ?? DEFAULT_SLOW_THRESHOLD_MS
  const maxTracked = config.maxTracked ?? DEFAULT_MAX_TRACKED

  const pending = new Map<string, PendingRequest>()
  let slowRequests: SlowRequest[] = []
  const listeners = new Set<(slow: readonly SlowRequest[]) => void>()

  const notify = () => {
    for (const listener of listeners) {
      listener(slowRequests)
    }
  }

  const evictOldestIfNeeded = () => {
    if (pending.size >= maxTracked) {
      // Remove the oldest entry
      const firstKey = pending.keys().next().value
      if (firstKey !== undefined) {
        const entry = pending.get(firstKey)
        if (entry) clearTimeout(entry.timeoutId)
        pending.delete(firstKey)
      }
    }
  }

  const trackRequest = (tag: string): string => {
    const requestId = `req_${++nextId}_${Date.now()}`
    evictOldestIfNeeded()

    const request: SlowRequest = {
      requestId,
      tag,
      startedAt: Date.now(),
      thresholdMs: slowThresholdMs,
    }

    const timeoutId = setTimeout(() => {
      // Request exceeded threshold — add to slow list
      slowRequests = [...slowRequests, request]
      notify()
    }, slowThresholdMs)

    pending.set(requestId, { request, timeoutId })
    return requestId
  }

  const acknowledgeRequest = (requestId: string): void => {
    const entry = pending.get(requestId)
    if (!entry) return
    clearTimeout(entry.timeoutId)
    pending.delete(requestId)

    // Remove from slow list if it was there
    const prevLen = slowRequests.length
    slowRequests = slowRequests.filter((r) => r.requestId !== requestId)
    if (slowRequests.length !== prevLen) {
      notify()
    }
  }

  const getSlowRequests = (): readonly SlowRequest[] => slowRequests

  const clearAll = (): void => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timeoutId)
    }
    pending.clear()
    const hadSlow = slowRequests.length > 0
    slowRequests = []
    if (hadSlow) notify()
  }

  const subscribe = (listener: (slow: readonly SlowRequest[]) => void): (() => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  const dispose = (): void => {
    clearAll()
    listeners.clear()
  }

  return {
    trackRequest,
    acknowledgeRequest,
    getSlowRequests,
    clearAll,
    subscribe,
    dispose,
  }
}

// ── Singleton instance for the app ────────────────────────────────

let _instance: LatencyTracker | null = null

export function getLatencyTracker(): LatencyTracker {
  if (!_instance) {
    _instance = createLatencyTracker()
  }
  return _instance
}

/** Reset the singleton (for testing). */
export function resetLatencyTracker(): void {
  if (_instance) {
    _instance.dispose()
    _instance = null
  }
}
