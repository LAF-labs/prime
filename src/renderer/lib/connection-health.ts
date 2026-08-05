/**
 * Connection health monitoring for the ACP backend subprocess.
 *
 * While Tauri IPC doesn't have network-level disconnections, the kiro-cli
 * subprocess can crash or become unresponsive. This module provides:
 *
 * - Periodic health checks via a lightweight IPC probe
 * - Automatic reconnection attempts with exponential backoff
 * - Rich connection state tracking for UI indicators
 * - Request latency tracking integration
 */

import { ipc } from '@/lib/ipc'
import { useTaskStore } from '@/stores/taskStore'
import {
  type ConnectionStatus,
  INITIAL_CONNECTION_STATUS,
  connectionAttempted,
  connectionEstablished,
  connectionLost,
  connectionRetryScheduled,
  connectionExhausted,
} from '@/lib/connection-state'
import { getLatencyTracker } from '@/lib/request-latency'

export interface ConnectionHealthConfig {
  /** Interval between health checks in ms (default: 10000) */
  checkIntervalMs?: number
  /** Maximum number of consecutive failures before giving up (default: 5) */
  maxRetries?: number
  /** Base delay for exponential backoff in ms (default: 1000) */
  baseRetryDelayMs?: number
  /** Maximum backoff delay in ms (default: 30000) */
  maxRetryDelayMs?: number
}

export interface ConnectionHealthState {
  /** Whether the backend is currently reachable */
  healthy: boolean
  /** Number of consecutive failed health checks */
  consecutiveFailures: number
  /** Timestamp of last successful health check */
  lastHealthyAt: number
  /** Whether a reconnection attempt is in progress */
  reconnecting: boolean
}

const DEFAULT_CONFIG: Required<ConnectionHealthConfig> = {
  checkIntervalMs: 10_000,
  maxRetries: 5,
  baseRetryDelayMs: 1_000,
  maxRetryDelayMs: 30_000,
}

/**
 * Calculate exponential backoff delay with jitter.
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt)
  const clampedDelay = Math.min(exponentialDelay, maxDelayMs)
  // Add ±25% jitter to prevent thundering herd
  const jitter = clampedDelay * 0.25 * (Math.random() * 2 - 1)
  return Math.max(0, Math.round(clampedDelay + jitter))
}

/**
 * Start monitoring connection health.
 * Returns a cleanup function to stop monitoring.
 */
export function startConnectionHealthMonitor(
  config: ConnectionHealthConfig = {},
): () => void {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  let intervalId: ReturnType<typeof setInterval> | null = null
  let stopped = false

  const state: ConnectionHealthState = {
    healthy: true,
    consecutiveFailures: 0,
    lastHealthyAt: Date.now(),
    reconnecting: false,
  }

  // Rich connection status — updated alongside the simple boolean
  let connectionStatus: ConnectionStatus = { ...INITIAL_CONNECTION_STATUS, reconnectMaxAttempts: cfg.maxRetries }

  const updateConnectionStatus = (next: ConnectionStatus) => {
    connectionStatus = next
    useTaskStore.getState().setConnectionStatus(next)
  }

  /** Prevents overlapping health checks when a previous one is still in-flight */
  let checkInFlight = false

  const checkHealth = async () => {
    if (stopped || state.reconnecting || checkInFlight) return
    checkInFlight = true

    // Track the probe with the latency tracker so a slow backend shows up in
    // the global slow-request list (UI can read this via getLatencyTracker()).
    const probeId = getLatencyTracker().trackRequest('connection_health.list_tasks')

    try {
      // Use listTasks as a lightweight health probe
      await ipc.listTasks()
      getLatencyTracker().acknowledgeRequest(probeId)
      // Success: reset failure counter
      state.healthy = true
      state.consecutiveFailures = 0
      state.lastHealthyAt = Date.now()
      if (!useTaskStore.getState().connected) {
        useTaskStore.getState().setConnected(true)
      }
      // Always reflect a healthy probe in the rich status — covers both the
      // initial connection and reconnection-after-loss transitions.
      if (connectionStatus.phase !== 'connected') {
        updateConnectionStatus(connectionEstablished(connectionStatus))
      }
    } catch {
      // Failure: drop the tracked probe (the request didn't really complete,
      // but we don't want it lingering in the slow-list either).
      getLatencyTracker().acknowledgeRequest(probeId)
      // Increment counter
      state.consecutiveFailures++
      state.healthy = false

      if (state.consecutiveFailures >= cfg.maxRetries) {
        // Too many failures — mark as disconnected
        useTaskStore.getState().setConnected(false)
        updateConnectionStatus(connectionExhausted(connectionStatus))
        // Clear latency tracker — all pending requests are dead
        getLatencyTracker().clearAll()
      } else {
        // Attempt reconnection with backoff
        state.reconnecting = true
        // Flip the simple boolean now so anything still subscribed to it
        // (banner, streaming gates) can react during the retry window.
        if (useTaskStore.getState().connected) {
          useTaskStore.getState().setConnected(false)
        }

        const delay = calculateBackoffDelay(
          state.consecutiveFailures - 1,
          cfg.baseRetryDelayMs,
          cfg.maxRetryDelayMs,
        )
        const nextRetryAt = new Date(Date.now() + delay).toISOString()
        // Coalesce `attempted → retryScheduled` into a single status emission
        // so subscribers don't see the intermediate `reconnecting/no-retry`
        // state and we don't fire two Zustand notifications back-to-back.
        updateConnectionStatus(
          connectionRetryScheduled(connectionAttempted(connectionStatus), nextRetryAt),
        )

        await sleep(delay)
        if (!stopped) {
          const retryId = getLatencyTracker().trackRequest('connection_health.list_tasks_retry')
          try {
            await ipc.listTasks()
            getLatencyTracker().acknowledgeRequest(retryId)
            state.healthy = true
            state.consecutiveFailures = 0
            state.lastHealthyAt = Date.now()
            useTaskStore.getState().setConnected(true)
            updateConnectionStatus(connectionEstablished(connectionStatus))
          } catch {
            getLatencyTracker().acknowledgeRequest(retryId)
            // Still failing — will retry on next interval. Boolean already
            // false from above; we just refresh the rich status.
            updateConnectionStatus(connectionLost(connectionStatus, 'Health check failed'))
          }
        }
        state.reconnecting = false
      }
    } finally {
      checkInFlight = false
    }
  }

  // Don't optimistically declare "connected" — the backend probe may not
  // have run yet, or kiro-cli may be down at startup. Mark `connecting`
  // instead and let the first probe flip the state to `connected`.
  updateConnectionStatus(connectionAttempted(connectionStatus))

  // Run an immediate probe so we don't sit in `connecting` for a full
  // `checkIntervalMs` if the backend is healthy.
  void checkHealth()

  // Start periodic checks
  intervalId = setInterval(checkHealth, cfg.checkIntervalMs)

  return () => {
    stopped = true
    if (intervalId !== null) {
      clearInterval(intervalId)
      intervalId = null
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
