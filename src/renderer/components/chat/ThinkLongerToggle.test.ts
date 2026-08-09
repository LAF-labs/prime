import { describe, it, expect } from 'vitest'
import { isThinkLongerOn, resolveToggleLevel } from './ThinkLongerToggle'

describe('isThinkLongerOn', () => {
  it('reads medium and below as off', () => {
    expect(isThinkLongerOn('off')).toBe(false)
    expect(isThinkLongerOn('minimal')).toBe(false)
    expect(isThinkLongerOn('low')).toBe(false)
    expect(isThinkLongerOn('medium')).toBe(false)
  })

  it('reads anything above medium as on', () => {
    expect(isThinkLongerOn('high')).toBe(true)
    expect(isThinkLongerOn('xhigh')).toBe(true)
    expect(isThinkLongerOn('max')).toBe(true)
  })
})

describe('resolveToggleLevel', () => {
  const FULL = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

  it('maps the two positions to medium and high', () => {
    expect(resolveToggleLevel(FULL, false)).toBe('medium')
    expect(resolveToggleLevel(FULL, true)).toBe('high')
  })

  it('falls back to the nearest level a model actually accepts', () => {
    expect(resolveToggleLevel(['off', 'low', 'xhigh'], false)).toBe('low')
    expect(resolveToggleLevel(['off', 'low', 'xhigh'], true)).toBe('xhigh')
  })

  it('clamps to the closest end when nothing sits on that side', () => {
    expect(resolveToggleLevel(['xhigh', 'max'], false)).toBe('xhigh')
    expect(resolveToggleLevel(['off', 'low'], true)).toBe('low')
  })
})
