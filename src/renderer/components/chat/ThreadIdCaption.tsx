import { memo, useCallback, useRef, useState } from 'react'
import { IconCopy, IconCheck } from '@tabler/icons-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTaskStore } from '@/stores/taskStore'

interface ThreadIdCaptionProps {
  taskId: string
}

/**
 * Small, selectable thread-id strip rendered above the message list.
 *
 * Surfaces the canonical `Task.id` (UUIDv4) and the kiro CLI session ID
 * so a user reporting an issue can copy either directly out of the chat
 * surface. The task id is stored in `threads.id` (SQLite) and
 * `SavedThread.id` (history.json). The session id maps to the ACP
 * connection on the backend.
 */
export const ThreadIdCaption = memo(function ThreadIdCaption({ taskId }: ThreadIdCaptionProps) {
  const sessionId = useTaskStore((s) => s.sessionIds[taskId])
  const [copied, setCopied] = useState<'thread' | 'session' | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const copyValue = useCallback((value: string, which: 'thread' | 'session') => {
    void navigator.clipboard.writeText(value).then(() => {
      if (timerRef.current) clearTimeout(timerRef.current)
      setCopied(which)
      timerRef.current = setTimeout(() => setCopied(null), 1200)
    })
  }, [])

  return (
    <div
      data-testid="thread-id-caption"
      className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-0.5 px-4 pt-2 pb-1 text-[10px] text-muted-foreground/60"
    >
      {/* Thread ID */}
      <span className="flex items-center gap-1.5">
        <span className="select-none uppercase tracking-wider">Thread ID</span>
        <span
          className="select-text font-mono tabular-nums text-muted-foreground/80"
          title={taskId}
        >
          {taskId}
        </span>
        <CopyButton copied={copied === 'thread'} onClick={() => copyValue(taskId, 'thread')} label="Copy thread ID" />
      </span>

      {/* Session ID (only shown when available) */}
      {sessionId && (
        <span className="flex items-center gap-1.5">
          <span className="select-none uppercase tracking-wider">Session</span>
          <span
            className="select-text font-mono tabular-nums text-muted-foreground/80"
            title={sessionId}
          >
            {sessionId}
          </span>
          <CopyButton copied={copied === 'session'} onClick={() => copyValue(sessionId, 'session')} label="Copy session ID" />
        </span>
      )}
    </div>
  )
})

function CopyButton({ copied, onClick, label }: { copied: boolean; onClick: () => void; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className="rounded p-0.5 text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
          aria-label={label}
        >
          {copied ? <IconCheck className="size-3" aria-hidden /> : <IconCopy className="size-3" aria-hidden />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{copied ? 'Copied!' : label}</TooltipContent>
    </Tooltip>
  )
}
