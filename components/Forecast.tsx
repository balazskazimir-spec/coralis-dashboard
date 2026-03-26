type ForecastProps = {
  monthly: number
  yearly: number
  roi: number
}

type ForecastBoxProps = {
  label: string
  value: number
  percent?: boolean
}

export default function Forecast({ monthly, yearly, roi }: ForecastProps) {
  return (
    <div style={styles.wrap}>
      <Box label="Monthly" value={monthly} />
      <Box label="Yearly" value={yearly} />
      <Box label="ROI" value={roi} percent />
    </div>
  )
}

function Box({ label, value, percent }: ForecastBoxProps) {
  return (
    <div style={styles.box}>
      <div style={styles.label}>{label}</div>
      <div style={styles.value}>
        {percent ? `${value.toFixed(1)}%` : `$${Math.round(value)}`}
      </div>
    </div>
  )
}

const styles = {
  wrap: {
    display: 'flex',
    gap: 20,
    marginBottom: 30,
  },
  box: {
    padding: 16,
    borderRadius: 12,
    background: 'rgba(255,255,255,0.03)',
  },
  label: {
    opacity: 0.6,
    fontSize: 12,
  },
  value: {
    fontSize: 20,
  },
}
