'use client'

import { RoleProvider } from '@/components/auth/RoleProvider'

export default function Providers({ children }: { children: React.ReactNode }) {
  return <RoleProvider>{children}</RoleProvider>
}
