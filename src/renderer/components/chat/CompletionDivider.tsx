import { memo } from 'react'

/** Format duration in ms to a compact label */
function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s'
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const rem = sec % 60
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`
}

interface CompletionDividerProps {
  durationMs?: number
}

export const CompletionDivider = memo(function CompletionDivider({ durationMs }: CompletionDividerProps) {
  const label = durationMs && durationMs > 0
    ? `Response • ${formatDuration(durationMs)}`
    : 'Response'

  return (
    <div className="my-3 flex items-center gap-3">
      <span className="h-px flex-1 bg-border/60" />
      <span className="rounded-full border border-border/60 bg-background px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">
        {label}
      </span>
      <span className="h-px flex-1 bg-border/60" />
    </div>
  )
})
