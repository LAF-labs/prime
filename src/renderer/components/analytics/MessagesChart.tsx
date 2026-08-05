import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { AnalyticsEvent } from '@/types/analytics'
import { computeMessagesByDay, computeTotalInputWords, computeTotalOutputWords, computeTotalMessages } from '@/lib/analytics-aggregators'
import { ChartCard, StatRow, EmptyChart } from './ChartCard'

const fmtNum = (n: number): string => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n)

export const MessagesChart = ({ sent, received }: { sent: AnalyticsEvent[]; received: AnalyticsEvent[] }) => {
  const data = useMemo(() => computeMessagesByDay(sent, received), [sent, received])
  const totalMessages = useMemo(() => computeTotalMessages(sent, received), [sent, received])
  const inputWords = useMemo(() => computeTotalInputWords(sent), [sent])
  const outputWords = useMemo(() => computeTotalOutputWords(received), [received])

  return (
    <ChartCard title="Messages & words">
      <div className="mb-2 grid grid-cols-3 gap-2">
        <StatRow label="Messages" value={totalMessages} />
        <StatRow label="Input words" value={fmtNum(inputWords)} />
        <StatRow label="Output words" value={fmtNum(outputWords)} />
      </div>
      {data.length === 0 ? (
        <EmptyChart message="No messages yet" />
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={data} margin={{ top: 8, right: 0, left: -20, bottom: 0 }}>
            <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={{ fontSize: 11, background: 'var(--color-card)', border: '1px solid var(--color-border)' }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="value" name="Sent" fill="#22c55e" radius={[3, 3, 0, 0]} />
            <Bar dataKey="value2" name="Received" fill="#3b82f6" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}
