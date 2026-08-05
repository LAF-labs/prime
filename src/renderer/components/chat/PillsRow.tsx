import { memo, useCallback, useState } from 'react'
import { IconPaperclip, IconClipboard, IconChevronDown, IconFolder } from '@tabler/icons-react'
import { FileMentionPill } from './FileMentionPicker'
import { AttachmentPreview } from './AttachmentPreview'
import type { PastedChunk } from '@/hooks/useChatInput'
import type { Attachment, ProjectFile } from '@/types'

/** Max pills before collapsing into a summary */
export const PILLS_COLLAPSE_THRESHOLD = 4

interface PillsRowProps {
  mentionedFiles: readonly ProjectFile[]
  nonImageAttachments: readonly Attachment[]
  pastedChunks: readonly PastedChunk[]
  folderPaths: readonly string[]
  onRemoveMention: (path: string) => void
  onRemoveAttachment: (id: string) => void
  onRemoveFolder: (path: string) => void
  onRemoveChunk: (id: number) => void
}

export const PillsRow = memo(function PillsRow({ mentionedFiles, nonImageAttachments, pastedChunks, folderPaths, onRemoveMention, onRemoveAttachment, onRemoveFolder, onRemoveChunk }: PillsRowProps) {
  const totalCount = mentionedFiles.length + nonImageAttachments.length + pastedChunks.length + folderPaths.length
  const [isExpanded, setIsExpanded] = useState(false)
  const isCollapsible = totalCount > PILLS_COLLAPSE_THRESHOLD
  const showAll = !isCollapsible || isExpanded

  const handleToggle = useCallback(() => setIsExpanded((v) => !v), [])

  const summaryParts: string[] = []
  if (mentionedFiles.length > 0) summaryParts.push(`${mentionedFiles.length} file${mentionedFiles.length > 1 ? 's' : ''}`)
  if (nonImageAttachments.length > 0) summaryParts.push(`${nonImageAttachments.length} attachment${nonImageAttachments.length > 1 ? 's' : ''}`)
  if (folderPaths.length > 0) summaryParts.push(`${folderPaths.length} folder${folderPaths.length > 1 ? 's' : ''}`)
  if (pastedChunks.length > 0) summaryParts.push(`${pastedChunks.length} pasted`)

  return (
    <div className="flex flex-wrap items-center gap-1 mb-1" data-testid="pills-row">
      {isCollapsible && !isExpanded ? (
        <button
          type="button"
          onClick={handleToggle}
          data-testid="pills-expand-button"
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-muted/40 px-2.5 text-[12px] font-medium text-foreground/70 transition-colors hover:bg-muted/60 hover:text-foreground/70"
          aria-label={`${totalCount} items attached, click to expand`}
        >
          <IconPaperclip className="size-3.5" aria-hidden />
          <span>{summaryParts.join(', ')}</span>
          <IconChevronDown className="size-3.5" aria-hidden />
        </button>
      ) : (
        <>
          {mentionedFiles.map((f) => (
            <FileMentionPill key={f.path} path={f.path} onRemove={() => onRemoveMention(f.path)} />
          ))}
          {folderPaths.map((folderPath) => (
            <span
              key={folderPath}
              data-testid="folder-pill"
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium align-middle bg-muted/40 text-foreground/80"
              title={folderPath}
            >
              <IconFolder className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
              <span className="max-w-[180px] truncate">{folderPath.split('/').pop() || folderPath}</span>
              <button
                type="button"
                onClick={() => onRemoveFolder(folderPath)}
                aria-label={`Remove folder ${folderPath}`}
                className="ml-0.5 flex size-4 items-center justify-center rounded text-foreground/70 hover:text-foreground/70"
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l6 6M7 1l-6 6" /></svg>
              </button>
            </span>
          ))}
          {nonImageAttachments.length > 0 && (
            <AttachmentPreview attachments={nonImageAttachments} onRemove={onRemoveAttachment} />
          )}
          {pastedChunks.map((chunk) => (
            <span
              key={chunk.id}
              data-testid="pasted-chunk-pill"
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium align-middle bg-muted/40 text-foreground/80"
            >
              <IconClipboard className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
              <span className="max-w-[120px] truncate">Pasted #{chunk.id}</span>
              <span className="text-muted-foreground">+{chunk.lines > 1 ? `${chunk.lines}L` : `${chunk.chars}c`}</span>
              <button
                type="button"
                onClick={() => onRemoveChunk(chunk.id)}
                aria-label={`Remove pasted text #${chunk.id}`}
                className="ml-0.5 flex size-4 items-center justify-center rounded text-foreground/70 hover:text-foreground/70"
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l6 6M7 1l-6 6" /></svg>
              </button>
            </span>
          ))}
          {isCollapsible && (
            <button
              type="button"
              onClick={handleToggle}
              data-testid="pills-collapse-button"
              className="inline-flex h-7 items-center gap-0.5 rounded-md px-1.5 text-[11px] text-foreground/70 transition-colors hover:text-foreground/70"
              aria-label="Collapse attachments"
            >
              <IconChevronDown className="size-3.5 rotate-180" aria-hidden />
              <span>Less</span>
            </button>
          )}
        </>
      )}
    </div>
  )
})
