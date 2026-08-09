import { memo, useId } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import type { CompactionStatus } from '@/types'

type ColorTier = {
  from: string
  to: string
  text: string
}

// Gradient palette per fill tier — keeps the existing thresholds (50/80) but makes each tier
// distinct and lively rather than a single flat stroke colour. Ramp colors live
// as CSS custom properties in src/tailwind.css so both themes get proper shades.
const TIERS = {
  compacting: { from: 'var(--ctx-compacting-from)', to: 'var(--ctx-compacting-to)', text: 'text-blue-600 dark:text-blue-400' },
  low:        { from: 'var(--ctx-low-from)', to: 'var(--ctx-low-to)', text: 'text-emerald-600 dark:text-emerald-400' },
  mid:        { from: 'var(--ctx-mid-from)', to: 'var(--ctx-mid-to)', text: 'text-amber-600 dark:text-amber-400' },
  high:       { from: 'var(--ctx-high-from)', to: 'var(--ctx-high-to)', text: 'text-red-600 dark:text-red-400' },
} as const satisfies Record<string, ColorTier>

export const ContextRing = memo(function ContextRing({ used, size, compactionStatus }: { used: number; size: number; compactionStatus?: CompactionStatus }) {
  const isPercentage = size === 100 && used <= 100
  const pct = isPercentage ? Math.round(used) : size > 0 ? Math.round((used / size) * 100) : 0
  const r = 9.75
  const circ = 2 * Math.PI * r
  const offset = circ - (circ * Math.min(pct, 100)) / 100
  const isCompacting = compactionStatus === 'compacting'
  const gradId = useId()

  const tier: ColorTier =
    isCompacting ? TIERS.compacting :
    pct < 50 ? TIERS.low :
    pct < 80 ? TIERS.mid :
    TIERS.high

  const isHot = !isCompacting && pct >= 80

  const tooltipText = isCompacting
    ? t('Compacting context...')
    : isPercentage
      ? t('Context window {pct}% used', { pct })
      : t('Context: {pct}% ({used}k / {size}k tokens)', { pct, used: Math.round(used / 1000), size: Math.round(size / 1000) })

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid="context-ring"
          className={cn(
            'relative flex h-7 w-7 cursor-default items-center justify-center rounded-full bg-card',
            isCompacting && 'animate-pulse',
            isHot && 'animate-pulse',
          )}
        >
          <svg viewBox="0 0 24 24" className="absolute inset-0 -rotate-90" aria-hidden>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={tier.from} />
                <stop offset="100%" stopColor={tier.to} />
              </linearGradient>
            </defs>
            {/* Track — tinted to the active tier so the unfilled portion still hints at state */}
            <circle cx="12" cy="12" r={r} fill="none" stroke={tier.from} strokeOpacity="0.22" strokeWidth="2.5" />
            {/* Progress arc */}
            <circle
              cx="12" cy="12" r={r} fill="none"
              stroke={`url(#${gradId})`}
              strokeWidth="2.5" strokeLinecap="round"
              strokeDasharray={circ} strokeDashoffset={offset}
              className="transition-[stroke-dashoffset] duration-500 ease-out"
            />
          </svg>
          <span className={cn('relative text-[11px] font-semibold tabular-nums', tier.text)}>
            {isCompacting ? '...' : pct}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-[11px]">{tooltipText}</TooltipContent>
    </Tooltip>
  )
})
