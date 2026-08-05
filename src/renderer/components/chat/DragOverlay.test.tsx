import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { DragOverlay } from './DragOverlay'

describe('DragOverlay', () => {
  it('renders drop text when visible', () => {
    render(<DragOverlay visible />)
    expect(screen.getByText('Drop files here')).toBeInTheDocument()
  })

  it('renders file type hint when visible', () => {
    render(<DragOverlay visible />)
    expect(screen.getByText('Images, code, documents')).toBeInTheDocument()
  })

  it('is visible with full opacity when visible=true', () => {
    const { container } = render(<DragOverlay visible />)
    const overlay = container.firstElementChild as HTMLElement
    expect(overlay.className).toContain('opacity-100')
    expect(overlay.className).not.toContain('pointer-events-none')
  })

  it('is hidden with zero opacity when visible=false', () => {
    const { container } = render(<DragOverlay visible={false} />)
    const overlay = container.firstElementChild as HTMLElement
    expect(overlay.className).toContain('opacity-0')
    expect(overlay.className).toContain('pointer-events-none')
  })

  it('sets aria-hidden=true when not visible', () => {
    const { container } = render(<DragOverlay visible={false} />)
    const overlay = container.firstElementChild as HTMLElement
    expect(overlay.getAttribute('aria-hidden')).toBe('true')
  })

  it('sets aria-hidden=false when visible', () => {
    const { container } = render(<DragOverlay visible />)
    const overlay = container.firstElementChild as HTMLElement
    expect(overlay.getAttribute('aria-hidden')).toBe('false')
  })
})
