import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { IconMessageCircleQuestion, IconX, IconCheck } from '@tabler/icons-react'
import { useTaskStore } from '@/stores/taskStore'
import { ipc } from '@/lib/ipc'
import ChatMarkdown from './ChatMarkdown'
import { PermissionBanner } from './PermissionBanner'
import { parseReport, stripReport } from './TaskCompletionCard'
import type { TaskMessage } from '@/types'

const EMPTY_MESSAGES: TaskMessage[] = []
const EMPTY_OPTIONS: Array<{ optionId: string; name: string; kind: string }> = []

/**
 * Thin inline report pill for btw overlay.
 */
const BtwReportPill = memo(function BtwReportPill({ status, summary }: { status: string; summary: string }) {
  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-border/40 bg-accent/30 px-3 py-2">
      <IconCheck className="size-3.5 shrink-0 text-green-500" />
      <span className="text-[12px] text-muted-foreground capitalize">{status}</span>
      <span className="text-[12px] text-foreground">{summary}</span>
    </div>
  )
})

/**
 * Floating overlay for /btw (tangent) side questions.
 * Shows the question and streams the response without polluting the main conversation.
 * Dismiss with Escape to discard, or click "Keep" to preserve the Q&A (tail mode).
 */
export const BtwOverlay = memo(function BtwOverlay({ taskId: taskIdProp }: { taskId?: string | null }) {
  const checkpoint = useTaskStore((s) => s.btwCheckpoint)
  const storeSelectedId = useTaskStore((s) => s.selectedTaskId)
  const resolvedTaskId = taskIdProp ?? storeSelectedId
  const messages = useTaskStore((s) => resolvedTaskId ? s.tasks[resolvedTaskId]?.messages ?? EMPTY_MESSAGES : EMPTY_MESSAGES)
  const streamingChunk = useTaskStore((s) => resolvedTaskId ? s.streamingChunks[resolvedTaskId] ?? '' : '')
  const exitBtwMode = useTaskStore((s) => s.exitBtwMode)
  const pendingPermission = useTaskStore((s) => resolvedTaskId ? s.tasks[resolvedTaskId]?.pendingPermission : null)
  const overlayRef = useRef<HTMLDivElement>(null)

  // Find the assistant response added after the checkpoint
  const checkpointLen = checkpoint?.messages.length ?? 0
  const newMessages = messages.slice(checkpointLen)
  const assistantMessage = newMessages.find((m) => m.role === 'assistant')
  const responseText = assistantMessage?.content ?? ''
  const isStreaming = !assistantMessage && streamingChunk.length > 0
  const displayText = isStreaming ? streamingChunk : responseText
  const report = useMemo(() => (!isStreaming && responseText ? parseReport(responseText) : null), [isStreaming, responseText])
  const strippedText = useMemo(() => (!isStreaming && responseText ? stripReport(responseText) : displayText), [isStreaming, responseText, displayText])

  const handleDismiss = useCallback(() => exitBtwMode(false), [exitBtwMode])

  const handlePermissionSelect = useCallback((optionId: string) => {
    if (!resolvedTaskId || !pendingPermission) return
    ipc.selectPermissionOption(resolvedTaskId, pendingPermission.requestId, optionId).catch(() => {})
  }, [resolvedTaskId, pendingPermission])

  // Escape key dismisses
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        handleDismiss()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [handleDismiss])

  // Focus trap
  useEffect(() => {
    overlayRef.current?.focus()
  }, [])

  if (!checkpoint) return null

  const hasResponse = strippedText.length > 0 || report !== null

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
      data-state="open"
      onClick={handleDismiss}
      role="dialog"
      aria-modal="true"
      aria-label="Side question"
      style={{ pointerEvents: 'auto' }}
    >
      <div
        ref={overlayRef}
        tabIndex={-1}
        className="mx-auto flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl outline-none animate-in zoom-in-95 fade-in-0 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-4 py-2.5">
          <IconMessageCircleQuestion className="size-4 text-yellow-500" />
          <span className="text-[13px] font-medium text-yellow-500">btw</span>
          <span className="flex-1 truncate text-[12px] text-muted-foreground">Side question — not saved to conversation</span>
          <button
            onClick={handleDismiss}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Dismiss side question"
          >
            <IconX className="size-3.5" />
          </button>
        </div>

        {/* Question */}
        <div className="shrink-0 border-b border-border/30 px-4 py-2.5">
          <p className="text-[13px] font-medium text-foreground">{checkpoint.question}</p>
        </div>

        {/* Response */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {hasResponse ? (
            <div className="prose-sm text-[13px] text-foreground/90">
              {strippedText && <ChatMarkdown text={strippedText} isStreaming={isStreaming} />}
              {report && <BtwReportPill status={report.status} summary={report.summary} />}
            </div>
          ) : (
            <div className="flex items-center gap-2 py-4">
              <div className="size-1.5 animate-pulse rounded-full bg-yellow-500/60" />
              <span className="text-[12px] text-muted-foreground">Thinking...</span>
            </div>
          )}
        </div>

        {/* Permission request (rendered inside overlay so user can respond) */}
        {pendingPermission && resolvedTaskId && (
          <div className="shrink-0 border-t border-border/30">
            <PermissionBanner
              taskId={resolvedTaskId}
              toolName={pendingPermission.toolName}
              description={pendingPermission.description}
              options={pendingPermission.options ?? EMPTY_OPTIONS}
              onSelect={handlePermissionSelect}
            />
          </div>
        )}

        {/* Footer hint */}
        <div className="shrink-0 border-t border-border/30 px-4 py-1.5">
          <span className="text-[11px] text-muted-foreground/60">
            Press <kbd className="rounded-sm bg-muted px-1 py-0.5 text-[10px] font-mono">Esc</kbd> to dismiss
          </span>
        </div>
      </div>
    </div>
  )
})
