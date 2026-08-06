import { describe, it, expect, vi } from 'vitest'
import { captureDraft, restoreDraft, type DraftMaps, type DraftSetters } from './draft-recovery'
import type { Attachment, ProjectFile } from '@/types'
import type { PastedChunk } from '@/hooks/useChatInput'

const attachment = (name: string) => ({ id: name, name, mimeType: 'image/png', base64: 'x' }) as unknown as Attachment
const chunk = (text: string) => ({ id: text, text }) as unknown as PastedChunk
const file = (path: string) => ({ path, name: path }) as unknown as ProjectFile

const maps = (over: Partial<DraftMaps> = {}): DraftMaps => ({
  drafts: {},
  draftAttachments: {},
  draftPastedChunks: {},
  draftMentionedFiles: {},
  ...over,
})

const setters = (): DraftSetters & { calls: () => Record<string, number> } => {
  const s = {
    setDraft: vi.fn(),
    setDraftAttachments: vi.fn(),
    setDraftPastedChunks: vi.fn(),
    setDraftMentionedFiles: vi.fn(),
  }
  return { ...s, calls: () => ({}) } as DraftSetters & { calls: () => Record<string, number> }
}

describe('captureDraft', () => {
  it('takes everything the composer is holding', () => {
    const saved = captureDraft(
      maps({
        drafts: { '/ws': 'a long prompt' },
        draftAttachments: { '/ws': [attachment('shot.png')] },
        draftPastedChunks: { '/ws': [chunk('pasted log')] },
        draftMentionedFiles: { '/ws': [file('src/main.rs')] },
      }),
      '/ws',
    )
    expect(saved.text).toBe('a long prompt')
    expect(saved.attachments).toHaveLength(1)
    expect(saved.chunks).toHaveLength(1)
    expect(saved.files).toHaveLength(1)
  })

  it('is empty for a workspace with no draft', () => {
    const saved = captureDraft(maps(), '/ws')
    expect(saved).toEqual({ text: '', attachments: [], chunks: [], files: [] })
  })

  it('does not pick up another workspace’s draft', () => {
    const saved = captureDraft(maps({ drafts: { '/other': 'not mine' } }), '/ws')
    expect(saved.text).toBe('')
  })
})

describe('restoreDraft', () => {
  it('puts the whole draft back after a failed send', () => {
    const s = setters()
    restoreDraft(s, '/ws', {
      text: 'a long prompt',
      attachments: [attachment('shot.png')],
      chunks: [chunk('pasted log')],
      files: [file('src/main.rs')],
    })
    expect(s.setDraft).toHaveBeenCalledWith('/ws', 'a long prompt')
    expect(s.setDraftAttachments).toHaveBeenCalledWith('/ws', [attachment('shot.png')])
    expect(s.setDraftPastedChunks).toHaveBeenCalledWith('/ws', [chunk('pasted log')])
    expect(s.setDraftMentionedFiles).toHaveBeenCalledWith('/ws', [file('src/main.rs')])
  })

  it('writes nothing when there was nothing to save', () => {
    // Otherwise a failed send would blank out whatever the user has since
    // started typing.
    const s = setters()
    restoreDraft(s, '/ws', { text: '', attachments: [], chunks: [], files: [] })
    expect(s.setDraft).not.toHaveBeenCalled()
    expect(s.setDraftAttachments).not.toHaveBeenCalled()
    expect(s.setDraftPastedChunks).not.toHaveBeenCalled()
    expect(s.setDraftMentionedFiles).not.toHaveBeenCalled()
  })

  it('restores text even when there were no attachments', () => {
    const s = setters()
    restoreDraft(s, '/ws', { text: 'just words', attachments: [], chunks: [], files: [] })
    expect(s.setDraft).toHaveBeenCalledWith('/ws', 'just words')
    expect(s.setDraftAttachments).not.toHaveBeenCalled()
  })

  it('round-trips a capture', () => {
    const original = maps({
      drafts: { '/ws': '보고서 초안을 써줘' },
      draftAttachments: { '/ws': [attachment('표.png')] },
    })
    const saved = captureDraft(original, '/ws')
    const s = setters()
    restoreDraft(s, '/ws', saved)
    expect(s.setDraft).toHaveBeenCalledWith('/ws', '보고서 초안을 써줘')
    expect(s.setDraftAttachments).toHaveBeenCalledWith('/ws', [attachment('표.png')])
  })
})
