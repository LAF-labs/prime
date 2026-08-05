import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Kbd } from './kbd'

describe('Kbd', () => {
  it('renders children', () => {
    render(<Kbd>Ctrl</Kbd>)
    expect(screen.getByText('Ctrl')).toBeInTheDocument()
  })

  it('has data-slot kbd', () => {
    const { container } = render(<Kbd>K</Kbd>)
    expect(container.querySelector('[data-slot="kbd"]')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(<Kbd className="custom">K</Kbd>)
    expect(container.querySelector('kbd')).toHaveClass('custom')
  })
})
