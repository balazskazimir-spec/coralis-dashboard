type KPIProps = {
  title: string
  value: string
  trend?: string
}

export default function KPI({ title, value, trend }: KPIProps) {
  return (
    <div style={styles.card}>
      <div style={styles.top}>
        <span>{title}</span>
        <span style={styles.trend}>{trend}</span>
      </div>
      <div style={styles.value}>{value}</div>
    </div>
  )
}

const styles = {
  card: {
    padding: 20,
    borderRadius: 18,
    background:
      'linear-gradient(180deg, rgba(30,41,59,0.6), rgba(15,23,42,0.6))',
    border: '1px solid rgba(255,255,255,0.06)',
  },
  top: {
    display: 'flex',
    justifyContent: 'space-between',
    opacity: 0.6,
  },
  trend: {
    color: '#22c55e',
    fontSize: 12,
  },
  value: {
    fontSize: 26,
    marginTop: 6,
  },
}
