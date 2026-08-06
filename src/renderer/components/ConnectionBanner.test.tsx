import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConnectionBanner } from './ConnectionBanner'
import { useTaskStore } from '@/stores/taskStore'
import type { ConnectionStatus } from '@/lib/connection-state'

const status = (over: Partial<ConnectionStatus>): ConnectionStatus => ({
  phase: 'connected',
  attemptCount: 1,
  reconnectAttemptCount: 0,
  reconnectMaxAttempts: 5,
  hasConnected: true,
  connectedAt: '2026-08-06T00:00:00Z',
  disconnectedAt: null,
  lastError: null,
  lastErrorAt: null,
  nextRetryAt: null,
  ...over,
})

const setPhase = (over: Partial<ConnectionStatus>) => {
  useTaskStore.setState({ connectionStatus: status(over) })
}

beforeEach(() => setPhase({}))

describe('ConnectionBanner', () => {
  it('renders nothing while the connection is healthy', () => {
    render(<ConnectionBanner />)
    expect(screen.queryByTestId('connection-banner')).toBeNull()
  })

  it('renders nothing during first-launch connecting, to avoid a startup flash', () => {
    setPhase({ phase: 'connecting', hasConnected: false })
    render(<ConnectionBanner />)
    expect(screen.queryByTestId('connection-banner')).toBeNull()
  })

  it('shows the retry count while reconnecting', () => {
    // The health monitor always tracked this; nothing visible consumed it.
    setPhase({ phase: 'reconnecting', reconnectAttemptCount: 2, reconnectMaxAttempts: 5 })
    render(<ConnectionBanner />)
    const banner = screen.getByTestId('connection-banner')
    expect(banner.textContent).toContain('2/5')
  })

  it('tells the user how to recover once retries are exhausted', () => {
    setPhase({ phase: 'exhausted' })
    render(<ConnectionBanner />)
    const banner = screen.getByTestId('connection-banner')
    expect(banner.textContent).toMatch(/send a message|메시지/i)
  })

  it('treats never-having-connected as the serious case', () => {
    // A fresh install whose agent binary is broken should read as an error,
    // not as a transient blip that will fix itself.
    setPhase({ phase: 'disconnected', hasConnected: false })
    render(<ConnectionBanner />)
    expect(screen.getByTestId('connection-banner')).toBeTruthy()
  })

  it('is announced to assistive tech as a status region', () => {
    setPhase({ phase: 'reconnecting', reconnectAttemptCount: 1 })
    render(<ConnectionBanner />)
    expect(screen.getByRole('status')).toBeTruthy()
  })
})
