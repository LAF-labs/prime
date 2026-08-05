import { describe, it, expect } from 'vitest'
import { parseFileNames, generateCommitMessage, countDiffStats } from './commit-message-utils'

const makeDiffLine = (filePath: string): string =>
  `diff --git a/${filePath} b/${filePath}`

const makeDiff = (files: string[], additions = 1, deletions = 1): string => {
  const lines: string[] = []
  for (const file of files) {
    lines.push(makeDiffLine(file))
    lines.push(`--- a/${file}`)
    lines.push(`+++ b/${file}`)
    for (let i = 0; i < additions; i++) lines.push('+added line')
    for (let i = 0; i < deletions; i++) lines.push('-removed line')
  }
  return lines.join('\n')
}

describe('parseFileNames', () => {
  it('returns empty array for empty string', () => {
    expect(parseFileNames('')).toEqual([])
  })

  it('parses a single file', () => {
    const inputDiff = makeDiffLine('src/app.ts')
    expect(parseFileNames(inputDiff)).toEqual(['src/app.ts'])
  })

  it('parses multiple files', () => {
    const inputDiff = [
      makeDiffLine('src/app.ts'),
      makeDiffLine('src/utils.ts'),
      makeDiffLine('README.md'),
    ].join('\n')
    expect(parseFileNames(inputDiff)).toEqual(['src/app.ts', 'src/utils.ts', 'README.md'])
  })

  it('ignores non-diff lines', () => {
    const inputDiff = [
      '+added line',
      '-removed line',
      'context line',
      makeDiffLine('src/index.ts'),
    ].join('\n')
    expect(parseFileNames(inputDiff)).toEqual(['src/index.ts'])
  })
})

describe('generateCommitMessage', () => {
  it('returns empty string for empty diff', () => {
    expect(generateCommitMessage('')).toBe('')
  })

  it('returns empty string for diff with no files', () => {
    expect(generateCommitMessage('+some line\n-another')).toBe('')
  })

  it('generates message with file names for a single file', () => {
    const inputDiff = makeDiff(['src/app.ts'], 3, 2)
    const actualMessage = generateCommitMessage(inputDiff)
    expect(actualMessage).toBe('chore: update app.ts (+3 -2)')
  })

  it('generates message listing multiple short file names', () => {
    const inputDiff = makeDiff(['src/a.ts', 'src/b.ts'], 1, 1)
    const actualMessage = generateCommitMessage(inputDiff)
    expect(actualMessage).toBe('chore: update a.ts, b.ts (+2 -2)')
  })

  it('falls back to file count when names exceed 100 chars', () => {
    const inputFiles = Array.from({ length: 10 }, (_, i) =>
      `src/components/very-long-directory-name/file-${i}.tsx`
    )
    const inputDiff = makeDiff(inputFiles, 2, 1)
    const actualMessage = generateCommitMessage(inputDiff)
    expect(actualMessage).toContain('chore: update 10 files')
    expect(actualMessage).toContain('(+20 -10)')
    expect(actualMessage.length).toBeLessThanOrEqual(100)
  })

  it('counts additions and deletions correctly', () => {
    const inputDiff = makeDiff(['config.json'], 5, 0)
    const actualMessage = generateCommitMessage(inputDiff)
    expect(actualMessage).toBe('chore: update config.json (+5 -0)')
  })

  it('uses short file names (basename only)', () => {
    const inputDiff = makeDiff(['src/deeply/nested/module.ts'], 1, 1)
    const actualMessage = generateCommitMessage(inputDiff)
    expect(actualMessage).toContain('module.ts')
    expect(actualMessage).not.toContain('src/deeply/nested/')
  })

  it('never exceeds 100 characters', () => {
    const inputFiles = Array.from({ length: 25 }, (_, i) => `file-${i}.ts`)
    const inputDiff = makeDiff(inputFiles, 10, 10)
    const actualMessage = generateCommitMessage(inputDiff)
    expect(actualMessage.length).toBeLessThanOrEqual(100)
  })
})

describe('countDiffStats', () => {
  it('returns zero for empty diff', () => {
    expect(countDiffStats('')).toEqual({ additions: 0, deletions: 0 })
  })

  it('counts additions and deletions correctly', () => {
    const inputDiff = makeDiff(['file.ts'], 3, 2)
    expect(countDiffStats(inputDiff)).toEqual({ additions: 3, deletions: 2 })
  })

  it('ignores +++ and --- header lines', () => {
    const inputDiff = '--- a/file.ts\n+++ b/file.ts\n+added\n-removed'
    expect(countDiffStats(inputDiff)).toEqual({ additions: 1, deletions: 1 })
  })
})
