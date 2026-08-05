import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Switch } from './switch'

describe('Switch', () => {
  it('has data-slot switch', () => {
    const { container } = render(<Switch />)
    expect(container.querySelector('[data-slot="switch"]')).toBeInTheDocument()
  })
  it('has thumb', () => {
    const { container } = render(<Switch />)
    expect(container.querySelector('[data-slot="switch-thumb"]')).toBeInTheDocument()
  })
  it('applies className', () => {
    const { container } = render(<Switch className="custom" />)
    expect(container.querySelector('[data-slot="switch"]')).toHaveClass('custom')
  })
  it('renders unchecked by default', () => {
    const { container } = render(<Switch />)
    expect(container.querySelector('[data-state="unchecked"]')).toBeInTheDocument()
  })
  it('renders checked when defaultChecked', () => {
    const { container } = render(<Switch defaultChecked />)
    expect(container.querySelector('[data-state="checked"]')).toBeInTheDocument()
  })
})
