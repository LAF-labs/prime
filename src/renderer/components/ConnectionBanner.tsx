import { memo } from 'react'
import { IconLoader2, IconPlugConnectedX } from '@tabler/icons-react'
import { useTaskStore } from '@/stores/taskStore'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * A visible answer to "why is nothing responding?".
 *
 * The connection-health monitor has always tracked reconnection attempts with
 * backoff and an exhausted state, but its only consumer was a 6px dot in the
 * sidebar footer — invisible the moment the sidebar is collapsed. The chat
 * input meanwhile looks perfectly normal with a dead backend behind it. This
 * banner sits above the main content whenever the connection is anything but
 * healthy, so the failure states the monitor already distinguishes actually
 * reach the person waiting on them.
 *
 * It informs rather than blocks: sending a message is itself the reconnect
 * path, so the input must stay usable.
 */
export const ConnectionBanner = memo(function ConnectionBanner() {
  const t = useT()
  const status = useTaskStore((s) => s.connectionStatus)

  // Healthy and first-launch states render nothing: a "connecting…" flash on
  // every startup would train users to ignore this surface.
  if (status.phase === 'idle' || status.phase === 'connected') return null
  if (status.phase === 'connecting' && !status.hasConnected) return null

  const isExhausted =
    status.phase === 'exhausted' || (status.phase === 'disconnected' && !status.hasConnected)

  const text =
    status.phase === 'reconnecting'
      ? t('Reconnecting to the agent ({attempt}/{max})…', {
          attempt: status.reconnectAttemptCount,
          max: status.reconnectMaxAttempts,
        })
      : isExhausted
        ? t('Cannot reach the agent. Send a message to try again, or restart the app.')
        : t('Connection to the agent was lost — reconnecting shortly.')

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="connection-banner"
      className={cn(
        'flex items-center justify-center gap-2 border-b px-4 py-1.5 text-[12px]',
        isExhausted
          ? 'border-destructive/20 bg-destructive/10 text-destructive'
          : 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400',
      )}
    >
      {status.phase === 'reconnecting' ? (
        <IconLoader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
      ) : (
        <IconPlugConnectedX className="size-3.5 shrink-0" aria-hidden />
      )}
      <span>{text}</span>
    </div>
  )
})
