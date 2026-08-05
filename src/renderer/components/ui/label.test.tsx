import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Label } from './label'

describe('Label', () => {
  it('has data-slot label', () => {
    const { container } = render(<Label>Name</Label>)
    expect(container.querySelector('[data-slot="label"]')).toBeInTheDocument()
  })
  it('renders children', () => {
    render(<Label>Email</Label>)
    expect(screen.getByText('Email')).toBeInTheDocument()
  })
  it('applies className', () => {
    const { container } = render(<Label className="custom">L</Label>)
    expect(container.querySelector('[data-slot="label"]')).toHaveClass('custom')
  })
})
