import { useMemo } from 'react'
import type { AnalyticsEvent } from '@/types/analytics'
import { computeModeUsage } from '@/lib/analytics-aggregators'
import { ChartCard } from './ChartCard'
import { HorizontalBarSection } from './HorizontalBarSection'

export const ModeUsageChart = ({ events }: { events: AnalyticsEvent[] }) => {
  const data = useMemo(() => computeModeUsage(events), [events])
  return (
    <ChartCard title="Plan vs code mode">
      <HorizontalBarSection data={data} fill="#06b6d4" emptyMessage="No mode data yet" />
    </ChartCard>
  )
}
