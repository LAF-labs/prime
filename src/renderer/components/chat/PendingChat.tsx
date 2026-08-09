import { t } from '@/lib/i18n'
import { toast } from 'sonner'
import { useCallback } from 'react'
import { ipc } from '@/lib/ipc'
import { useTaskStore } from '@/stores/taskStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { resolveModelId } from '@/lib/resolve-model'
import { stripImageDataForTitleGen } from '@/lib/message-utils'
import type { Attachment, IpcAttachment, ProjectFile } from '@/types'
import type { PastedChunk } from '@/hooks/useChatInput'
import { ChatInput } from './ChatInput'
import { claimTurn } from '@/lib/turn-ownership'
import { captureDraft, restoreDraft } from './draft-recovery'
import { EmptyThreadSplash } from './EmptyThreadSplash'
import { TerminalDrawer } from './TerminalDrawer'

const WORKSPACE_TERMINAL_SLOT = '__workspace__'

interface PendingChatProps {
  workspace: string
}

export function PendingChat({ workspace }: PendingChatProps) {
  const upsertTask = useTaskStore((s) => s.upsertTask)
  const getProjectId = useTaskStore((s) => s.getProjectId)
  const draft = useTaskStore((s) => s.drafts[workspace])
  const draftAttachments = useTaskStore((s) => s.draftAttachments[workspace])
  const draftPastedChunks = useTaskStore((s) => s.draftPastedChunks[workspace])
  const setDraft = useTaskStore((s) => s.setDraft)
  const removeDraft = useTaskStore((s) => s.removeDraft)
  const setDraftAttachments = useTaskStore((s) => s.setDraftAttachments)
  const setDraftPastedChunks = useTaskStore((s) => s.setDraftPastedChunks)
  const removeDraftAttachments = useTaskStore((s) => s.removeDraftAttachments)
  const removeDraftPastedChunks = useTaskStore((s) => s.removeDraftPastedChunks)
  const draftMentionedFiles = useTaskStore((s) => s.draftMentionedFiles[workspace])
  const setDraftMentionedFiles = useTaskStore((s) => s.setDraftMentionedFiles)
  const removeDraftMentionedFiles = useTaskStore((s) => s.removeDraftMentionedFiles)

  const handleDraftChange = useCallback((val: string) => {
    setDraft(workspace, val)
  }, [workspace, setDraft])

  const handleAttachmentsChange = useCallback((attachments: Attachment[]) => {
    setDraftAttachments(workspace, attachments)
  }, [workspace, setDraftAttachments])

  const handlePastedChunksChange = useCallback((chunks: PastedChunk[]) => {
    setDraftPastedChunks(workspace, chunks)
  }, [workspace, setDraftPastedChunks])

  const handleMentionedFilesChange = useCallback((files: ProjectFile[]) => {
    setDraftMentionedFiles(workspace, files)
  }, [workspace, setDraftMentionedFiles])

  const handleSend = useCallback(async (msg: string, attachments?: IpcAttachment[]) => {
    // Hold on to what we are about to clear. This is the very first message of
    // a thread, so if creating it fails — a typo'd API key, an agent that
    // won't start — clearing the draft first would destroy the prompt the
    // user just wrote, with nothing anywhere to recover it from.
    const savedDraft = captureDraft(useTaskStore.getState(), workspace)
    const putDraftBack = () => restoreDraft(useTaskStore.getState(), workspace, savedDraft)

    removeDraft(workspace)
    removeDraftAttachments(workspace)
    removeDraftPastedChunks(workspace)
    removeDraftMentionedFiles(workspace)
    const cleanMsg = stripImageDataForTitleGen(msg.replace(/<\/?laf-agent_tangent>/g, '').trim())
    const name = cleanMsg.length > 60 ? cleanMsg.slice(0, 57) + '…' : cleanMsg
    const { settings: currentSettings, activeWorkspace, currentModeId, currentModelId } = useSettingsStore.getState()
    const prefs = activeWorkspace ? currentSettings.projectPrefs?.[activeWorkspace] : undefined
    const autoApprove = prefs?.autoApprove !== undefined ? prefs.autoApprove : currentSettings.autoApprove
    const modeId = currentModeId && currentModeId !== 'code' ? currentModeId : undefined
    const modelId = resolveModelId({ projectPrefs: prefs, settings: currentSettings, currentModelId })

    try {
      const created = await ipc.createTask({ name, workspace, prompt: msg, autoApprove, modeId, modelId, attachments })
      upsertTask({ ...created, projectId: getProjectId(workspace) })
      if (currentModeId && currentModeId !== 'code') {
        useTaskStore.getState().setTaskMode(created.id, currentModeId)
      }
      claimTurn(created.id)
      useTaskStore.setState({ pendingWorkspace: null, selectedTaskId: created.id })
      // If this was a /btw question, enter btw mode on the new task
      if (msg.includes('<laf-agent_tangent>')) {
        const question = msg.replace(/<\/?laf-agent_tangent>/g, '').trim()
        useTaskStore.getState().enterBtwMode(created.id, question)
      }
    } catch (err) {
      putDraftBack()
      const detail = err instanceof Error ? err.message : String(err)
      toast.error(t('Could not start the thread'), { description: detail })
    }
  }, [workspace, upsertTask, removeDraft, removeDraftAttachments, removeDraftPastedChunks, removeDraftMentionedFiles, getProjectId])

  const agentAuth = useSettingsStore((s) => s.agentAuth)
  const authChecked = useSettingsStore((s) => s.authChecked)
  const openLogin = useSettingsStore((s) => s.openLogin)
  const isLoggedOut = authChecked && !agentAuth
  const isWorkspaceTerminalOpen = useTaskStore((s) => s.isWorkspaceTerminalOpen)
  const toggleWorkspaceTerminal = useTaskStore((s) => s.toggleWorkspaceTerminal)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        {isLoggedOut ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-amber-500/10">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-amber-600 dark:text-amber-400" aria-hidden>
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm0 15a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm1-4a1 1 0 0 1-2 0V8a1 1 0 0 1 2 0v5Z" fill="currentColor"/>
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground/80">{t('Sign in to start a conversation')}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t('Connect an AI provider to start using the agent')}</p>
            </div>
            <button
              type="button"
              onClick={openLogin}
              className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent"
            >
              {t('Sign in')}
            </button>
          </div>
        ) : (
          <EmptyThreadSplash />
        )}
      </div>
      <ChatInput autoFocus disabled={isLoggedOut} initialValue={draft} initialAttachments={draftAttachments} initialPastedChunks={draftPastedChunks} initialMentionedFiles={draftMentionedFiles} onDraftChange={handleDraftChange} onAttachmentsChange={handleAttachmentsChange} onPastedChunksChange={handlePastedChunksChange} onMentionedFilesChange={handleMentionedFilesChange} onSendMessage={handleSend} workspace={workspace} />
      {isWorkspaceTerminalOpen && (
        <TerminalDrawer
          key={`pending:${workspace}`}
          cwd={workspace}
          slotId={WORKSPACE_TERMINAL_SLOT}
          onClose={toggleWorkspaceTerminal}
        />
      )}
    </div>
  )
}
