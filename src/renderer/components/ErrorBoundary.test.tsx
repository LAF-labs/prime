import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

const ThrowingChild = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) throw new Error('Test error')
  return <div>OK</div>
}

describe('ErrorBoundary', () => {
  // Suppress console.error from React error boundary
  const originalError = console.error
  beforeEach(() => { console.error = vi.fn() })
  afterEach(() => { console.error = originalError })

  it('renders children when no error', () => {
    render(<ErrorBoundary><div>Child</div></ErrorBoundary>)
    expect(screen.getByText('Child')).toBeInTheDocument()
  })

  it('shows error UI when child throws', () => {
    render(<ErrorBoundary><ThrowingChild shouldThrow /></ErrorBoundary>)
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByTestId('error-boundary-message')).toHaveTextContent('Test error')
  })

  it('shows retry button', () => {
    render(<ErrorBoundary><ThrowingChild shouldThrow /></ErrorBoundary>)
    expect(screen.getByTestId('error-boundary-retry-button')).toBeInTheDocument()
  })

  it('renders custom fallback', () => {
    render(<ErrorBoundary fallback={<div>Custom fallback</div>}><ThrowingChild shouldThrow /></ErrorBoundary>)
    expect(screen.getByText('Custom fallback')).toBeInTheDocument()
  })
})
