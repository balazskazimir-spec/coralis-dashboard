'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { filterVillasForUser } from '@/lib/access'
import { useRole } from '@/components/auth/RoleProvider'
import { supabase } from '@/lib/supabase'
import type { VillaRecord } from '@/lib/types'

export default function VillasPage() {
  const { currentUser } = useRole()
  const [villas, setVillas] = useState<VillaRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadVillas() {
      const { data } = await supabase.from('villas').select('id, name').order('name')
      setVillas((data as VillaRecord[]) || [])
      setLoading(false)
    }

    void loadVillas()
  }, [])

  const visibleVillas = filterVillasForUser(villas, currentUser)
  const title = currentUser.role === 'admin' ? 'All Villas' : currentUser.role === 'investor' ? 'My Villas' : 'Assigned Villas'
  const copy =
    currentUser.role === 'admin'
      ? 'Full portfolio villa directory.'
      : currentUser.role === 'investor'
        ? 'Your assigned investment villas.'
        : 'Operationally assigned villas.'

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>{title}</h1>
      <p style={styles.copy}>{copy}</p>

      <div style={styles.grid}>
        {loading ? (
          <p>Loading...</p>
        ) : visibleVillas.length ? (
          visibleVillas.map((villa) => (
            <Link key={villa.id} href={`/villas/${villa.id}`} style={styles.link}>
              <div style={styles.card}>
                <p>{villa.name}</p>
              </div>
            </Link>
          ))
        ) : (
          <div style={styles.emptyCard}>No villas are assigned to this profile yet.</div>
        )}
      </div>
    </div>
  )
}

const styles = {
  page: {
    padding: 40,
    color: 'white',
  },

  title: {
    fontSize: 28,
    marginBottom: 8,
  },

  copy: {
    marginTop: 0,
    marginBottom: 20,
    color: 'rgba(255,255,255,0.7)',
  },

  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 20,
  },

  link: {
    textDecoration: 'none',
  },

  card: {
    padding: 20,
    borderRadius: 16,
    background: 'rgba(17,24,39,0.7)',
    cursor: 'pointer',
    transition: 'background 0.2s',
  },

  emptyCard: {
    padding: 20,
    borderRadius: 16,
    background: 'rgba(17,24,39,0.7)',
    color: 'rgba(255,255,255,0.72)',
  },
}
