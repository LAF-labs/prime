import { describe, it, expect } from 'vitest'
import { stripImageDataForTitleGen } from './message-utils'

describe('stripImageDataForTitleGen', () => {
  it('preserves plain text messages unchanged', () => {
    const input = 'Fix the login bug'
    expect(stripImageDataForTitleGen(input)).toBe('Fix the login bug')
  })

  it('strips image tag but keeps attached image annotation', () => {
    const input = 'Fix the login bug\n[Attached image: screenshot.png (image/png, 5000 bytes)]\n<image src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg..." />'
    const actual = stripImageDataForTitleGen(input)
    expect(actual).toContain('Fix the login bug')
    expect(actual).toContain('[Attached image: screenshot.png')
    expect(actual).not.toContain('data:image')
    expect(actual).not.toContain('base64')
  })

  it('strips multiple image tags', () => {
    const input = 'Compare these\n<image src="data:image/png;base64,abc123" />\n<image src="data:image/jpeg;base64,def456" />'
    const actual = stripImageDataForTitleGen(input)
    expect(actual).toBe('Compare these')
  })

  it('returns fallback when message is only an image', () => {
    const input = '<image src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg..." />'
    expect(stripImageDataForTitleGen(input)).toBe('[Image attachment]')
  })

  it('returns fallback when message is annotation + image with no text', () => {
    const input = '[Attached image: photo.png (image/png, 1234 bytes)]\n<image src="data:image/png;base64,abc" />'
    const actual = stripImageDataForTitleGen(input)
    expect(actual).toContain('[Attached image:')
    expect(actual).not.toContain('data:image')
  })

  it('handles inline image replacement format', () => {
    const input = 'Here is the error <image src="data:image/png;base64,longdata" /> can you fix it?'
    const actual = stripImageDataForTitleGen(input)
    expect(actual).toBe('Here is the error  can you fix it?')
  })
})
