import { memo } from 'react'
import { cn } from '@/lib/utils'

interface ContextUsageBarProps {
  usage: { used: number; size: number }
  className?: string
}

export const ContextUsageBar = memo(function ContextUsageBar({ usage, className }: ContextUsageBarProps) {
  const pct = usage.size > 0 ? Math.round((usage.used / usage.size) * 100) : 0
  const color = pct < 50 ? 'bg-emerald-500' : pct < 80 ? 'bg-amber-500' : 'bg-red-500'
  const tokensK = Math.round(usage.used / 1000)
  const sizeK = Math.round(usage.size / 1000)

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="h-1 flex-1 rounded-full bg-secondary">
        <div className={cn('h-full rounded-full transition-all duration-300', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground">{tokensK}k / {sizeK}k</span>
    </div>
  )
})
