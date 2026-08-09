import { t } from '@/lib/i18n'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { IconHistory, IconAlertTriangle } from '@tabler/icons-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTaskStore } from '@/stores/taskStore'
import { useMessageListTaskId } from './MessageList'
import { cn } from '@/lib/utils'

/** How long the armed "Confirm" state stays before reverting to the icon. */
const CONFIRM_TIMEOUT_MS = 3000

/**
 * The single conversation-rollback affordance, shared by user and assistant
 * messages: keep the thread exactly as it stood at this message and drop
 * everything after it.
 *
 * There used to be two different buttons here — "regenerate" on answers and
 * "edit and resend" on questions — which did subtly different things to the
 * transcript and left people guessing which one they wanted. One verb, one
 * outcome, on every message.
 *
 * Hidden on the last message, where it would do nothing, and disabled while
 * the agent is mid-turn, where truncating would race the incoming stream.
 */
export const RestoreToHereButton = memo(function RestoreToHereButton({
  messageIndex,
}: {
  messageIndex: number
}) {
  const taskId = useMessageListTaskId()
  const isTaskBusy = useTaskStore((s) => (taskId ? s.tasks[taskId]?.status === 'running' : false))
  const hasFollowingMessages = useTaskStore((s) =>
    taskId ? (s.tasks[taskId]?.messages.length ?? 0) > messageIndex + 1 : false,
  )
  const [isConfirming, setIsConfirming] = useState(false)
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
    }
  }, [])

  const handleClick = useCallback(() => {
    if (!taskId) return
    if (!isConfirming) {
      setIsConfirming(true)
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
      confirmTimerRef.current = setTimeout(() => setIsConfirming(false), CONFIRM_TIMEOUT_MS)
      return
    }
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
    setIsConfirming(false)
    useTaskStore.getState().rollbackToMessage(taskId, messageIndex)
  }, [taskId, messageIndex, isConfirming])

  if (!taskId || !hasFollowingMessages) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleClick}
          disabled={isTaskBusy}
          aria-label={t('Restore to here')}
          data-testid="restore-to-here-button"
          className={cn(
            'inline-flex items-center gap-1 rounded-md p-1 text-muted-foreground/70 transition-colors',
            'hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60',
            'disabled:pointer-events-none disabled:opacity-40',
            isConfirming && 'bg-destructive/10 px-1.5 text-destructive hover:bg-destructive/15 hover:text-destructive',
          )}
        >
          {isConfirming ? (
            <>
              <IconAlertTriangle className="size-3" aria-hidden />
              <span className="text-[11px] font-medium">{t('Confirm')}</span>
            </>
          ) : (
            <IconHistory className="size-3" aria-hidden />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-[11px]">
        {isConfirming ? t('Deletes every message after this one') : t('Restore to here')}
      </TooltipContent>
    </Tooltip>
  )
})
