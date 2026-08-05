import { useMemo } from 'react'
import type { AnalyticsEvent } from '@/types/analytics'
import { computeToolCallBreakdown, computeTotalToolCalls } from '@/lib/analytics-aggregators'
import { ChartCard, StatRow } from './ChartCard'
import { HorizontalBarSection } from './HorizontalBarSection'

export const ToolCallChart = ({ events }: { events: AnalyticsEvent[] }) => {
  const data = useMemo(() => computeToolCallBreakdown(events), [events])
  const total = useMemo(() => computeTotalToolCalls(events), [events])
  return (
    <ChartCard title="Tool calls">
      <StatRow label="Total tool calls" value={total} />
      <HorizontalBarSection data={data} fill="#ec4899" emptyMessage="No tool call data yet" />
    </ChartCard>
  )
}
