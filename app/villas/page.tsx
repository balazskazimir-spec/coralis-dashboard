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

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>All Villas</h1>

      <div style={styles.grid}>
        {loading ? (
          <p>Loading...</p>
        ) : (
          visibleVillas.map((villa) => (
            <Link key={villa.id} href={`/villas/${villa.id}`} style={styles.link}>
              <div style={styles.card}>
                <p>{villa.name}</p>
              </div>
            </Link>
          ))
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
    marginBottom: 20,
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
}
