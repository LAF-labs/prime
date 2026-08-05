import { describe, it, expect } from 'vitest'
import { cn, joinChunk, slugify, isValidWorktreeSlug } from './utils'

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('handles conditional classes', () => {
    expect(cn('foo', false && 'bar', 'baz')).toBe('foo baz')
  })

  it('merges tailwind conflicts', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })

  it('handles undefined and null', () => {
    expect(cn('foo', undefined, null, 'bar')).toBe('foo bar')
  })

  it('returns empty string for no args', () => {
    expect(cn()).toBe('')
  })
})

describe('joinChunk', () => {
  it('inserts space after period when next chunk starts with non-whitespace', () => {
    expect(joinChunk('first.', 'Let me')).toBe('first. Let me')
  })

  it('inserts space after exclamation mark', () => {
    expect(joinChunk('Done!', 'Now')).toBe('Done! Now')
  })

  it('inserts space after question mark', () => {
    expect(joinChunk('Ready?', 'Yes')).toBe('Ready? Yes')
  })

  it('inserts space after colon', () => {
    expect(joinChunk('files:', 'src/main.ts')).toBe('files: src/main.ts')
  })

  it('does not double-space when chunk already starts with space', () => {
    expect(joinChunk('first.', ' Let me')).toBe('first. Let me')
  })

  it('does not insert space for normal token streaming', () => {
    expect(joinChunk('Hel', 'lo world')).toBe('Hello world')
  })

  it('handles empty accumulated text', () => {
    expect(joinChunk('', 'Hello')).toBe('Hello')
  })

  it('handles empty chunk', () => {
    expect(joinChunk('Hello.', '')).toBe('Hello.')
  })

  it('handles both empty', () => {
    expect(joinChunk('', '')).toBe('')
  })

  it('does not insert space after period followed by newline', () => {
    expect(joinChunk('first.', '\nSecond')).toBe('first.\nSecond')
  })

  it('reproduces the original bug scenario', () => {
    let text = ''
    text = joinChunk(text, 'Let me understand the codebase structure first.')
    text = joinChunk(text, 'Let me look at the relevant source files.')
    text = joinChunk(text, 'Now let me check the settings.')
    expect(text).toBe(
      'Let me understand the codebase structure first. Let me look at the relevant source files. Now let me check the settings.'
    )
  })
})

describe('slugify', () => {
  it('converts spaces to dashes', () => {
    expect(slugify('my feature branch')).toBe('my-feature-branch')
  })

  it('lowercases input', () => {
    expect(slugify('My-Feature')).toBe('my-feature')
  })

  it('replaces special characters', () => {
    expect(slugify('fix: bug #123')).toBe('fix-bug-123')
  })

  it('trims leading and trailing dashes', () => {
    expect(slugify('  hello world  ')).toBe('hello-world')
  })

  it('collapses multiple dashes', () => {
    expect(slugify('foo---bar')).toBe('foo-bar')
  })

  it('truncates to 30 characters', () => {
    const long = 'a'.repeat(100)
    expect(slugify(long).length).toBe(30)
  })

  it('preserves dots and underscores', () => {
    expect(slugify('v1.0_release')).toBe('v1.0_release')
  })

  it('handles unicode by transliterating', () => {
    expect(slugify('café-résumé')).toBe('cafe-resume')
  })

  it('returns empty for empty input', () => {
    expect(slugify('')).toBe('')
  })

  it('strips trailing dots', () => {
    expect(slugify('updating-claude.')).toBe('updating-claude')
  })

  it('strips leading dots', () => {
    expect(slugify('.hidden-file')).toBe('hidden-file')
  })

  it('strips trailing dot after truncation', () => {
    const input = 'a'.repeat(29) + '.'
    expect(slugify(input).endsWith('.')).toBe(false)
  })

  it('handles input that becomes only dots and dashes', () => {
    expect(slugify('...')).toBe('')
  })
})

describe('isValidWorktreeSlug', () => {
  it('accepts valid slugs', () => {
    expect(isValidWorktreeSlug('my-feature')).toBe(true)
    expect(isValidWorktreeSlug('fix_123')).toBe(true)
    expect(isValidWorktreeSlug('v1.0.0')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(isValidWorktreeSlug('')).toBe(false)
  })

  it('rejects strings over 30 chars', () => {
    expect(isValidWorktreeSlug('a'.repeat(31))).toBe(false)
  })

  it('rejects double dots', () => {
    expect(isValidWorktreeSlug('foo..bar')).toBe(false)
  })

  it('rejects special characters', () => {
    expect(isValidWorktreeSlug('foo/bar')).toBe(false)
    expect(isValidWorktreeSlug('foo bar')).toBe(false)
    expect(isValidWorktreeSlug('foo@bar')).toBe(false)
  })

  it('rejects slugs ending with dot', () => {
    expect(isValidWorktreeSlug('claude.')).toBe(false)
  })

  it('rejects slugs starting with dot', () => {
    expect(isValidWorktreeSlug('.hidden')).toBe(false)
  })
})