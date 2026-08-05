import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useUpdateStore } from '@/stores/updateStore'
import { RestartPromptDialog } from './RestartPromptDialog'

beforeEach(() => {
  useUpdateStore.setState({
    status: 'idle',
    updateInfo: null,
    progress: null,
    error: null,
    dismissedVersion: null,
    triggerDownload: null,
    triggerRestart: null,
  })
})

describe('RestartPromptDialog', () => {
  it('does not render when status is idle', () => {
    render(<RestartPromptDialog />)
    expect(screen.queryByText('Update ready')).not.toBeInTheDocument()
  })

  it('does not render when status is available', () => {
    useUpdateStore.setState({ status: 'available' })
    render(<RestartPromptDialog />)
    expect(screen.queryByText('Update ready')).not.toBeInTheDocument()
  })

  it('renders dialog when status is ready', () => {
    useUpdateStore.setState({
      status: 'ready',
      updateInfo: { version: '2.0.0' },
    })
    render(<RestartPromptDialog />)
    expect(screen.getByText('Update ready')).toBeInTheDocument()
    expect(screen.getByText(/v2\.0\.0/)).toBeInTheDocument()
  })

  it('shows generic message when no version info', () => {
    useUpdateStore.setState({ status: 'ready', updateInfo: null })
    render(<RestartPromptDialog />)
    expect(screen.getByText(/A new version has been downloaded/)).toBeInTheDocument()
  })

  it('calls triggerRestart when "Restart now" is clicked', () => {
    const mockRestart = vi.fn()
    useUpdateStore.setState({
      status: 'ready',
      updateInfo: { version: '2.0.0' },
      triggerRestart: mockRestart,
    })
    render(<RestartPromptDialog />)
    fireEvent.click(screen.getByText('Restart now'))
    expect(mockRestart).toHaveBeenCalledOnce()
  })

  it('resets store when "Later" is clicked', () => {
    useUpdateStore.setState({
      status: 'ready',
      updateInfo: { version: '2.0.0' },
      triggerRestart: vi.fn(),
    })
    render(<RestartPromptDialog />)
    fireEvent.click(screen.getByText('Later'))
    expect(useUpdateStore.getState().status).toBe('idle')
  })

  it('has both action buttons', () => {
    useUpdateStore.setState({
      status: 'ready',
      updateInfo: { version: '2.0.0' },
    })
    render(<RestartPromptDialog />)
    expect(screen.getByText('Later')).toBeInTheDocument()
    expect(screen.getByText('Restart now')).toBeInTheDocument()
  })
})
