/**
 * Provider Status Banner — shows connection errors/warnings.
 *
 * Displays an alert banner when kiro-cli connection is unhealthy.
 * Uses the rich ConnectionStatus from the task store.
 */
import { memo } from 'react'
import { IconAlertTriangle, IconRefresh, IconWifi, IconWifiOff } from '@tabler/icons-react'
import { useTaskStore } from '@/stores/taskStore'
import { cn } from '@/lib/utils'
import {
  deriveConnectionUiState,
  getConnectionStatusLabel,
  shouldShowConnectionBanner,
  type ConnectionUiState,
} from '@/lib/connection-state'

const BANNER_STYLES: Record<ConnectionUiState, { bg: string; text: string; icon: typeof IconWifi }> = {
  connected: { bg: '', text: '', icon: IconWifi },
  connecting: { bg: 'bg-blue-500/10 border-blue-500/20', text: 'text-blue-600 dark:text-blue-400', icon: IconWifi },
  reconnecting: { bg: 'bg-amber-500/10 border-amber-500/20', text: 'text-amber-600 dark:text-amber-400', icon: IconRefresh },
  error: { bg: 'bg-red-500/10 border-red-500/20', text: 'text-red-600 dark:text-red-400', icon: IconAlertTriangle },
  offline: { bg: 'bg-muted border-border', text: 'text-muted-foreground', icon: IconWifiOff },
}

export const ProviderStatusBanner = memo(function ProviderStatusBanner() {
  const connectionStatus = useTaskStore((s) => s.connectionStatus)

  if (!shouldShowConnectionBanner(connectionStatus)) return null

  const uiState = deriveConnectionUiState(connectionStatus)
  const label = getConnectionStatusLabel(connectionStatus)
  const style = BANNER_STYLES[uiState]
  const Icon = style.icon

  return (
    <div
      role="alert"
      className={cn(
        'flex items-center gap-2 border-b px-3 py-1.5 text-[12px] transition-colors',
        style.bg,
        style.text,
      )}
    >
      <Icon className={cn('size-3.5 shrink-0', uiState === 'reconnecting' && 'animate-spin')} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {uiState === 'error' && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-background/50"
        >
          Retry
        </button>
      )}
    </div>
  )
})
