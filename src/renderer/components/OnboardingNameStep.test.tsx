import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { OnboardingNameStep, MAX_DISPLAY_NAME } from './OnboardingNameStep'

const setup = (name = '') => {
  const onNameChange = vi.fn()
  const onNext = vi.fn()
  render(<OnboardingNameStep name={name} onNameChange={onNameChange} onNext={onNext} />)
  return { onNameChange, onNext, input: screen.getByLabelText('Your name') as HTMLInputElement }
}

describe('OnboardingNameStep', () => {
  it('reports what the user types', () => {
    const { onNameChange, input } = setup()
    fireEvent.change(input, { target: { value: '김기범' } })
    expect(onNameChange).toHaveBeenCalledWith('김기범')
  })

  it('advances to the theme step on Continue', () => {
    const { onNext } = setup('김기범')
    fireEvent.click(screen.getByText('Continue'))
    expect(onNext).toHaveBeenCalledWith('theme')
  })

  it('advances on Enter, so the field can be filled without reaching for the mouse', () => {
    const { onNext, input } = setup('김기범')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onNext).toHaveBeenCalledWith('theme')
  })

  /**
   * Naming yourself is optional: a wizard that will not advance until a field
   * is filled traps a user who does not want to be named at all.
   */
  it('offers a skip while the field is empty', () => {
    const { onNext } = setup('')
    fireEvent.click(screen.getByText('Skip for now'))
    expect(onNext).toHaveBeenCalledWith('theme')
  })

  it('hides the skip once a name is entered, leaving one obvious action', () => {
    setup('김기범')
    expect(screen.queryByText('Skip for now')).toBeNull()
  })

  it('treats whitespace as empty, so spaces do not count as a name', () => {
    setup('   ')
    expect(screen.getByText('Skip for now')).toBeInTheDocument()
  })

  it('caps the name at a length the sidebar row can show', () => {
    const { input } = setup()
    expect(input.maxLength).toBe(MAX_DISPLAY_NAME)
  })
})
