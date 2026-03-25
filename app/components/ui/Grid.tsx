export function Grid4({ children }: any) {
  return <div style={styles.grid4}>{children}</div>
}

export function GridChart({ children }: any) {
  return <div style={styles.chart}>{children}</div>
}

export function Column({ children }: any) {
  return <div style={styles.col}>{children}</div>
}

const styles = {
  grid4: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4,1fr)',
    gap: 20,
    marginBottom: 30,
  },

  chart: {
    display: 'grid',
    gridTemplateColumns: '2fr 1fr',
    gap: 20,
    marginBottom: 30,
  },

  col: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
}