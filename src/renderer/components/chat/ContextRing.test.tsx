import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ContextRing } from './ContextRing'
import { TooltipProvider } from '@/components/ui/tooltip'

const wrap = (ui: React.ReactNode) => <TooltipProvider>{ui}</TooltipProvider>

describe('ContextRing', () => {
  it('shows percentage', () => {
    const { container } = render(wrap(<ContextRing used={50} size={100} />))
    expect(container.textContent).toContain('50')
  })

  it('calculates percentage from token counts', () => {
    const { container } = render(wrap(<ContextRing used={5000} size={10000} />))
    expect(container.textContent).toContain('50')
  })

  it('renders testid', () => {
    const { container } = render(wrap(<ContextRing used={0} size={100} />))
    expect(container.querySelector('[data-testid="context-ring"]')).toBeInTheDocument()
  })

  it('handles zero size', () => {
    const { container } = render(wrap(<ContextRing used={0} size={0} />))
    expect(container.textContent).toContain('0')
  })
})
