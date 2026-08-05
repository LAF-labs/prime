import { describe, expect, it } from 'vitest'
import { DIFF_THEME_NAMES, fnv1a32, resolveDiffThemeName } from './diffRendering'

describe('resolveDiffThemeName', () => {
  it('maps dark to pierre-dark', () => {
    expect(resolveDiffThemeName('dark')).toBe(DIFF_THEME_NAMES.dark)
  })
  it('maps light to pierre-light', () => {
    expect(resolveDiffThemeName('light')).toBe(DIFF_THEME_NAMES.light)
  })
})

describe('fnv1a32', () => {
  it('returns a non-negative 32-bit integer', () => {
    const h = fnv1a32('hello world')
    expect(Number.isInteger(h)).toBe(true)
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThanOrEqual(0xffffffff)
  })

  it('is deterministic', () => {
    expect(fnv1a32('abc')).toBe(fnv1a32('abc'))
  })

  it('differs across different inputs', () => {
    expect(fnv1a32('abc')).not.toBe(fnv1a32('abd'))
  })

  it('handles empty string', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5)
  })
})
