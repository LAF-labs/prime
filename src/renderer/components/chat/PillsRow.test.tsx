import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { PillsRow, PILLS_COLLAPSE_THRESHOLD } from './ChatInput'
import type { PastedChunk } from '@/hooks/useChatInput'
import type { Attachment, ProjectFile } from '@/types'

// Mock child components to isolate PillsRow logic
vi.mock('./FileMentionPicker', () => ({
  FileMentionPill: ({ path }: { path: string }) => <span data-testid={`mention-${path}`}>{path}</span>,
}))
vi.mock('./AttachmentPreview', () => ({
  AttachmentPreview: ({ attachments }: { attachments: readonly Attachment[] }) => (
    <span data-testid="attachment-preview">{attachments.length} attachments</span>
  ),
}))

const makeMention = (path: string): ProjectFile => ({
  path, name: path.split('/').pop()!, dir: '', isDir: false, ext: '.ts', modifiedAt: 0,
})

const makeChunk = (id: number): PastedChunk => ({
  id, text: `text-${id}`, lines: 3, chars: 50,
})

const makeAttachment = (id: string): Attachment => ({
  id, name: `file-${id}.txt`, path: `/tmp/file-${id}.txt`, type: 'text', size: 100, mimeType: 'text/plain',
})

const noop = () => {}

describe('PillsRow', () => {
  it('shows all pills when count is at or below threshold', () => {
    const mentions = [makeMention('src/a.ts'), makeMention('src/b.ts')]
    render(
      <PillsRow
        mentionedFiles={mentions}
        nonImageAttachments={[]}
        pastedChunks={[]}
        onRemoveMention={noop}
        onRemoveAttachment={noop}
        onRemoveFolder={noop}
        onRemoveChunk={noop}
        folderPaths={[]}
      />,
    )
    expect(screen.getByTestId('mention-src/a.ts')).toBeInTheDocument()
    expect(screen.getByTestId('mention-src/b.ts')).toBeInTheDocument()
    expect(screen.queryByTestId('pills-expand-button')).toBeNull()
  })

  it('collapses when total count exceeds threshold', () => {
    const mentions = Array.from({ length: 3 }, (_, i) => makeMention(`src/${i}.ts`))
    const chunks = [makeChunk(1), makeChunk(2)]
    // 3 mentions + 2 chunks = 5 > PILLS_COLLAPSE_THRESHOLD (4)
    render(
      <PillsRow
        mentionedFiles={mentions}
        nonImageAttachments={[]}
        pastedChunks={chunks}
        onRemoveMention={noop}
        onRemoveAttachment={noop}
        onRemoveFolder={noop}
        onRemoveChunk={noop}
        folderPaths={[]}
      />,
    )
    expect(screen.getByTestId('pills-expand-button')).toBeInTheDocument()
    expect(screen.getByText('3 files, 2 pasted')).toBeInTheDocument()
    // Individual pills should not be visible
    expect(screen.queryByTestId('mention-src/0.ts')).toBeNull()
  })

  it('expands when clicking the expand button', () => {
    const mentions = Array.from({ length: 5 }, (_, i) => makeMention(`src/${i}.ts`))
    render(
      <PillsRow
        mentionedFiles={mentions}
        nonImageAttachments={[]}
        pastedChunks={[]}
        onRemoveMention={noop}
        onRemoveAttachment={noop}
        onRemoveFolder={noop}
        onRemoveChunk={noop}
        folderPaths={[]}
      />,
    )
    // Initially collapsed
    expect(screen.getByTestId('pills-expand-button')).toBeInTheDocument()
    // Click to expand
    fireEvent.click(screen.getByTestId('pills-expand-button'))
    // Now all pills should be visible
    expect(screen.getByTestId('mention-src/0.ts')).toBeInTheDocument()
    expect(screen.getByTestId('mention-src/4.ts')).toBeInTheDocument()
    // Collapse button should appear
    expect(screen.getByTestId('pills-collapse-button')).toBeInTheDocument()
  })

  it('collapses back when clicking the Less button', () => {
    const mentions = Array.from({ length: 5 }, (_, i) => makeMention(`src/${i}.ts`))
    render(
      <PillsRow
        mentionedFiles={mentions}
        nonImageAttachments={[]}
        pastedChunks={[]}
        onRemoveMention={noop}
        onRemoveAttachment={noop}
        onRemoveFolder={noop}
        onRemoveChunk={noop}
        folderPaths={[]}
      />,
    )
    // Expand
    fireEvent.click(screen.getByTestId('pills-expand-button'))
    expect(screen.getByTestId('mention-src/0.ts')).toBeInTheDocument()
    // Collapse
    fireEvent.click(screen.getByTestId('pills-collapse-button'))
    expect(screen.queryByTestId('mention-src/0.ts')).toBeNull()
    expect(screen.getByTestId('pills-expand-button')).toBeInTheDocument()
  })

  it('shows correct summary with mixed types', () => {
    const mentions = [makeMention('src/a.ts')]
    const attachments = [makeAttachment('a1'), makeAttachment('a2'), makeAttachment('a3')]
    const chunks = [makeChunk(1)]
    // 1 + 3 + 1 = 5 > threshold
    render(
      <PillsRow
        mentionedFiles={mentions}
        nonImageAttachments={attachments}
        pastedChunks={chunks}
        onRemoveMention={noop}
        onRemoveAttachment={noop}
        onRemoveFolder={noop}
        onRemoveChunk={noop}
        folderPaths={[]}
      />,
    )
    expect(screen.getByText('1 file, 3 attachments, 1 pasted')).toBeInTheDocument()
  })

  it('shows exactly threshold count without collapsing', () => {
    const mentions = Array.from({ length: PILLS_COLLAPSE_THRESHOLD }, (_, i) => makeMention(`src/${i}.ts`))
    render(
      <PillsRow
        mentionedFiles={mentions}
        nonImageAttachments={[]}
        pastedChunks={[]}
        onRemoveMention={noop}
        onRemoveAttachment={noop}
        onRemoveFolder={noop}
        onRemoveChunk={noop}
        folderPaths={[]}
      />,
    )
    // Should show all pills, no collapse button
    expect(screen.queryByTestId('pills-expand-button')).toBeNull()
    for (let i = 0; i < PILLS_COLLAPSE_THRESHOLD; i++) {
      expect(screen.getByTestId(`mention-src/${i}.ts`)).toBeInTheDocument()
    }
  })
})
