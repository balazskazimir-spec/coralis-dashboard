import './globals.css'
import Providers from './providers'
import Sidebar from '@/components/Sidebar'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Coralis Dashboard',
  description: 'Luxury Villa Dashboard',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'Inter, system-ui, sans-serif' }}>
        <Providers>
          <div style={{ display: 'flex' }}>
            <Sidebar />
            <div style={{ flex: 1 }}>{children}</div>
          </div>
        </Providers>
      </body>
    </html>
  )
}
