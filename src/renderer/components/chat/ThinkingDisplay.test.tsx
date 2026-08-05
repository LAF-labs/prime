import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ThinkingDisplay } from './ThinkingDisplay'

describe('ThinkingDisplay', () => {
  it('shows Thinking... when no text', () => {
    render(<ThinkingDisplay />)
    expect(screen.getByText('Thinking...')).toBeInTheDocument()
  })

  it('shows text when provided', () => {
    const { container } = render(<ThinkingDisplay text="Let me analyze" />)
    expect(container.textContent).toContain('Let me analyze')
  })

  it('expands on click to show Thinking... label', () => {
    render(<ThinkingDisplay text="Deep thought" />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Thinking...')).toBeInTheDocument()
  })
})
