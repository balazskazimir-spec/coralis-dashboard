import { Line, LineChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { ChartSeriesKey, RevenueExpensePoint } from '@/lib/types'

type ChartMiniProps = {
  title: string
  data: RevenueExpensePoint[]
  color: string
  dataKey?: ChartSeriesKey
  formatCurrency?: (value: number) => string
}

export default function ChartMini({
  title,
  data,
  color,
  dataKey = 'revenue',
  formatCurrency,
}: ChartMiniProps) {
  return (
    <div style={styles.box}>
      <div style={{ marginBottom: 10 }}>{title}</div>

      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data}>
          <Tooltip
            formatter={(value) =>
              formatCurrency
                ? formatCurrency(Number(value))
                : `$${Number(value).toFixed(2)}`
            }
          />
          <Line
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

const styles = {
  box: {
    padding: 16,
    borderRadius: 16,
    background:
      'linear-gradient(180deg, rgba(30,41,59,0.6), rgba(15,23,42,0.6))',
  },
}
