import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { AnalyticsEvent } from '@/types/analytics'
import { computeProjectStats } from '@/lib/analytics-aggregators'
import { ChartCard, EmptyChart } from './ChartCard'

export const ProjectStatsChart = ({ threadEvents, messageEvents }: { threadEvents: AnalyticsEvent[]; messageEvents: AnalyticsEvent[] }) => {
  const data = useMemo(() => computeProjectStats(threadEvents, messageEvents), [threadEvents, messageEvents])

  if (data.length === 0) {
    return (
      <ChartCard title="Projects" className="lg:col-span-2">
        <EmptyChart message="No project data yet" />
      </ChartCard>
    )
  }

  return (
    <ChartCard title="Projects" className="lg:col-span-2">
      <ResponsiveContainer width="100%" height={Math.max(120, data.length * 32 + 30)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <XAxis type="number" tick={{ fontSize: 10 }} />
          <YAxis type="category" dataKey="project" tick={{ fontSize: 10 }} width={100} />
          <Tooltip contentStyle={{ fontSize: 11, background: 'var(--color-card)', border: '1px solid var(--color-border)' }} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar dataKey="threads" name="Threads" fill="#6366f1" radius={[0, 3, 3, 0]} />
          <Bar dataKey="messages" name="Messages" fill="#22c55e" radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
