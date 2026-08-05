import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { createRef } from 'react'
import { Button } from './button'

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click</Button>)
    expect(screen.getByRole('button', { name: 'Click' })).toBeInTheDocument()
  })

  it('applies custom className', () => {
    render(<Button className="custom">Click</Button>)
    expect(screen.getByRole('button')).toHaveClass('custom')
  })

  it('renders as child element when asChild', () => {
    render(<Button asChild><a href="/test">Link</a></Button>)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/test')
  })

  it('renders disabled state', () => {
    render(<Button disabled>Click</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it.each(['destructive', 'outline', 'secondary', 'ghost', 'link'] as const)(
    'renders variant %s',
    (variant) => {
      render(<Button variant={variant}>{variant}</Button>)
      expect(screen.getByRole('button')).toBeInTheDocument()
    },
  )

  it.each(['sm', 'lg', 'icon'] as const)('renders size %s', (size) => {
    render(<Button size={size}>btn</Button>)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('forwards ref', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<Button ref={ref}>Click</Button>)
    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
  })
})
