import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Badge } from './badge'

describe('Badge', () => {
  it('renders children', () => {
    render(<Badge>Label</Badge>)
    expect(screen.getByText('Label')).toBeInTheDocument()
  })

  it.each(['destructive', 'outline', 'secondary', 'success', 'warning', 'error', 'info'] as const)(
    'renders variant %s',
    (variant) => {
      render(<Badge variant={variant}>{variant}</Badge>)
      expect(screen.getByText(variant)).toBeInTheDocument()
    },
  )

  it.each(['sm', 'lg'] as const)('renders size %s', (size) => {
    render(<Badge size={size}>sized</Badge>)
    expect(screen.getByText('sized')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    render(<Badge className="custom">b</Badge>)
    expect(screen.getByText('b')).toHaveClass('custom')
  })
})
