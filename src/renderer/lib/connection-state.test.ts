import { describe, it, expect } from 'vitest'
import {
  INITIAL_CONNECTION_STATUS,
  connectionAttempted,
  connectionEstablished,
  connectionLost,
  connectionRetryScheduled,
  connectionExhausted,
  connectionReset,
  deriveConnectionUiState,
  getConnectionStatusLabel,
  shouldShowConnectionBanner,
  getTimeSinceConnected,
} from './connection-state'

describe('connection state transitions', () => {
  it('starts in idle phase', () => {
    expect(INITIAL_CONNECTION_STATUS.phase).toBe('idle')
    expect(INITIAL_CONNECTION_STATUS.hasConnected).toBe(false)
  })

  it('connectionAttempted transitions to connecting on first attempt', () => {
    const next = connectionAttempted(INITIAL_CONNECTION_STATUS)
    expect(next.phase).toBe('connecting')
    expect(next.attemptCount).toBe(1)
    expect(next.reconnectAttemptCount).toBe(0)
  })

  it('connectionAttempted transitions to reconnecting after first connection', () => {
    const connected = connectionEstablished(INITIAL_CONNECTION_STATUS)
    const disconnected = connectionLost(connected)
    const next = connectionAttempted(disconnected)
    expect(next.phase).toBe('reconnecting')
    expect(next.reconnectAttemptCount).toBe(1)
  })

  it('connectionEstablished resets retry state', () => {
    let status = connectionAttempted(INITIAL_CONNECTION_STATUS)
    status = connectionEstablished(status)
    expect(status.phase).toBe('connected')
    expect(status.hasConnected).toBe(true)
    expect(status.reconnectAttemptCount).toBe(0)
    expect(status.connectedAt).not.toBeNull()
    expect(status.lastError).toBeNull()
  })

  it('connectionLost records disconnection', () => {
    const connected = connectionEstablished(INITIAL_CONNECTION_STATUS)
    const lost = connectionLost(connected, 'Process crashed')
    expect(lost.phase).toBe('disconnected')
    expect(lost.disconnectedAt).not.toBeNull()
    expect(lost.lastError).toBe('Process crashed')
    expect(lost.lastErrorAt).not.toBeNull()
  })

  it('connectionRetryScheduled sets next retry time', () => {
    const lost = connectionLost(connectionEstablished(INITIAL_CONNECTION_STATUS))
    const retry = connectionRetryScheduled(lost, '2024-01-01T00:00:05Z')
    expect(retry.phase).toBe('reconnecting')
    expect(retry.nextRetryAt).toBe('2024-01-01T00:00:05Z')
  })

  it('connectionExhausted clears retry info', () => {
    const retrying = connectionRetryScheduled(
      connectionLost(connectionEstablished(INITIAL_CONNECTION_STATUS)),
      '2024-01-01T00:00:05Z',
    )
    const exhausted = connectionExhausted(retrying)
    expect(exhausted.phase).toBe('exhausted')
    expect(exhausted.nextRetryAt).toBeNull()
  })

  it('connectionReset returns to initial state', () => {
    const connected = connectionEstablished(INITIAL_CONNECTION_STATUS)
    const reset = connectionReset()
    expect(reset).toEqual(INITIAL_CONNECTION_STATUS)
    expect(reset.hasConnected).toBe(false)
    // Ensure connected state is not carried over
    expect(connected.hasConnected).toBe(true)
  })
})

describe('deriveConnectionUiState', () => {
  it('idle → connecting', () => {
    expect(deriveConnectionUiState(INITIAL_CONNECTION_STATUS)).toBe('connecting')
  })

  it('connected → connected', () => {
    expect(deriveConnectionUiState(connectionEstablished(INITIAL_CONNECTION_STATUS))).toBe('connected')
  })

  it('reconnecting → reconnecting', () => {
    const status = connectionRetryScheduled(
      connectionLost(connectionEstablished(INITIAL_CONNECTION_STATUS)),
      '2024-01-01T00:00:05Z',
    )
    expect(deriveConnectionUiState(status)).toBe('reconnecting')
  })

  it('exhausted → error', () => {
    const status = connectionExhausted(
      connectionLost(connectionEstablished(INITIAL_CONNECTION_STATUS)),
    )
    expect(deriveConnectionUiState(status)).toBe('error')
  })

  it('disconnected after connection → error', () => {
    const status = connectionLost(connectionEstablished(INITIAL_CONNECTION_STATUS))
    expect(deriveConnectionUiState(status)).toBe('error')
  })

  it('disconnected without prior connection → offline', () => {
    const status = connectionLost(INITIAL_CONNECTION_STATUS)
    expect(deriveConnectionUiState(status)).toBe('offline')
  })
})

describe('getConnectionStatusLabel', () => {
  it('returns null for idle', () => {
    expect(getConnectionStatusLabel(INITIAL_CONNECTION_STATUS)).toBeNull()
  })

  it('returns null for connected', () => {
    expect(getConnectionStatusLabel(connectionEstablished(INITIAL_CONNECTION_STATUS))).toBeNull()
  })

  it('returns reconnecting message with counts', () => {
    let status = connectionEstablished(INITIAL_CONNECTION_STATUS)
    status = connectionLost(status)
    status = connectionAttempted(status)
    const label = getConnectionStatusLabel(status)
    expect(label).toContain('Reconnecting')
    expect(label).toContain('1/')
  })

  it('returns exhausted message', () => {
    const status = connectionExhausted(connectionLost(connectionEstablished(INITIAL_CONNECTION_STATUS)))
    expect(getConnectionStatusLabel(status)).toContain('Unable to connect')
  })
})

describe('shouldShowConnectionBanner', () => {
  it('returns false for connected', () => {
    expect(shouldShowConnectionBanner(connectionEstablished(INITIAL_CONNECTION_STATUS))).toBe(false)
  })

  it('returns false for idle', () => {
    expect(shouldShowConnectionBanner(INITIAL_CONNECTION_STATUS)).toBe(false)
  })

  it('returns true for disconnected', () => {
    expect(shouldShowConnectionBanner(connectionLost(connectionEstablished(INITIAL_CONNECTION_STATUS)))).toBe(true)
  })

  it('returns true for reconnecting', () => {
    const status = connectionRetryScheduled(
      connectionLost(connectionEstablished(INITIAL_CONNECTION_STATUS)),
      '2024-01-01T00:00:05Z',
    )
    expect(shouldShowConnectionBanner(status)).toBe(true)
  })
})

describe('getTimeSinceConnected', () => {
  it('returns null when never connected', () => {
    expect(getTimeSinceConnected(INITIAL_CONNECTION_STATUS)).toBeNull()
  })

  it('returns elapsed time since connection', () => {
    const status = connectionEstablished(INITIAL_CONNECTION_STATUS)
    const elapsed = getTimeSinceConnected(status)
    expect(elapsed).not.toBeNull()
    expect(elapsed!).toBeGreaterThanOrEqual(0)
    expect(elapsed!).toBeLessThan(1000) // should be very recent
  })
})
