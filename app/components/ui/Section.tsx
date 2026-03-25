import { tokens } from './tokens'

export default function Section({ title, children }: any) {
  return (
    <div style={{ marginBottom: tokens.spacing.xl }}>
      {title && (
        <h2
          style={{
            marginBottom: tokens.spacing.md,
            color: tokens.colors.text,
            opacity: 0.9,
          }}
        >
          {title}
        </h2>
      )}

      {children}
    </div>
  )
}