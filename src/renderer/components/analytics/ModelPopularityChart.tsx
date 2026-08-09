import { t } from '@/lib/i18n'
import { useMemo } from 'react'
import type { AnalyticsEvent } from '@/types/analytics'
import { computeModelPopularity } from '@/lib/analytics-aggregators'
import { ChartCard } from './ChartCard'
import { HorizontalBarSection } from './HorizontalBarSection'

export const ModelPopularityChart = ({ events }: { events: AnalyticsEvent[] }) => {
  const data = useMemo(() => computeModelPopularity(events), [events])
  return (
    <ChartCard title={t('Model popularity')}>
      <HorizontalBarSection data={data} fill="var(--chart-5)" emptyMessage={t('No model data yet')} />
    </ChartCard>
  )
}
