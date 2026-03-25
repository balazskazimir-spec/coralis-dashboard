import { LineChart, Line, ResponsiveContainer } from 'recharts'

export default function ChartMini({ title, data, color }: any) {
  return (
    <div style={styles.box}>
      <div style={{ marginBottom: 10 }}>{title}</div>

      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data}>
          <Line
            dataKey="revenue"
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