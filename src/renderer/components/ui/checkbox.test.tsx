import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Checkbox } from './checkbox'

describe('Checkbox', () => {
  it('has data-slot checkbox', () => {
    const { container } = render(<Checkbox />)
    expect(container.querySelector('[data-slot="checkbox"]')).toBeInTheDocument()
  })
  it('applies className', () => {
    const { container } = render(<Checkbox className="custom" />)
    expect(container.querySelector('[data-slot="checkbox"]')).toHaveClass('custom')
  })
  it('renders unchecked by default', () => {
    const { container } = render(<Checkbox />)
    expect(container.querySelector('[data-state="unchecked"]')).toBeInTheDocument()
  })
  it('renders checked when defaultChecked', () => {
    const { container } = render(<Checkbox defaultChecked />)
    expect(container.querySelector('[data-state="checked"]')).toBeInTheDocument()
  })
})
