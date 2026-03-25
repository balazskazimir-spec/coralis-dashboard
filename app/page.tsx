'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { supabase } from '../lib/supabase'

export const dynamic = 'force-dynamic'

const DAY_MS = 1000 * 60 * 60 * 24

function getNights(checkIn?: string, checkOut?: string) {
  const start = new Date(checkIn || '').getTime()
  const end = new Date(checkOut || '').getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  const nights = (end - start) / DAY_MS
  return nights > 0 ? nights : 0
}

export default function Home() {
  const [bookings, setBookings] = useState<any[]>([])
  const [villas, setVillas] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const [guestName, setGuestName] = useState('')
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [price, setPrice] = useState('')
  const [villaId, setVillaId] = useState('')

  useEffect(() => {
    const load = async () => {
      await fetchVillas()
      await fetchBookings()
      setLoading(false)
    }
    load()
  }, [])

  async function fetchVillas() {
    const { data } = await supabase.from('villas').select('*')
    setVillas(data || [])
  }

  async function fetchBookings() {
    const { data } = await supabase
      .from('bookings')
      .select('*, villas(name)')
      .order('check_in', { ascending: true })

    setBookings(data || [])
  }

  async function addBooking() {
    if (!guestName || !checkIn || !checkOut) return

    await supabase.from('bookings').insert([
      {
        guest_name: guestName,
        check_in: checkIn,
        check_out: checkOut,
        price_per_night: price ? Number(price) : null,
        villa_id: villaId || null,
      },
    ])

    setGuestName('')
    setCheckIn('')
    setCheckOut('')
    setPrice('')
    setVillaId('')

    fetchBookings()
  }

  async function deleteBooking(id: string) {
    await supabase.from('bookings').delete().eq('id', id)
    fetchBookings()
  }

  const totalNights = bookings.reduce((acc, b) => acc + getNights(b.check_in, b.check_out), 0)
  const totalRevenue = bookings.reduce((acc, b) => acc + getNights(b.check_in, b.check_out) * (b.price_per_night || 0), 0)

  const occupancy = villas.length
    ? Math.round((totalNights / (villas.length * 30)) * 100)
    : 0

  const monthlyRevenue = useMemo(() => {
    const grouped: Record<string, number> = {}

    bookings.forEach((b) => {
      const key = (b.check_in || '').slice(0, 7)
      const revenue = getNights(b.check_in, b.check_out) * (b.price_per_night || 0)
      grouped[key] = (grouped[key] || 0) + revenue
    })

    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, revenue]) => ({ month, revenue }))
  }, [bookings])

  if (loading) return <div style={{ color: 'white' }}>Loading...</div>

  return (
    <div style={styles.page}>
      <h1>Coralis Dashboard</h1>

      <div style={styles.kpiGrid}>
        <div style={styles.card}>Revenue ${Math.round(totalRevenue)}</div>
        <div style={styles.card}>Occupancy {occupancy}%</div>
        <div style={styles.card}>Bookings {bookings.length}</div>
        <div style={styles.card}>Nights {Math.round(totalNights)}</div>
      </div>

      <div style={styles.chartBox}>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={monthlyRevenue}>
            <CartesianGrid stroke="#222" />
            <XAxis dataKey="month" stroke="#888" />
            <YAxis stroke="#888" />
            <Tooltip />
            <Line type="monotone" dataKey="revenue" stroke="#4f46e5" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={styles.form}>
        <input style={styles.input} placeholder="Guest" value={guestName} onChange={(e) => setGuestName(e.target.value)} />
        <input style={styles.input} type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
        <input style={styles.input} type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
        <input style={styles.input} type="number" placeholder="Price" value={price} onChange={(e) => setPrice(e.target.value)} />

        <select style={styles.input} value={villaId} onChange={(e) => setVillaId(e.target.value)}>
          <option value="">Select villa</option>
          {villas.map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>

        <button style={styles.button} onClick={addBooking}>Add</button>
      </div>

      <div>
        {bookings.map((b) => {
          const total = getNights(b.check_in, b.check_out) * (b.price_per_night || 0)

          return (
            <div key={b.id} style={styles.row}>
              <div>
                <b>{b.guest_name}</b>
                <div>{b.check_in} → {b.check_out}</div>
                <div>{b.villas?.name || '—'}</div>
              </div>

              <div>
                ${Math.round(total)}
                <button style={styles.delete} onClick={() => deleteBooking(b.id)}>X</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { background: '#000', color: 'white', minHeight: '100vh', padding: 20 },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 },
  card: { background: '#111', padding: 15, borderRadius: 8 },
  chartBox: { background: '#111', padding: 20, borderRadius: 8, marginBottom: 20 },
  form: { display: 'grid', gap: 10, marginBottom: 20 },
  input: { padding: 10, background: '#111', color: 'white', border: '1px solid #333' },
  button: { padding: 10, background: '#4f46e5', color: 'white', border: 'none' },
  row: { display: 'flex', justifyContent: 'space-between', background: '#111', padding: 10, marginBottom: 10 },
  delete: { marginLeft: 10, color: 'red', background: 'none', border: 'none' }
}
