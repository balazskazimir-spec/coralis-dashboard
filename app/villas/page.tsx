'use client'

import { useEffect, useMemo, useState } from 'react'
../../lib/supabase

type Booking = {
  id: string
  guest_name: string
  check_in: string
  check_out: string
  price_per_night: number | null
  villa_id: string | null
}

type Villa = {
  id: string
  name: string
}

export default function Home() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [villas, setVillas] = useState<Villa[]>([])
  const [selectedVilla, setSelectedVilla] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const { data: b } = await supabase.from('bookings').select('*')
    const { data: v } = await supabase.from('villas').select('*')

    setBookings((b as any) || [])
    setVillas((v as any) || [])

    if (v && v.length > 0) {
      setSelectedVilla(v[0].id)
    }
  }

  function nights(b: Booking) {
    return (
      (new Date(b.check_out).getTime() -
        new Date(b.check_in).getTime()) /
      (1000 * 60 * 60 * 24)
    )
  }

  const filtered = bookings.filter(
    (b) => b.villa_id === selectedVilla
  )

  const totalRevenue = filtered.reduce(
    (a, b) => a + nights(b) * (b.price_per_night || 0),
    0
  )

  const totalNights = filtered.reduce((a, b) => a + nights(b), 0)

  const occupancy = Math.min(
    (totalNights / 30) * 100,
    100
  )

  /* -------- CALENDAR -------- */

  const days = Array.from({ length: 30 }, (_, i) => i + 1)

  function isBooked(day: number) {
    return filtered.some((b) => {
      const start = new Date(b.check_in).getDate()
      const end = new Date(b.check_out).getDate()
      return day >= start && day < end
    })
  }

  return (
    <div style={styles.page}>
      <div style={styles.sidebar}>
        <h2>Coralis</h2>

        {villas.map((v) => (
          <div
            key={v.id}
            onClick={() => setSelectedVilla(v.id)}
            style={{
              padding: 10,
              cursor: 'pointer',
              opacity: selectedVilla === v.id ? 1 : 0.6,
            }}
          >
            {v.name}
          </div>
        ))}
      </div>

      <div style={styles.main}>
        <h1>Villa Dashboard</h1>

        {/* KPI */}
        <div style={styles.grid}>
          <Card title="Revenue" value={`$${Math.round(totalRevenue)}`} />
          <Card title="Nights" value={Math.round(totalNights)} />
          <Card title="Occupancy" value={`${occupancy.toFixed(1)}%`} />
        </div>

        {/* CALENDAR */}
        <div style={styles.calendar}>
          {days.map((d) => (
            <div
              key={d}
              style={{
                ...styles.day,
                background: isBooked(d)
                  ? '#8b5cf6'
                  : 'rgba(255,255,255,0.05)',
              }}
            >
              {d}
            </div>
          ))}
        </div>

        {/* BOOKINGS */}
        <div style={styles.table}>
          {filtered.map((b) => (
            <div key={b.id} style={styles.row}>
              <div>
                {b.guest_name}
                <div style={{ opacity: 0.6 }}>
                  {b.check_in} → {b.check_out}
                </div>
              </div>

              <div>
                $
                {Math.round(
                  nights(b) * (b.price_per_night || 0)
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ---------- UI ---------- */

function Card({ title, value }: any) {
  return (
    <div style={styles.card}>
      <div style={{ opacity: 0.6 }}>{title}</div>
      <div style={{ fontSize: 22 }}>{value}</div>
    </div>
  )
}

/* ---------- STYLES ---------- */

const styles = {
  page: {
    display: 'flex',
    minHeight: '100vh',
    background: '#020617',
    color: 'white',
  },

  sidebar: {
    width: 200,
    padding: 20,
    borderRight: '1px solid #111',
  },

  main: {
    flex: 1,
    padding: 30,
  },

  grid: {
    display: 'flex',
    gap: 20,
    marginBottom: 30,
  },

  card: {
    padding: 20,
    background: '#111827',
    borderRadius: 12,
  },

  calendar: {
    display: 'grid',
    gridTemplateColumns: 'repeat(10, 1fr)',
    gap: 6,
    marginBottom: 30,
  },

  day: {
    padding: 10,
    textAlign: 'center' as const,
    borderRadius: 6,
    fontSize: 12,
  },

  table: {
    background: '#111827',
    padding: 20,
    borderRadius: 12,
  },

  row: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: 10,
    borderBottom: '1px solid #222',
  },
}