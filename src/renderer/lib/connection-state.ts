/**
 * Rich Connection State — First-class UI concept for IPC health.
 *
 * Upgrades the simple boolean `connected` flag to a rich state model that
 * enables meaningful UI:
 *   - "Reconnecting (attempt 2/5)..." banner
 *   - "Last connected 2m ago" when disconnected
 *   - Different UI for "never connected" vs "lost connection"
 *
 * This module is pure state logic — no IPC calls. The connection-health
 * monitor feeds state transitions into this model.
 */

// ── Types ─────────────────────────────────────────────────────────

export type ConnectionPhase =
  | 'idle'           // App just started, haven't tried connecting yet
  | 'connecting'     // First connection attempt in progress
  | 'connected'      // Healthy connection
  | 'disconnected'   // Lost connection, not yet retrying
  | 'reconnecting'   // Actively retrying
  | 'exhausted'      // All retry attempts failed

/** Simplified UI state derived from the full connection status. */
export type ConnectionUiState =
  | 'connected'
  | 'connecting'
  | 'reconnecting'
  | 'error'
  | 'offline'

export interface ConnectionStatus {
  readonly phase: ConnectionPhase
  /** Total connection attempts since app start */
  readonly attemptCount: number
  /** Consecutive reconnection attempts in current cycle */
  readonly reconnectAttemptCount: number
  /** Maximum reconnection attempts before giving up */
  readonly reconnectMaxAttempts: number
  /** Whether we've ever successfully connected */
  readonly hasConnected: boolean
  /** ISO timestamp of last successful connection */
  readonly connectedAt: string | null
  /** ISO timestamp of when connection was lost */
  readonly disconnectedAt: string | null
  /** Last error message */
  readonly lastError: string | null
  /** ISO timestamp of last error */
  readonly lastErrorAt: string | null
  /** ISO timestamp of next retry attempt */
  readonly nextRetryAt: string | null
}

// ── Constants ─────────────────────────────────────────────────────

const DEFAULT_MAX_ATTEMPTS = 5

// ── Initial state ─────────────────────────────────────────────────

export const INITIAL_CONNECTION_STATUS: ConnectionStatus = Object.freeze({
  phase: 'idle',
  attemptCount: 0,
  reconnectAttemptCount: 0,
  reconnectMaxAttempts: DEFAULT_MAX_ATTEMPTS,
  hasConnected: false,
  connectedAt: null,
  disconnectedAt: null,
  lastError: null,
  lastErrorAt: null,
  nextRetryAt: null,
})

// ── State transitions ─────────────────────────────────────────────

export function connectionAttempted(status: ConnectionStatus): ConnectionStatus {
  return {
    ...status,
    phase: status.hasConnected ? 'reconnecting' : 'connecting',
    attemptCount: status.attemptCount + 1,
    reconnectAttemptCount: status.hasConnected
      ? status.reconnectAttemptCount + 1
      : 0,
  }
}

export function connectionEstablished(status: ConnectionStatus): ConnectionStatus {
  return {
    ...status,
    phase: 'connected',
    hasConnected: true,
    connectedAt: new Date().toISOString(),
    reconnectAttemptCount: 0,
    lastError: null,
    lastErrorAt: null,
    nextRetryAt: null,
  }
}

export function connectionLost(status: ConnectionStatus, error?: string): ConnectionStatus {
  return {
    ...status,
    phase: 'disconnected',
    disconnectedAt: new Date().toISOString(),
    lastError: error ?? null,
    lastErrorAt: error ? new Date().toISOString() : status.lastErrorAt,
  }
}

export function connectionRetryScheduled(
  status: ConnectionStatus,
  nextRetryAt: string,
): ConnectionStatus {
  return {
    ...status,
    phase: 'reconnecting',
    nextRetryAt,
  }
}

export function connectionExhausted(status: ConnectionStatus): ConnectionStatus {
  return {
    ...status,
    phase: 'exhausted',
    nextRetryAt: null,
  }
}

export function connectionReset(): ConnectionStatus {
  return { ...INITIAL_CONNECTION_STATUS }
}

// ── Derived state ─────────────────────────────────────────────────

/**
 * Derive a simplified UI state from the full connection status.
 */
export function deriveConnectionUiState(status: ConnectionStatus): ConnectionUiState {
  switch (status.phase) {
    case 'idle':
    case 'connecting':
      return 'connecting'
    case 'connected':
      return 'connected'
    case 'reconnecting':
      return 'reconnecting'
    case 'disconnected':
      return status.hasConnected ? 'error' : 'offline'
    case 'exhausted':
      return 'error'
  }
}

/**
 * Get a human-readable description of the connection state.
 */
export function getConnectionStatusLabel(status: ConnectionStatus): string | null {
  switch (status.phase) {
    case 'idle':
      return null
    case 'connecting':
      return 'Connecting to agent…'
    case 'connected':
      return null
    case 'disconnected':
      return status.lastError
        ? `Disconnected: ${status.lastError}`
        : 'Connection lost'
    case 'reconnecting':
      return `Reconnecting (${status.reconnectAttemptCount}/${status.reconnectMaxAttempts})…`
    case 'exhausted':
      return 'Unable to connect — check that kiro-cli is running'
  }
}

/**
 * Calculate time since last successful connection (for "Last connected X ago").
 */
export function getTimeSinceConnected(status: ConnectionStatus): number | null {
  if (!status.connectedAt) return null
  return Date.now() - new Date(status.connectedAt).getTime()
}

/**
 * Whether the UI should show a connection banner/indicator.
 */
export function shouldShowConnectionBanner(status: ConnectionStatus): boolean {
  return status.phase !== 'connected' && status.phase !== 'idle'
}
