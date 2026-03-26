import type { ReactNode } from 'react'
import { tokens } from './tokens'

type CardProps = {
  children: ReactNode
}

export default function Card({ children }: CardProps) {
  return <div style={styles.card}>{children}</div>
}

const styles = {
  card: {
    background: tokens.colors.card,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.lg,
    backdropFilter: tokens.blur.glass,
    border: `1px solid ${tokens.colors.border}`,
    boxShadow: tokens.shadow.card,
  },
}
