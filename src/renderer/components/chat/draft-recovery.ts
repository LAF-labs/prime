/**
 * Holding on to a draft across a send that might fail.
 *
 * The first message of a thread is dispatched by clearing the composer and
 * then creating the thread. If creation fails — a rejected API key, an agent
 * that will not start — the prompt the user just wrote is gone, and nothing
 * anywhere holds a copy. So we snapshot before clearing and put it back on
 * failure.
 */
import type { Attachment, ProjectFile } from '@/types'
import type { PastedChunk } from '@/hooks/useChatInput'

export interface SavedDraft {
  text: string
  attachments: Attachment[]
  chunks: PastedChunk[]
  files: ProjectFile[]
}

/** The per-workspace draft maps, as the task store holds them. */
export interface DraftMaps {
  drafts: Record<string, string>
  draftAttachments: Record<string, Attachment[]>
  draftPastedChunks: Record<string, PastedChunk[]>
  draftMentionedFiles: Record<string, ProjectFile[]>
}

export interface DraftSetters {
  setDraft: (workspace: string, content: string) => void
  setDraftAttachments: (workspace: string, attachments: Attachment[]) => void
  setDraftPastedChunks: (workspace: string, chunks: PastedChunk[]) => void
  setDraftMentionedFiles: (workspace: string, files: ProjectFile[]) => void
}

export const captureDraft = (maps: DraftMaps, workspace: string): SavedDraft => ({
  text: maps.drafts[workspace] ?? '',
  attachments: maps.draftAttachments[workspace] ?? [],
  chunks: maps.draftPastedChunks[workspace] ?? [],
  files: maps.draftMentionedFiles[workspace] ?? [],
})

/**
 * Put a captured draft back.
 *
 * Empty pieces are skipped rather than written as empty values: a send that
 * failed after the user already started typing something new should not have
 * that replaced by a blank.
 */
export const restoreDraft = (
  setters: DraftSetters,
  workspace: string,
  saved: SavedDraft,
): void => {
  if (saved.text) setters.setDraft(workspace, saved.text)
  if (saved.attachments.length) setters.setDraftAttachments(workspace, saved.attachments)
  if (saved.chunks.length) setters.setDraftPastedChunks(workspace, saved.chunks)
  if (saved.files.length) setters.setDraftMentionedFiles(workspace, saved.files)
}
