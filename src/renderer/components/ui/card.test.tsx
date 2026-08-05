import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './card'

describe('Card', () => {
  it('has data-slot card', () => {
    const { container } = render(<Card />)
    expect(container.querySelector('[data-slot="card"]')).toBeInTheDocument()
  })
  it('applies className', () => {
    const { container } = render(<Card className="custom" />)
    expect(container.querySelector('[data-slot="card"]')).toHaveClass('custom')
  })
})

describe('CardHeader', () => {
  it('has data-slot card-header', () => {
    const { container } = render(<CardHeader />)
    expect(container.querySelector('[data-slot="card-header"]')).toBeInTheDocument()
  })
})

describe('CardTitle', () => {
  it('has data-slot card-title', () => {
    const { container } = render(<CardTitle>Title</CardTitle>)
    expect(container.querySelector('[data-slot="card-title"]')).toBeInTheDocument()
  })
})

describe('CardDescription', () => {
  it('has data-slot card-description', () => {
    const { container } = render(<CardDescription>Desc</CardDescription>)
    expect(container.querySelector('[data-slot="card-description"]')).toBeInTheDocument()
  })
})

describe('CardContent', () => {
  it('has data-slot card-content', () => {
    const { container } = render(<CardContent>Body</CardContent>)
    expect(container.querySelector('[data-slot="card-content"]')).toBeInTheDocument()
  })
})

describe('CardFooter', () => {
  it('has data-slot card-footer', () => {
    const { container } = render(<CardFooter>Footer</CardFooter>)
    expect(container.querySelector('[data-slot="card-footer"]')).toBeInTheDocument()
  })
})
