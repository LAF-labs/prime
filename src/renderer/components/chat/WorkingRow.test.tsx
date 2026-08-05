import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { WorkingRow } from './WorkingRow'
import type { WorkingRow as WorkingRowData } from '@/lib/timeline'

const baseRow: WorkingRowData = { kind: 'working', id: 'working' }

describe('WorkingRow', () => {
  it('renders with working data attribute', () => {
    const { container } = render(<WorkingRow row={baseRow} />)
    expect(container.querySelector('[data-timeline-row-kind="working"]')).toBeInTheDocument()
  })

  it('shows a loading word when not streaming', () => {
    const { container } = render(<WorkingRow row={baseRow} />)
    expect(container.textContent).toMatch(/\w+/)
  })

  it('shows a dot indicator when streaming content exists', () => {
    const row: WorkingRowData = { ...baseRow, hasStreamingContent: true }
    const { container } = render(<WorkingRow row={row} />)
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
  })
})
