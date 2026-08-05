import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Alert, AlertTitle, AlertDescription } from './alert'

describe('Alert', () => {
  it('renders with role alert', () => {
    render(<Alert>msg</Alert>)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('has data-slot alert', () => {
    render(<Alert>msg</Alert>)
    expect(screen.getByRole('alert')).toHaveAttribute('data-slot', 'alert')
  })

  it.each(['error', 'info', 'success', 'warning', 'destructive'] as const)(
    'renders variant %s',
    (variant) => {
      render(<Alert variant={variant}>msg</Alert>)
      expect(screen.getByRole('alert')).toBeInTheDocument()
    },
  )

  it('applies custom className', () => {
    render(<Alert className="custom">msg</Alert>)
    expect(screen.getByRole('alert')).toHaveClass('custom')
  })
})

describe('AlertTitle', () => {
  it('has data-slot alert-title', () => {
    const { container } = render(<AlertTitle>Title</AlertTitle>)
    expect(container.querySelector('[data-slot="alert-title"]')).toBeInTheDocument()
  })
})

describe('AlertDescription', () => {
  it('has data-slot alert-description', () => {
    const { container } = render(<AlertDescription>Desc</AlertDescription>)
    expect(container.querySelector('[data-slot="alert-description"]')).toBeInTheDocument()
  })
})
