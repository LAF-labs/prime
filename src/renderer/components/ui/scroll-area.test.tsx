import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ScrollArea } from './scroll-area'

describe('ScrollArea', () => {
  it('has data-slot scroll-area', () => {
    const { container } = render(<ScrollArea>Content</ScrollArea>)
    expect(container.querySelector('[data-slot="scroll-area"]')).toBeInTheDocument()
  })

  it('renders children', () => {
    const { container } = render(<ScrollArea>Hello</ScrollArea>)
    expect(container.textContent).toContain('Hello')
  })

  it('applies className', () => {
    const { container } = render(<ScrollArea className="custom">C</ScrollArea>)
    expect(container.querySelector('[data-slot="scroll-area"]')).toHaveClass('custom')
  })
})
