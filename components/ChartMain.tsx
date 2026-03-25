import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'

export default function ChartMain({ data }: any) {
  return (
    <div style={styles.wrap}>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid stroke="#1f2937" />
          <XAxis dataKey="month" stroke="#666" />
          <YAxis stroke="#666" />
          <Tooltip />

          {/* REVENUE */}
          <Line dataKey="revenue" stroke="#8b5cf6" strokeWidth={3} dot={false} />

          {/* EXPENSES */}
          <Line dataKey="expenses" stroke="#ef4444" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

const styles = {
  wrap: {
    padding: 20,
    borderRadius: 20,
    background: 'rgba(17,24,39,0.7)',
  },
}