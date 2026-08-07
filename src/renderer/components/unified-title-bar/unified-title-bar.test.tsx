import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mockClose = vi.fn()
const mockMinimize = vi.fn()
const mockMaximize = vi.fn()
const mockUnmaximize = vi.fn()
const mockIsMaximized = vi.fn().mockResolvedValue(false)

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    close: mockClose,
    minimize: mockMinimize,
    maximize: mockMaximize,
    unmaximize: mockUnmaximize,
    isMaximized: mockIsMaximized,
  }),
}))

import { WindowsControls } from './WindowsControls'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('WindowsControls', () => {
  it('renders minimize, maximize, close buttons', () => {
    render(<WindowsControls />)
    expect(screen.getByLabelText('Minimize')).toBeInTheDocument()
    expect(screen.getByLabelText('Maximize')).toBeInTheDocument()
    expect(screen.getByLabelText('Close')).toBeInTheDocument()
  })

  it('calls minimize on minimize click', () => {
    render(<WindowsControls />)
    fireEvent.click(screen.getByLabelText('Minimize'))
    expect(mockMinimize).toHaveBeenCalledTimes(1)
  })

  it('calls close on close click', () => {
    render(<WindowsControls />)
    fireEvent.click(screen.getByLabelText('Close'))
    expect(mockClose).toHaveBeenCalledTimes(1)
  })

  it('calls isMaximized on maximize click', async () => {
    mockIsMaximized.mockResolvedValueOnce(false)
    render(<WindowsControls />)
    fireEvent.click(screen.getByLabelText('Maximize'))
    await vi.waitFor(() => expect(mockIsMaximized).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(mockMaximize).toHaveBeenCalledTimes(1))
  })

  it('calls unmaximize when already maximized', async () => {
    mockIsMaximized.mockResolvedValueOnce(true)
    render(<WindowsControls />)
    fireEvent.click(screen.getByLabelText('Maximize'))
    await vi.waitFor(() => expect(mockUnmaximize).toHaveBeenCalledTimes(1))
  })
})
