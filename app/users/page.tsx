'use client'

import { useEffect, useState } from 'react'
import { useRole } from '@/components/auth/RoleProvider'
import { canManageUsers, ROLE_LABELS } from '@/lib/access'
import { supabase } from '@/lib/supabase'
import type { AppRole, VillaRecord } from '@/lib/types'

const ROLE_OPTIONS: AppRole[] = ['admin', 'staff', 'investor']

export default function UsersPage() {
  const { currentUser, users, updateUser } = useRole()
  const [villas, setVillas] = useState<VillaRecord[]>([])

  useEffect(() => {
    async function loadVillas() {
      const { data } = await supabase.from('villas').select('id, name').order('name')
      setVillas((data as VillaRecord[]) || [])
    }

    void loadVillas()
  }, [])

  if (!canManageUsers(currentUser.role)) {
    return (
      <div style={styles.page}>
        <div style={styles.guardCard}>
          <h1 style={styles.title}>Users</h1>
          <p style={styles.copy}>Only admins can manage users and villa assignments.</p>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>User Management</h1>
          <p style={styles.copy}>Set role access and assign villas to staff or investors.</p>
        </div>
      </div>

      <div style={styles.grid}>
        {users.map((user) => (
          <div key={user.id} style={styles.card}>
            <div style={styles.cardTop}>
              <div>
                <div style={styles.userName}>{user.name}</div>
                <div style={styles.userMeta}>{ROLE_LABELS[user.role]}</div>
              </div>
              <select
                value={user.role}
                onChange={(event) =>
                  updateUser(user.id, {
                    role: event.target.value as AppRole,
                    assignedVillaIds:
                      event.target.value === 'admin' ? [] : user.assignedVillaIds,
                  })
                }
                style={styles.select}
              >
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.sectionTitle}>Villa Assignment</div>
            {user.role === 'admin' ? (
              <div style={styles.adminNote}>Admin sees every villa automatically.</div>
            ) : (
              <div style={styles.villaList}>
                {villas.map((villa) => {
                  const checked = user.assignedVillaIds.includes(villa.id)

                  return (
                    <label key={villa.id} style={styles.checkboxRow}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          const nextAssignedVillaIds = event.target.checked
                            ? [...user.assignedVillaIds, villa.id]
                            : user.assignedVillaIds.filter((villaId) => villaId !== villa.id)

                          updateUser(user.id, { assignedVillaIds: nextAssignedVillaIds })
                        }}
                      />
                      <span>{villa.name}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    padding: 32,
    color: '#f8fafc',
    background: 'linear-gradient(180deg, #08111f 0%, #0d1729 100%)',
  },
  header: {
    marginBottom: 24,
  },
  title: {
    margin: 0,
    fontSize: 32,
  },
  copy: {
    color: '#a8b7cc',
  },
  guardCard: {
    padding: 24,
    borderRadius: 20,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: 20,
  },
  card: {
    padding: 20,
    borderRadius: 20,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
  },
  cardTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
    marginBottom: 20,
  },
  userName: {
    fontSize: 20,
    fontWeight: 700,
  },
  userMeta: {
    opacity: 0.7,
    marginTop: 4,
  },
  select: {
    padding: '10px 12px',
    borderRadius: 10,
    background: '#0f172a',
    color: 'white',
    border: '1px solid rgba(255,255,255,0.08)',
  },
  sectionTitle: {
    marginBottom: 12,
    fontSize: 12,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: '#9fb1c9',
  },
  adminNote: {
    opacity: 0.8,
  },
  villaList: {
    display: 'grid',
    gap: 10,
  },
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
}
