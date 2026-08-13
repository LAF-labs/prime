import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StorageBanner } from './StorageBanner'

const threadDbIsDegraded = vi.fn()
vi.mock('@/lib/ipc', () => ({
  ipc: {
    threadDbIsDegraded: () => threadDbIsDegraded(),
  },
}))

beforeEach(() => {
  threadDbIsDegraded.mockReset()
})

describe('StorageBanner', () => {
  /**
   * The failure this exists for: the app works, saves, reloads — and loses it
   * all on quit. Silence is what made that a surprise.
   */
  it('warns when the database fell back to memory', async () => {
    threadDbIsDegraded.mockResolvedValue(true)
    render(<StorageBanner />)
    await waitFor(() => {
      expect(screen.getByTestId('storage-banner')).toBeInTheDocument()
    })
    expect(screen.getByRole('alert').textContent).toContain('will not be saved')
  })

  it('says nothing on a healthy database', async () => {
    threadDbIsDegraded.mockResolvedValue(false)
    render(<StorageBanner />)
    await waitFor(() => expect(threadDbIsDegraded).toHaveBeenCalled())
    expect(screen.queryByTestId('storage-banner')).toBeNull()
  })

  /**
   * A failed check is not evidence of a broken database. Claiming data loss on
   * a working install would be worse than the silence this replaced.
   */
  it('stays quiet when the check itself fails', async () => {
    threadDbIsDegraded.mockRejectedValue(new Error('ipc down'))
    render(<StorageBanner />)
    await waitFor(() => expect(threadDbIsDegraded).toHaveBeenCalled())
    expect(screen.queryByTestId('storage-banner')).toBeNull()
  })

  /** The flag cannot change while the app runs, so asking twice is waste. */
  it('asks once', async () => {
    threadDbIsDegraded.mockResolvedValue(true)
    const { rerender } = render(<StorageBanner />)
    await waitFor(() => expect(screen.getByTestId('storage-banner')).toBeInTheDocument())
    rerender(<StorageBanner />)
    expect(threadDbIsDegraded).toHaveBeenCalledTimes(1)
  })
})
