import type { ReactNode } from 'react'
import { tokens } from './tokens'

type SectionProps = {
  title?: string
  children: ReactNode
}

export default function Section({ title, children }: SectionProps) {
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
