import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Empty, EmptyTitle, EmptyDescription, EmptyContent } from './empty'

describe('Empty', () => {
  it('has data-slot empty', () => {
    const { container } = render(<Empty />)
    expect(container.querySelector('[data-slot="empty"]')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(<Empty className="custom" />)
    expect(container.querySelector('[data-slot="empty"]')).toHaveClass('custom')
  })
})

describe('EmptyTitle', () => {
  it('has data-slot empty-title', () => {
    const { container } = render(<EmptyTitle>Title</EmptyTitle>)
    expect(container.querySelector('[data-slot="empty-title"]')).toBeInTheDocument()
  })
})

describe('EmptyDescription', () => {
  it('renders a p element', () => {
    const { container } = render(<EmptyDescription>Desc</EmptyDescription>)
    const el = container.querySelector('[data-slot="empty-description"]')
    expect(el?.tagName).toBe('P')
  })
})

describe('EmptyContent', () => {
  it('has data-slot empty-content', () => {
    const { container } = render(<EmptyContent>Content</EmptyContent>)
    expect(container.querySelector('[data-slot="empty-content"]')).toBeInTheDocument()
  })
})
