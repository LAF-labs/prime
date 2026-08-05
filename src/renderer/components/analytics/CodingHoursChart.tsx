import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { AnalyticsEvent } from '@/types/analytics'
import { computeCodingHoursByDay, computeTotalCodingHours } from '@/lib/analytics-aggregators'
import { ChartCard, StatRow, EmptyChart } from './ChartCard'

export const CodingHoursChart = ({ events }: { events: AnalyticsEvent[] }) => {
  const data = useMemo(() => computeCodingHoursByDay(events), [events])
  const total = useMemo(() => computeTotalCodingHours(events), [events])

  return (
    <ChartCard title="Coding hours">
      <StatRow label="Total hours" value={total} />
      {data.length === 0 ? (
        <EmptyChart message="No session data yet" />
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={data} margin={{ top: 8, right: 0, left: -20, bottom: 0 }}>
            <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ fontSize: 11, background: 'var(--color-card)', border: '1px solid var(--color-border)' }} />
            <Bar dataKey="value" name="Hours" fill="#6366f1" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}
