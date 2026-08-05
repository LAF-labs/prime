import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Separator } from './separator'

describe('Separator', () => {
  it('has data-slot separator', () => {
    const { container } = render(<Separator />)
    expect(container.querySelector('[data-slot="separator"]')).toBeInTheDocument()
  })
  it('renders horizontal by default', () => {
    const { container } = render(<Separator />)
    expect(container.querySelector('[data-orientation="horizontal"]')).toBeInTheDocument()
  })
  it('renders vertical', () => {
    const { container } = render(<Separator orientation="vertical" />)
    expect(container.querySelector('[data-orientation="vertical"]')).toBeInTheDocument()
  })
  it('applies className', () => {
    const { container } = render(<Separator className="custom" />)
    expect(container.querySelector('[data-slot="separator"]')).toHaveClass('custom')
  })
})
