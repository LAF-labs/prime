import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockToastError } = vi.hoisted(() => ({ mockToastError: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: mockToastError } }))

import { reportFailure, attempt, resetFailureDedup } from './ipc-report'

beforeEach(() => {
  vi.useFakeTimers()
  mockToastError.mockClear()
  resetFailureDedup()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('reportFailure', () => {
  it('shows the action and the reason', () => {
    reportFailure('Could not delete the file', new Error('permission denied'))
    expect(mockToastError).toHaveBeenCalledWith('Could not delete the file', {
      description: 'permission denied',
    })
  })

  it('tolerates non-Error rejections, which Tauri commands produce', () => {
    // Rust commands returning Result<_, String> reject with a plain string.
    reportFailure('Could not save settings', 'disk full')
    expect(mockToastError).toHaveBeenCalledWith('Could not save settings', {
      description: 'disk full',
    })
  })

  it('collapses the same failure repeating in a burst', () => {
    // A failing refresh loop must produce one toast, not a storm.
    for (let i = 0; i < 5; i++) {
      reportFailure('Could not refresh the tree', new Error('EIO'))
    }
    expect(mockToastError).toHaveBeenCalledTimes(1)
  })

  it('reports again once the window has passed', () => {
    reportFailure('Could not refresh the tree', new Error('EIO'))
    vi.advanceTimersByTime(6_000)
    reportFailure('Could not refresh the tree', new Error('EIO'))
    expect(mockToastError).toHaveBeenCalledTimes(2)
  })

  it('does not collapse different failures of the same action', () => {
    reportFailure('Could not delete the file', new Error('permission denied'))
    reportFailure('Could not delete the file', new Error('file is locked'))
    expect(mockToastError).toHaveBeenCalledTimes(2)
  })
})

describe('attempt', () => {
  it('surfaces a rejection without making the caller wait', async () => {
    attempt('Could not delete the thread', Promise.reject(new Error('gone')))
    await vi.advanceTimersByTimeAsync(0)
    expect(mockToastError).toHaveBeenCalledWith('Could not delete the thread', {
      description: 'gone',
    })
  })

  it('is silent on success', async () => {
    attempt('Could not delete the thread', Promise.resolve('ok'))
    await vi.advanceTimersByTimeAsync(0)
    expect(mockToastError).not.toHaveBeenCalled()
  })
})
