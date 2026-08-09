import { t } from '@/lib/i18n'
import { memo, useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { IconCopy, IconCheck, IconMessageCircle } from '@tabler/icons-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import ChatMarkdown from './ChatMarkdown'
import { ThinkingDisplay } from './ThinkingDisplay'
import { TaskCompletionCard, parseReport, stripReport, shouldRenderReportCard } from './TaskCompletionCard'
import { useMessageListTaskId } from './MessageList'
import { RestoreToHereButton } from './RestoreToHereButton'
import type { AssistantTextRow as AssistantTextRowData } from '@/lib/timeline'

/** Format duration in ms to a human-readable label */
function formatDurationLabel(ms: number): string {
  if (ms < 1000) return '<1s'
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const rem = sec % 60
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`
}

export const AssistantTextRow = memo(function AssistantTextRow({ row }: { row: AssistantTextRowData }) {
  // Inline-mode middle segments must not parse the content for report/handoff —
  // they hold a slice of prose, not the full message body.
  const isInline = row.isInlineSegment === true
  const report = useMemo(
    () => (!row.isStreaming && !isInline ? parseReport(row.content) : null),
    [row.isStreaming, row.content, isInline],
  )
  const displayContent = useMemo(
    () => (!row.isStreaming && !isInline ? stripReport(row.content) : row.content),
    [row.isStreaming, row.content, isInline],
  )
  const isRichReport = report && shouldRenderReportCard(report)
  // Only render the card here when there's no changed-files row to host it
  const showReportCard = isRichReport && !row.hasChangedFiles

  const handleBtw = useCallback(() => {
    // Dispatch the same event as Cmd+B — prefills /btw in the chat input and focuses it
    document.dispatchEvent(new CustomEvent('btw-shortcut'))
  }, [])

  const ctxTaskId = useMessageListTaskId()

  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clean up the copy-feedback timer on unmount to avoid setState on unmounted component
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(row.content).then(() => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      setCopied(true)
      copyTimerRef.current = setTimeout(() => setCopied(false), 1200)
    })
  }, [row.content])

  const canRestore =
    !row.isStreaming &&
    !isInline &&
    row.isTurnBoundary === true &&
    typeof row.messageIndex === 'number' &&
    !!ctxTaskId

  return (
    <div data-testid="assistant-text-row" className={cn('group/assistant', row.squashed ? 'pb-2.5' : 'pb-4')} data-timeline-row-kind="assistant-text">
      {row.thinking && (
        <ThinkingDisplay text={row.thinking} isActive={row.isStreaming} />
      )}
      {displayContent ? (
        row.isStreaming ? (
          <ChatMarkdown text={displayContent} isStreaming />
        ) : (
          <ChatMarkdown text={displayContent} questionsAnswered={row.questionsAnswered} />
        )
      ) : null}
      {showReportCard && <TaskCompletionCard report={report} />}
      {!row.isStreaming && !isInline && displayContent && (
        <div className="mt-1 flex items-center gap-1 opacity-50 transition-opacity group-hover/assistant:opacity-100 focus-within:opacity-100">
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={handleBtw} className="rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60">
                <IconMessageCircle className="size-3" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[11px]">{t('Side question (/btw)')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={handleCopy} className="rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60">
                {copied ? <IconCheck className="size-3" aria-hidden /> : <IconCopy className="size-3" aria-hidden />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[11px]">{copied ? 'Copied!' : 'Copy'}</TooltipContent>
          </Tooltip>
          {canRestore && <RestoreToHereButton messageIndex={row.messageIndex!} />}
          {row.durationMs != null && row.durationMs > 0 && (
            <span className="ml-1 text-[11px] tabular-nums text-muted-foreground/40">
              {formatDurationLabel(row.durationMs)}
            </span>
          )}
        </div>
      )}
    </div>
  )
})
