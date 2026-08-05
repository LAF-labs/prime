import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Spinner } from './spinner'

describe('Spinner', () => {
  it('renders with role status', () => {
    render(<Spinner />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('has aria-label Loading', () => {
    render(<Spinner />)
    expect(screen.getByLabelText('Loading')).toBeInTheDocument()
  })

  it('applies animate-spin class', () => {
    render(<Spinner />)
    expect(screen.getByRole('status')).toHaveClass('animate-spin')
  })

  it('applies custom className', () => {
    render(<Spinner className="extra" />)
    expect(screen.getByRole('status')).toHaveClass('extra')
  })
})
