import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGenerate } = vi.hoisted(() => ({
  mockGenerate: vi.fn(),
}))

vi.mock('@/lib/ipc', () => ({
  ipc: { gitGenerateCommitMessage: mockGenerate },
}))

import { generateAiCommitMessage } from './git-commit-message'

describe('generateAiCommitMessage', () => {
  beforeEach(() => {
    mockGenerate.mockReset()
  })

  it('joins subject and body with a blank line', async () => {
    mockGenerate.mockResolvedValue({ subject: 'feat: add thing', body: 'Because reasons.' })
    await expect(generateAiCommitMessage('/ws')).resolves.toBe('feat: add thing\n\nBecause reasons.')
    expect(mockGenerate).toHaveBeenCalledWith('/ws')
  })

  it('returns the subject alone when the body is blank', async () => {
    mockGenerate.mockResolvedValue({ subject: 'fix: tidy', body: '  \n ' })
    await expect(generateAiCommitMessage('/ws')).resolves.toBe('fix: tidy')
  })

  it('propagates generator failures to the caller', async () => {
    mockGenerate.mockRejectedValue(new Error('no diff'))
    await expect(generateAiCommitMessage('/ws')).rejects.toThrow('no diff')
  })
})
