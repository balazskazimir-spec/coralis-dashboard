'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

export default function Sidebar() {
  const path = usePathname()
  const [open, setOpen] = useState(true)

  return (
    <div style={styles.sidebar}>
      <h2 style={styles.logo}>CORALIS</h2>

      {/* DASHBOARD */}
      <Nav href="/" label="Dashboard" active={path === '/'} />

      {/* VILLAS GROUP */}
      <div>
        <div style={styles.group} onClick={() => setOpen(!open)}>
          Villas
        </div>

        {open && (
          <div style={styles.submenu}>
            <Nav href="/villas" label="All Villas" active={path === '/villas'} />
            <Nav href="/villas/villa-1" label="Villa 1" active={path === '/villas/villa-1'} />
            <Nav href="/villas/villa-2" label="Villa 2" active={path === '/villas/villa-2'} />
          </div>
        )}
      </div>

      {/* EXPENSES */}
      <Nav href="/expenses" label="Expenses" active={path === '/expenses'} />
    </div>
  )
}

function Nav({ href, label, active }: any) {
  return (
    <Link
      href={href}
      style={{
        ...styles.link,
        background: active ? 'rgba(139,92,246,0.2)' : 'transparent',
      }}
    >
      {label}
    </Link>
  )
}

const styles = {
  sidebar: {
    width: 220,
    padding: 20,
    background: '#020617',
    color: 'white',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },

  logo: {
    fontSize: 18,
    marginBottom: 20,
  },

  link: {
    padding: 10,
    borderRadius: 8,
    textDecoration: 'none',
    color: 'white',
    display: 'block',
  },

  group: {
    padding: 10,
    opacity: 0.6,
    cursor: 'pointer',
  },

  submenu: {
    paddingLeft: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
}