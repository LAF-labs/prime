import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { EmptyChart } from './ChartCard'

interface HBarProps {
  readonly data: Record<string, number>
  readonly fill: string
  readonly emptyMessage: string
  readonly maxItems?: number
}

export const HorizontalBarSection = ({ data, fill, emptyMessage, maxItems = 10 }: HBarProps) => {
  const sorted = useMemo(() => {
    return Object.entries(data)
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxItems)
      .map(([name, count]) => ({ name, count }))
  }, [data, maxItems])

  if (sorted.length === 0) return <EmptyChart message={emptyMessage} />

  return (
    <ResponsiveContainer width="100%" height={Math.max(100, sorted.length * 28 + 20)}>
      <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <XAxis type="number" tick={{ fontSize: 10 }} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={90} />
        <Tooltip contentStyle={{ fontSize: 11, background: 'var(--color-card)', border: '1px solid var(--color-border)' }} />
        <Bar dataKey="count" fill={fill} radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
