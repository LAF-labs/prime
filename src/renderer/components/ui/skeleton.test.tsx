import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Skeleton } from './skeleton'

describe('Skeleton', () => {
  it('has data-slot skeleton', () => {
    const { container } = render(<Skeleton />)
    expect(container.querySelector('[data-slot="skeleton"]')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(<Skeleton className="custom" />)
    expect(container.firstChild).toHaveClass('custom')
  })
})
