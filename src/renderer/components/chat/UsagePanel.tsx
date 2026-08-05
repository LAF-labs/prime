import { memo, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { useTaskStore } from '@/stores/taskStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { PanelShell } from './PanelShell'

export const formatTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export const UsagePanel = memo(function UsagePanel({ onDismiss }: { onDismiss: () => void }) {
  const tasks = useTaskStore((s) => s.tasks)
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId)
  const currentModel = useSettingsStore((s) => s.currentModelId)

  const entries = useMemo(() => {
    return Object.values(tasks)
      .filter((t) => t.contextUsage && t.contextUsage.size > 0)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [tasks])

  const totalUsed = useMemo(() => entries.reduce((sum, t) => sum + (t.contextUsage?.used ?? 0), 0), [entries])
  const totalSize = useMemo(() => entries.reduce((sum, t) => sum + (t.contextUsage?.size ?? 0), 0), [entries])

  return (
    <PanelShell onDismiss={onDismiss}>
      <div className="px-3 pt-2 pb-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">Token Usage</span>
      </div>
      <div className="mx-3 mb-1 rounded-lg bg-muted/30 px-3 py-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[12px] text-muted-foreground">Total context used</span>
          <span className="text-[13px] font-medium text-foreground">{formatTokens(totalUsed)} / {formatTokens(totalSize)}</span>
        </div>
        {totalSize > 0 && (
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted/50">
            <div
              className={cn('h-full rounded-full transition-all', totalUsed / totalSize > 0.85 ? 'bg-red-400' : totalUsed / totalSize > 0.6 ? 'bg-amber-400' : 'bg-blue-400')}
              style={{ width: `${Math.min((totalUsed / totalSize) * 100, 100)}%` }}
            />
          </div>
        )}
        <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{entries.length} task{entries.length !== 1 ? 's' : ''} with usage</span>
          <span>{currentModel ?? 'unknown model'}</span>
        </div>
      </div>
      {entries.length > 0 ? (
        <ul className="max-h-[180px] overflow-y-auto pb-1">
          {entries.map((task) => {
            const cu = task.contextUsage!
            const pct = cu.size > 0 ? (cu.used / cu.size) * 100 : 0
            const isSelected = task.id === selectedTaskId
            return (
              <li key={task.id} className={cn('flex items-center gap-2 px-3 py-1.5 text-[12px]', isSelected ? 'text-foreground' : 'text-muted-foreground')}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={cn('size-1.5 shrink-0 rounded-full', isSelected ? 'bg-primary' : 'bg-transparent')} />
                    <span className="truncate">{task.name || task.id.slice(0, 8)}</span>
                  </div>
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground">{pct.toFixed(0)}%</span>
                <span className="shrink-0 text-[11px]">{formatTokens(cu.used)}</span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="px-3 py-3 text-xs text-muted-foreground/70">No usage data yet</p>
      )}
    </PanelShell>
  )
})
