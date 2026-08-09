import { t } from '@/lib/i18n'
import { useMemo } from 'react'
import type { AnalyticsEvent } from '@/types/analytics'
import { computeModeUsage } from '@/lib/analytics-aggregators'
import { ChartCard } from './ChartCard'
import { HorizontalBarSection } from './HorizontalBarSection'

export const ModeUsageChart = ({ events }: { events: AnalyticsEvent[] }) => {
  const data = useMemo(() => computeModeUsage(events), [events])
  return (
    <ChartCard title={t('Plan vs code mode')}>
      <HorizontalBarSection data={data} fill="var(--chart-4)" emptyMessage={t('No mode data yet')} />
    </ChartCard>
  )
}
