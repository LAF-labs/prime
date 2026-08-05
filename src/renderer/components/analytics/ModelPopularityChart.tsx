import { useMemo } from 'react'
import type { AnalyticsEvent } from '@/types/analytics'
import { computeModelPopularity } from '@/lib/analytics-aggregators'
import { ChartCard } from './ChartCard'
import { HorizontalBarSection } from './HorizontalBarSection'

export const ModelPopularityChart = ({ events }: { events: AnalyticsEvent[] }) => {
  const data = useMemo(() => computeModelPopularity(events), [events])
  return (
    <ChartCard title="Model popularity">
      <HorizontalBarSection data={data} fill="#8b5cf6" emptyMessage="No model data yet" />
    </ChartCard>
  )
}
