import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { createRef } from 'react'
import { Input } from './input'

describe('Input', () => {
  it('has data-slot input', () => {
    const { container } = render(<Input />)
    expect(container.querySelector('[data-slot="input"]')).toBeInTheDocument()
  })
  it('forwards ref', () => {
    const ref = createRef<HTMLInputElement>()
    render(<Input ref={ref} />)
    expect(ref.current).toBeInstanceOf(HTMLInputElement)
  })
  it('passes type prop', () => {
    const { container } = render(<Input type="password" />)
    expect(container.querySelector('input')).toHaveAttribute('type', 'password')
  })
  it('applies className to wrapper', () => {
    const { container } = render(<Input className="custom" />)
    expect(container.querySelector('[data-slot="input-control"]')).toHaveClass('custom')
  })
})
