'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function Sidebar() {
  const path = usePathname()

  function item(href: string, label: string) {
    const active = path === href

    return (
      <Link href={href}>
        <div
          style={{
            padding: 10,
            marginBottom: 10,
            borderRadius: 10,
            background: active ? 'rgba(139,92,246,0.2)' : 'transparent',
            opacity: active ? 1 : 0.6,
            cursor: 'pointer',
          }}
        >
          {label}
        </div>
      </Link>
    )
  }

  return (
    <div style={styles.sidebar}>
      <h2>Coralis</h2>

      {item('/', 'Dashboard')}
      {item('/villas', 'Villas')}
      {item('/bookings', 'Bookings')}
    </div>
  )
}

const styles = {
  sidebar: {
    width: 220,
    padding: 20,
    borderRight: '1px solid #111',
    background: 'rgba(17,24,39,0.7)',
    backdropFilter: 'blur(10px)',
  },
}