import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ChartCardProps {
  readonly title: string
  readonly children: ReactNode
  readonly className?: string
}

export const ChartCard = ({ title, children, className }: ChartCardProps) => (
  <div className={cn('rounded-xl border border-border/40 bg-card p-4', className)}>
    <h3 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">{title}</h3>
    {children}
  </div>
)

interface StatRowProps {
  readonly label: string
  readonly value: string | number
  readonly color?: string
}

export const StatRow = ({ label, value, color }: StatRowProps) => (
  <div className="flex items-baseline justify-between">
    <span className="text-[12px] text-muted-foreground">{label}</span>
    <span className={cn('text-[15px] font-semibold', color ?? 'text-foreground')}>{value}</span>
  </div>
)

export const EmptyChart = ({ message }: { message: string }) => (
  <div className="flex items-center justify-center py-8 text-xs text-muted-foreground/60">{message}</div>
)
