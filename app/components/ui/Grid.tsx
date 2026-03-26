import type { ReactNode } from 'react'

type GridProps = {
  children: ReactNode
}

export function Grid4({ children }: GridProps) {
  return <div style={styles.grid4}>{children}</div>
}

export function GridChart({ children }: GridProps) {
  return <div style={styles.chart}>{children}</div>
}

export function Column({ children }: GridProps) {
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
    flexDirection: 'column' as const,
    gap: 20,
  },
}
