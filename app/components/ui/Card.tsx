import { tokens } from './tokens'

export default function Card({ children }: any) {
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