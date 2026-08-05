import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ContextUsageBar } from './ContextUsageBar'

describe('ContextUsageBar', () => {
  it('renders token counts', () => {
    const { container } = render(<ContextUsageBar usage={{ used: 50000, size: 100000 }} />)
    expect(container.textContent).toContain('50k')
    expect(container.textContent).toContain('100k')
  })

  it('shows green bar under 50%', () => {
    const { container } = render(<ContextUsageBar usage={{ used: 30000, size: 100000 }} />)
    expect(container.querySelector('.bg-emerald-500')).toBeInTheDocument()
  })

  it('shows amber bar at 50-79%', () => {
    const { container } = render(<ContextUsageBar usage={{ used: 60000, size: 100000 }} />)
    expect(container.querySelector('.bg-amber-500')).toBeInTheDocument()
  })

  it('shows red bar at 80%+', () => {
    const { container } = render(<ContextUsageBar usage={{ used: 85000, size: 100000 }} />)
    expect(container.querySelector('.bg-red-500')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(<ContextUsageBar usage={{ used: 0, size: 100 }} className="custom" />)
    expect(container.firstChild).toHaveClass('custom')
  })

  it('handles zero size', () => {
    const { container } = render(<ContextUsageBar usage={{ used: 0, size: 0 }} />)
    expect(container).toBeInTheDocument()
  })
})
