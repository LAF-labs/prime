import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { EmptyThreadSplash } from './EmptyThreadSplash'
import { CLIENT_COMMANDS } from '@/lib/agent-commands'

describe('EmptyThreadSplash', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('only advertises slash commands that exist in the registry', () => {
    // An unrecognized /foo is sent to the model as literal text, so every
    // command shown on the splash must be executable.
    render(<EmptyThreadSplash />)
    const known = new Set(CLIENT_COMMANDS.map((c) => `/${c.name}`))
    const labels = screen
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? '')
      .filter((label) => label.startsWith('Insert /'))
      .map((label) => label.slice('Insert '.length))
    expect(labels.length).toBeGreaterThan(0)
    for (const label of labels) {
      expect(known.has(label), `${label} is not a registered command`).toBe(true)
    }
  })

  it('does not advertise the nonexistent /tools command', () => {
    render(<EmptyThreadSplash />)
    expect(screen.queryByText('/tools')).toBeNull()
  })

  it('renders three starter prompts', () => {
    render(<EmptyThreadSplash />)
    expect(screen.getAllByTestId('starter-prompt')).toHaveLength(3)
  })

  it('clicking a starter prompt dispatches splash-insert with the prompt text', () => {
    const listener = vi.fn()
    document.addEventListener('splash-insert', listener)
    try {
      render(<EmptyThreadSplash />)
      fireEvent.click(screen.getByText('Explain this codebase'))
      expect(listener).toHaveBeenCalledTimes(1)
      const event = listener.mock.calls[0][0] as CustomEvent<string>
      expect(event.detail).toBe('Explain this codebase')
    } finally {
      document.removeEventListener('splash-insert', listener)
    }
  })
})
