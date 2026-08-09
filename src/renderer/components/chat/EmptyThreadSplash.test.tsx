import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { EmptyThreadSplash } from './EmptyThreadSplash'

describe('EmptyThreadSplash', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders three starter prompts', () => {
    render(<EmptyThreadSplash />)
    expect(screen.getAllByTestId('starter-prompt')).toHaveLength(3)
  })

  /**
   * The first thing a new thread shows sets the expectation for everything
   * after it, so the prompts are about files, documents and questions rather
   * than about code.
   */
  it('offers everyday prompts, not coding tasks', () => {
    render(<EmptyThreadSplash />)
    expect(screen.getByText('Summarize a document for me')).toBeInTheDocument()
    expect(screen.queryByText('Find and fix a bug')).toBeNull()
    expect(screen.queryByText('Explain this codebase')).toBeNull()
  })

  it('clicking a starter prompt dispatches splash-insert with the prompt text', () => {
    const listener = vi.fn()
    document.addEventListener('splash-insert', listener)
    try {
      render(<EmptyThreadSplash />)
      fireEvent.click(screen.getByText('Summarize a document for me'))
      expect(listener).toHaveBeenCalledTimes(1)
      const event = listener.mock.calls[0][0] as CustomEvent<string>
      expect(event.detail).toBe('Summarize a document for me')
    } finally {
      document.removeEventListener('splash-insert', listener)
    }
  })

  /**
   * The splash used to carry its own copy of the command list, which could
   * drift from the registry and advertise a `/foo` the app cannot run (an
   * unrecognized command is sent to the model as literal text). Typing `/`
   * opens the picker, which reads the registry directly. Keeping the splash
   * free of commands is what makes that class of bug unreachable.
   */
  it('advertises no commands of its own — the picker owns that list', () => {
    render(<EmptyThreadSplash />)
    // `\w` after the sigil, so the bare `/` and `@` in the hint don't match.
    expect(screen.queryByText(/^\/\w+/)).toBeNull()
    expect(screen.queryByText(/^@\w+/)).toBeNull()
  })

  /** Three prompts and nothing else; the old screen opened with sixteen. */
  it('stays small enough to not out-weigh the conversation', () => {
    render(<EmptyThreadSplash />)
    expect(screen.getAllByRole('button')).toHaveLength(3)
  })

  it('still points at both pickers so the commands stay discoverable', () => {
    render(<EmptyThreadSplash />)
    expect(screen.getByText('/')).toBeInTheDocument()
    expect(screen.getByText('@')).toBeInTheDocument()
  })
})
