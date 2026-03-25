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

// ===== Helpers =====
const DAY_MS = 1000 * 60 * 60 * 24

function getNights(checkIn?: string, checkOut?: string) {
  const start = new Date(checkIn || '').getTime()
  const end = new Date(checkOut || '').getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  const nights = (end - start) / DAY_MS
  return Number.isFinite(nights) && nights > 0 ? nights : 0
}

function formatDate(dateStr?: string) {
  const t = new Date(dateStr || '').getTime()
  if (!Number.isFinite(t)) return '-'
  return new Date(t).toLocaleDateString()
}

// ===== Types =====
type Villa = {
  id: string
  name: string
}

type Booking = {
  id: string
  guest_name: string
  check_in: string
  check_out: string
  price_per_night: number | null
  villa_id: string | null
  villas?: { name: string | null } | null
}

// ===== Main =====
export default function Home() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [villas, setVillas] = useState<Villa[]>([])
  const [loading, setLoading] = useState(true)

  // form
  const [guestName, setGuestName] = useState('')
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [price, setPrice] = useState('')
  const [villaId, setVillaId] = useState('')

  // investor inputs
  const [investmentPerVilla, setInvestmentPerVilla] = useState('200000')
  const [timeframeDays, setTimeframeDays] = useState('30')

  useEffect(() => {
    const load = async () => {
      await Promise.all([fetchVillas(), fetchBookings()])
      setLoading(false)
    }
    load()
  }, [])

  async function fetchVillas() {
    const { data } = await supabase.from('villas').select('id, name')
    setVillas((data || []).map((v: any) => ({ id: String(v.id), name: v.name || 'Unnamed' })))
  }

  async function fetchBookings() {
    const { data } = await supabase
      .from('bookings')
      .select('id, guest_name, check_in, check_out, price_per_night, villa_id, villas(name)')
      .order('check_in', { ascending: true })

    const normalized = (data || []).map((b: any) => ({
      ...b,
      villas: Array.isArray(b.villas) ? b.villas[0] : b.villas,
    }))

    setBookings(normalized as Booking[])
  }

  async function addBooking() {
    const clean = guestName.trim()
    const parsed = price === '' ? null : Number(price)

    if (!clean || !checkIn || !checkOut) return
    if (new Date(checkOut).getTime() <= new Date(checkIn).getTime()) return

    await supabase.from('bookings').insert([
      {
        guest_name: clean,
        check_in: checkIn,
        check_out: checkOut,
        price_per_night: parsed,
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

  // ===== Core =====
  const totalNights = bookings.reduce((a, b) => a + getNights(b.check_in, b.check_out), 0)
  const totalRevenue = bookings.reduce((a, b) => a + getNights(b.check_in, b.check_out) * (b.price_per_night || 0), 0)

  const days = Math.max(1, Number(timeframeDays) || 30)
  const villaCount = Math.max(1, villas.length)
  const occupancy = Math.round((totalNights / (villaCount * days)) * 100)

  // ===== Monthly =====
  const monthlyRevenue = useMemo(() => {
    const g: Record<string, number> = {}
    bookings.forEach((b) => {
      const key = (b.check_in || '').slice(0, 7)
      const rev = getNights(b.check_in, b.check_out) * (b.price_per_night || 0)
      g[key] = (g[key] || 0) + rev
    })
    return Object.entries(g)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, revenue]) => ({ month, revenue }))
  }, [bookings])

  // ===== Forecast (AI-lite) =====
  const forecast = useMemo(() => {
    const avgNight = totalNights > 0 ? totalRevenue / totalNights : 0
    const monthly = avgNight * (villaCount * days * (occupancy / 100))
    const yearly = monthly * 12
    const investment = Number(investmentPerVilla) || 0
    const totalInvestment = investment * villaCount
    const roi = totalInvestment ? (yearly / totalInvestment) * 100 : 0

    return { avgNight, monthly, yearly, roi }
  }, [totalRevenue, totalNights, occupancy, villaCount, days, investmentPerVilla])

  if (loading) return <div style={styles.page}>Loading...</div>

  return (
    <main style={styles.page}>
      <h1>Coralis Investor Dashboard</h1>

      {/* KPI */}
      <div style={styles.grid}>
        <div style={styles.card}>Revenue ${Math.round(totalRevenue)}</div>
        <div style={styles.card}>Occupancy {occupancy}%</div>
        <div style={styles.card}>Nights {Math.round(totalNights)}</div>
        <div style={styles.card}>Avg Night ${Math.round(forecast.avgNight)}</div>
      </div>

      {/* Forecast */}
      <div style={styles.panel}>
        <h3>Forecast</h3>
        <p>Monthly: ${Math.round(forecast.monthly).toLocaleString()}</p>
        <p>Yearly: ${Math.round(forecast.yearly).toLocaleString()}</p>
        <p>ROI: {forecast.roi.toFixed(1)}%</p>
      </div>

      {/* Chart */}
      <div style={styles.panel}>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={monthlyRevenue}>
            <CartesianGrid stroke="#222" />
            <XAxis dataKey="month" stroke="#888" />
            <YAxis stroke="#888" />
            <Tooltip />
            <Line type="monotone" dataKey="revenue" stroke="#22c55e" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Form */}
      <div style={styles.panel}>
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

      {/* List */}
      <div>
        {bookings.map((b) => {
          const total = getNights(b.check_in, b.check_out) * (b.price_per_night || 0)
          return (
            <div key={b.id} style={styles.row}>
              <div>
                <b>{b.guest_name}</b>
                <div>{formatDate(b.check_in)} → {formatDate(b.check_out)}</div>
                <div>{b.villas?.name || '-'}</div>
              </div>
              <div>
                ${Math.round(total)}
                <button style={styles.delete} onClick={() => deleteBooking(b.id)}>X</button>
              </div>
            </div>
          )
        })}
      </div>
    </main>
  )
}

// ===== Styles =====
const styles: Record<string, CSSProperties> = {
  page: { background: '#000', color: 'white', minHeight: '100vh', padding: 20 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 },
  card: { background: '#111', padding: 15, borderRadius: 8 },
  panel: { background: '#111', padding: 20, borderRadius: 8, marginBottom: 20 },
  input: { padding: 10, background: '#111', color: 'white', border: '1px solid #333', marginBottom: 10 },
  button: { padding: 10, background: '#22c55e', border: 'none', color: '#000' },
  row: { display: 'flex', justifyContent: 'space-between', background: '#111', padding: 10, marginBottom: 10 },
  delete: { marginLeft: 10, color: 'red', background: 'none', border: 'none' },
}