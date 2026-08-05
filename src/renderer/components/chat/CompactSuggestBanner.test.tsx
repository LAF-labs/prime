import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { CompactSuggestBanner } from './CompactSuggestBanner'

describe('CompactSuggestBanner', () => {
  it('returns null when isPlanMode is false', () => {
    const { container } = render(
      <CompactSuggestBanner contextUsage={{ used: 50000, size: 100000 }} isPlanMode={false} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('returns null when contextUsage is null', () => {
    const { container } = render(
      <CompactSuggestBanner contextUsage={null} isPlanMode={true} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('returns null when percentage is below threshold', () => {
    const { container } = render(
      <CompactSuggestBanner contextUsage={{ used: 20000, size: 100000 }} isPlanMode={true} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders when percentage >= 30 and isPlanMode is true', () => {
    render(
      <CompactSuggestBanner contextUsage={{ used: 30000, size: 100000 }} isPlanMode={true} />,
    )
    expect(screen.getByTestId('compact-suggest-banner')).toBeInTheDocument()
  })

  it('shows the correct percentage in the text', () => {
    render(
      <CompactSuggestBanner contextUsage={{ used: 45000, size: 100000 }} isPlanMode={true} />,
    )
    expect(screen.getByTestId('compact-suggest-banner').textContent).toContain('45%')
  })

  it('contains a Start building clickable element', () => {
    render(
      <CompactSuggestBanner contextUsage={{ used: 50000, size: 100000 }} isPlanMode={true} />,
    )
    expect(screen.getByRole('button', { name: /implement now with fresh context/i })).toBeInTheDocument()
  })
})
