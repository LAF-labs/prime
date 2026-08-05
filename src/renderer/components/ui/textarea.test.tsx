import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { createRef } from 'react'
import { Textarea } from './textarea'

describe('Textarea', () => {
  it('has data-slot textarea', () => {
    const { container } = render(<Textarea />)
    expect(container.querySelector('[data-slot="textarea"]')).toBeInTheDocument()
  })
  it('forwards ref', () => {
    const ref = createRef<HTMLTextAreaElement>()
    render(<Textarea ref={ref} />)
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement)
  })
  it('applies className to wrapper', () => {
    const { container } = render(<Textarea className="custom" />)
    expect(container.querySelector('[data-slot="textarea-control"]')).toHaveClass('custom')
  })
})
