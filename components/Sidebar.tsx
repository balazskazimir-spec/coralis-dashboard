'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useRole } from '@/components/auth/RoleProvider'
import { canAccessExpenses, canAccessInbox, canAccessOperations, canManageUsers, filterVillasForUser, ROLE_LABELS } from '@/lib/access'
import { supabase } from '@/lib/supabase'
import type { VillaRecord } from '@/lib/types'

type NavProps = {
  href: string
  label: string
  active: boolean
}

export default function Sidebar() {
  const path = usePathname()
  const { currentUser, users, setCurrentUserId } = useRole()
  const [open, setOpen] = useState(true)
  const [villas, setVillas] = useState<VillaRecord[]>([])

  useEffect(() => {
    async function loadVillas() {
      const { data } = await supabase.from('villas').select('id, name').order('name')
      setVillas((data as VillaRecord[]) || [])
    }

    void loadVillas()
  }, [])

  const visibleVillas = filterVillasForUser(villas, currentUser)
  const isStaff = currentUser.role === 'staff'
  const isAdmin = currentUser.role === 'admin'
  const isInvestor = currentUser.role === 'investor'

  return (
    <div style={styles.sidebar}>
      <div style={styles.brandWrap}>
        <Image
          src="/coralis-logo-white.png"
          alt="Coralis"
          width={188}
          height={104}
          priority
          style={styles.logoImage}
        />
      </div>

      <div style={styles.userCard}>
        <div style={styles.userLabel}>Active User</div>
        <select value={currentUser.id} onChange={(event) => setCurrentUserId(event.target.value)} style={styles.userSelect}>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {`${user.name} - ${ROLE_LABELS[user.role]}`}
            </option>
          ))}
        </select>
      </div>

      {isStaff ? (
        <>
          <div style={styles.sectionLabel}>Operations</div>
          <Nav href="/" label="Dashboard" active={path === '/'} />
          <Nav href="/calendar" label="Calendar" active={path === '/calendar'} />
          {canAccessInbox(currentUser.role) && <Nav href="/inbox" label="Inbox" active={path === '/inbox'} />}
          <Nav href="/tasks" label="Tasks" active={path === '/tasks'} />
          <Nav href="/issues" label="Issues" active={path === '/issues'} />
          {canAccessExpenses(currentUser.role) && <Nav href="/expenses" label="Expenses" active={path === '/expenses'} />}

          <div>
            <div style={styles.group} onClick={() => setOpen(!open)}>
              Assigned Villas
            </div>

            {open ? (
              <div style={styles.submenu}>
                {visibleVillas.map((villa) => (
                  <Nav key={villa.id} href={`/villas/${villa.id}`} label={villa.name} active={path === `/villas/${villa.id}`} />
                ))}
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <div style={styles.sectionLabel}>{isAdmin ? 'Management' : 'Portfolio'}</div>
          <Nav href="/" label="Dashboard" active={path === '/'} />

          <div>
            <div style={styles.group} onClick={() => setOpen(!open)}>
              {isInvestor ? 'Assigned Villas' : 'Villas'}
            </div>

            {open ? (
              <div style={styles.submenu}>
                <Nav href="/villas" label={isInvestor ? 'My Villas' : 'All Villas'} active={path === '/villas'} />
                {visibleVillas.map((villa) => (
                  <Nav key={villa.id} href={`/villas/${villa.id}`} label={villa.name} active={path === `/villas/${villa.id}`} />
                ))}
              </div>
            ) : null}
          </div>

          {canAccessExpenses(currentUser.role) && <Nav href="/expenses" label="Expenses" active={path === '/expenses'} />}
          {canAccessInbox(currentUser.role) && <Nav href="/inbox" label="Inbox" active={path === '/inbox'} />}
          {canAccessOperations(currentUser.role) && <Nav href="/tasks" label="Tasks" active={path === '/tasks'} />}
          {canAccessOperations(currentUser.role) && <Nav href="/issues" label="Issues" active={path === '/issues'} />}
          {canManageUsers(currentUser.role) && <Nav href="/users" label="Users" active={path === '/users'} />}
        </>
      )}
    </div>
  )
}

function Nav({ href, label, active }: NavProps) {
  return (
    <Link
      href={href}
      style={{
        ...styles.link,
        background: active ? 'linear-gradient(135deg, rgba(24,194,156,0.22), rgba(14,165,233,0.16))' : 'transparent',
        borderColor: active ? 'rgba(24,194,156,0.24)' : 'transparent',
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
    flexDirection: 'column' as const,
    gap: 10,
  },

  brandWrap: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    marginBottom: 16,
    paddingBottom: 10,
  },

  logoImage: {
    width: '100%',
    maxWidth: 188,
    height: 'auto',
    objectFit: 'contain' as const,
  },

  userCard: {
    marginBottom: 8,
    padding: 10,
    borderRadius: 12,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
  },

  userLabel: {
    marginBottom: 6,
    fontSize: 11,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    opacity: 0.7,
  },

  userSelect: {
    width: '100%',
    padding: 8,
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.08)',
    background: '#0f172a',
    color: 'white',
  },

  sectionLabel: {
    marginTop: 6,
    marginBottom: 4,
    fontSize: 11,
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
    opacity: 0.58,
  },

  link: {
    padding: 10,
    borderRadius: 10,
    textDecoration: 'none',
    color: 'white',
    display: 'block',
    border: '1px solid transparent',
  },

  group: {
    padding: 10,
    opacity: 0.6,
    cursor: 'pointer',
  },

  submenu: {
    paddingLeft: 10,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
}

