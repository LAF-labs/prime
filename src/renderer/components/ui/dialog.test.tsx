import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from './dialog'

describe('Dialog', () => {
  it('renders trigger', () => {
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
      </Dialog>,
    )
    expect(screen.getByText('Open')).toBeInTheDocument()
  })

  it('renders content when open', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Title</DialogTitle>
            <DialogDescription>Desc</DialogDescription>
          </DialogHeader>
          <div>Body</div>
          <DialogFooter>Footer</DialogFooter>
        </DialogContent>
      </Dialog>,
    )
    expect(screen.getByText('Title')).toBeInTheDocument()
    expect(screen.getByText('Desc')).toBeInTheDocument()
    expect(screen.getByText('Body')).toBeInTheDocument()
    expect(screen.getByText('Footer')).toBeInTheDocument()
  })

  it('DialogHeader has data-slot', () => {
    const { container } = render(<DialogHeader>H</DialogHeader>)
    expect(container.querySelector('[data-slot="dialog-header"]')).toBeInTheDocument()
  })

  it('DialogFooter has data-slot', () => {
    const { container } = render(<DialogFooter>F</DialogFooter>)
    expect(container.querySelector('[data-slot="dialog-footer"]')).toBeInTheDocument()
  })
})
