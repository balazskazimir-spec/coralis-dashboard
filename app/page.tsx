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
  const [investmentPerVilla, setInvestmentPerVilla] = useState('200000') // USD
  const [timeframeDays, setTimeframeDays] = useState('30')

  useEffect(() => {
    const load = async () => {
      await Promise.all([fetchVillas(), fetchBookings()])
      setLoading(false)
    }
    load()
  }, [])

  async function fetchVillas() {
    const { data, error } = await supabase
      .from('villas')
      .select('id, name')
      .order('name', { ascending: true })

    if (error) {
      console.error(error)
      return
    }

    const normalized = (data || []).map((v) => ({ id: String(v.id), name: v.name || 'Unnamed villa' }))
    setVillas(normalized)
  }

  async function fetchBookings() {
    const { data, error } = await supabase
      .from('bookings')
      .select('id, guest_name, check_in, check_out, price_per_night, villa_id, villas(name)')
      .order('check_in', { ascending: true })

    if (error) {
      console.error(error)
      return
    }

    setBookings((data as Booking[]) || [])
  }

  async function addBooking() {
    const cleanGuest = guestName.trim()
    const parsedPrice = price === '' ? null : Number(price)

    if (!cleanGuest || !checkIn || !checkOut) return
    if (new Date(checkOut).getTime() <= new Date(checkIn).getTime()) return
    if (parsedPrice !== null && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) return

    const { error } = await supabase.from('bookings').insert([
      {
        guest_name: cleanGuest,
        check_in: checkIn,
        check_out: checkOut,
        price_per_night: parsedPrice,
        villa_id: villaId || null,
      },
    ])

    if (error) {
      console.error(error)
      return
    }

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

  // ===== Core Stats =====
  const totalBookings = bookings.length

  const totalNights = bookings.reduce((acc, b) => acc + getNights(b.check_in, b.check_out), 0)

  const totalRevenue = bookings.reduce((acc, b) => {
    const nights = getNights(b.check_in, b.check_out)
    return acc + nights * (Number(b.price_per_night) || 0)
  }, 0)

  const days = Math.max(1, Number(timeframeDays) || 30)
  const villaCount = Math.max(1, villas.length)
  const occupancy = Math.round((totalNights / (villaCount * days)) * 100)

  // ===== Monthly Revenue =====
  const monthlyRevenue = useMemo(() => {
    const grouped: Record<string, number> = {}

    for (const b of bookings) {
      const key = (b.check_in || '').slice(0, 7) // YYYY-MM
      const rev = getNights(b.check_in, b.check_out) * (Number(b.price_per_night) || 0)
      grouped[key] = (grouped[key] || 0) + (Number.isFinite(rev) ? rev : 0)
    }

    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, revenue]) => ({ month, revenue: Number(revenue.toFixed(2)) }))
  }, [bookings])

  // ===== Villa Stats (Investor) =====
  const villaStats = useMemo(() => {
    const grouped: Record<string, { id: string; name: string; revenue: number; nights: number; bookings: number }> = {}

    for (const b of bookings) {
      const id = b.villa_id || 'unassigned'
      const name = b.villas?.name || 'Unassigned'
      const nights = getNights(b.check_in, b.check_out)
      const revenue = nights * (Number(b.price_per_night) || 0)

      if (!grouped[id]) grouped[id] = { id, name, revenue: 0, nights: 0, bookings: 0 }

      grouped[id].revenue += Number.isFinite(revenue) ? revenue : 0
      grouped[id].nights += nights
      grouped[id].bookings += 1
    }

    return Object.values(grouped).sort((a, b) => b.revenue - a.revenue)
  }, [bookings])

  // ===== Investor Metrics =====
  const investment = Math.max(0, Number(investmentPerVilla) || 0)

  const portfolio = useMemo(() => {
    const avgNightly = totalNights > 0 ? totalRevenue / totalNights : 0
    const monthlyRevenueEst = (avgNightly || 0) * (villaCount * days * (occupancy / 100))
    const annualRevenueEst = monthlyRevenueEst * 12
    const totalInvestment = investment * villaCount
    const roi = totalInvestment > 0 ? (annualRevenueEst / totalInvestment) * 100 : 0

    return {
      avgNightly,
      monthlyRevenueEst,
      annualRevenueEst,
      totalInvestment,
      roi,
    }
  }, [totalRevenue, totalNights, occupancy, villaCount, days, investment])

  if (loading) return <div style={styles.page}>Loading…</div>

  return (
    <main style={styles.page}>
      <section style={styles.container}>
        <header style={styles.header}>
          <div>
            <p style={styles.eyebrow}>Investor Dashboard</p>
            <h1 style={styles.title}>Coralis</h1>
          </div>
        </header>

        {/* ===== Controls ===== */}
        <section style={styles.cardPanel}>
          <h2 style={styles.sectionTitle}>Assumptions</h2>
          <div style={styles.formGrid}>
            <input
              style={styles.input}
              type="number"
              min="0"
              step="1000"
              placeholder="Investment per villa ($)"
              value={investmentPerVilla}
              onChange={(e) => setInvestmentPerVilla(e.target.value)}
            />
            <input
              style={styles.input}
              type="number"
              min="1"
              step="1"
              placeholder="Timeframe (days)"
              value={timeframeDays}
              onChange={(e) => setTimeframeDays(e.target.value)}
            />
          </div>
        </section>

        {/* ===== KPI ===== */}
        <section style={styles.kpiGrid}>
          <article style={styles.card}>
            <p style={styles.cardLabel}>Revenue (actual)</p>
            <p style={styles.cardValue}>${Math.round(totalRevenue).toLocaleString()}</p>
          </article>
          <article style={styles.card}>
            <p style={styles.cardLabel}>Occupancy</p>
            <p style={styles.cardValue}>{occupancy}%</p>
          </article>
          <article style={styles.card}>
            <p style={styles.cardLabel}>Bookings</p>
            <p style={styles.cardValue}>{totalBookings}</p>
          </article>
          <article style={styles.card}>
            <p style={styles.cardLabel}>Nights</p>
            <p style={styles.cardValue}>{Math.round(totalNights)}</p>
          </article>
        </section>

        {/* ===== Investor KPIs ===== */}
        <section style={styles.kpiGrid}>
          <article style={styles.cardAccent}>
            <p style={styles.cardLabel}>Avg nightly</p>
            <p style={styles.cardValue}>${Math.round(portfolio.avgNightly)}</p>
          </article>
          <article style={styles.cardAccent}>
            <p style={styles.cardLabel}>Monthly (est.)</p>
            <p style={styles.cardValue}>${Math.round(portfolio.monthlyRevenueEst).toLocaleString()}</p>
          </article>
          <article style={styles.cardAccent}>
            <p style={styles.cardLabel}>Annual (est.)</p>
            <p style={styles.cardValue}>${Math.round(portfolio.annualRevenueEst).toLocaleString()}</p>
          </article>
          <article style={styles.cardAccent}>
            <p style={styles.cardLabel}>ROI</p>
            <p style={styles.cardValue}>{portfolio.roi.toFixed(1)}%</p>
          </article>
        </section>

        {/* ===== Chart ===== */}
        <section style={styles.cardPanel}>
          <h2 style={styles.sectionTitle}>Monthly Revenue</h2>
          <div style={styles.chartWrap}>
            {monthlyRevenue.length === 0 ? (
              <p style={styles.emptyState}>No booking revenue yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={monthlyRevenue}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                  <XAxis dataKey="month" stroke="#98a2b3" />
                  <YAxis stroke="#98a2b3" />
                  <Tooltip
                    formatter={(value: number) => [`$${Number(value).toLocaleString()}`, 'Revenue']}
                    contentStyle={{ background: '#111827', border: '1px solid #1f2937' }}
                  />
                  <Line type="monotone" dataKey="revenue" stroke="#22c55e" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* ===== Add Booking ===== */}
        <section style={styles.cardPanel}>
          <h2 style={styles.sectionTitle}>Add Booking</h2>
          <div style={styles.formGrid}>
            <input style={styles.input} placeholder="Guest name" value={guestName} onChange={(e) => setGuestName(e.target.value)} />
            <input style={styles.input} type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
            <input style={styles.input} type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
            <input style={styles.input} type="number" min="0" step="1" placeholder="Price per night" value={price} onChange={(e) => setPrice(e.target.value)} />
            <select style={styles.input} value={villaId} onChange={(e) => setVillaId(e.target.value)}>
              <option value="">Select villa (optional)</option>
              {villas.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
            <button style={styles.button} onClick={addBooking}>Add Booking</button>
          </div>
        </section>

        {/* ===== Bookings Table ===== */}
        <section style={styles.cardPanel}>
          <h2 style={styles.sectionTitle}>Bookings</h2>
          <div style={styles.tableHead}>
            <span>Guest</span>
            <span>Villa</span>
            <span>Dates</span>
            <span>Nights</span>
            <span>Revenue</span>
            <span>Action</span>
          </div>
          {bookings.length === 0 ? (
            <p style={styles.emptyState}>No bookings yet.</p>
          ) : (
            bookings.map((b) => {
              const nights = getNights(b.check_in, b.check_out)
              const total = nights * (Number(b.price_per_night) || 0)

              return (
                <div key={b.id} style={styles.tableRow}>
                  <span>{b.guest_name || '-'}</span>
                  <span>{b.villas?.name || 'Unassigned'}</span>
                  <span>{formatDate(b.check_in)} - {formatDate(b.check_out)}</span>
                  <span>{nights}</span>
                  <span>${Math.round(total).toLocaleString()}</span>
                  <button onClick={() => deleteBooking(b.id)} style={styles.deleteBtn}>Delete</button>
                </div>
              )
            })
          )}
        </section>

        {/* ===== Villa Stats ===== */}
        <section style={styles.cardPanel}>
          <h2 style={styles.sectionTitle}>Villa Performance</h2>
          {villaStats.length === 0 ? (
            <p style={styles.emptyState}>No villa stats yet.</p>
          ) : (
            villaStats.map((v) => {
              const inv = investment
              const annual = (v.revenue / Math.max(1, days)) * 365
              const roi = inv > 0 ? (annual / inv) * 100 : 0

              return (
                <div key={v.id} style={styles.villaRow}>
                  <span>{v.name}</span>
                  <span>{v.bookings} bookings</span>
                  <span>{Math.round(v.nights)} nights</span>
                  <span>${Math.round(v.revenue).toLocaleString()}</span>
                  <span>{roi.toFixed(1)}% ROI</span>
                </div>
              )
            })
          )}
        </section>
      </section>
    </main>
  )
}

// ===== Styles =====
const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#020617',
    color: '#f8fafc',
    padding: '24px 16px 40px',
  },
  container: {
    maxWidth: 1200,
    margin: '0 auto',
    display: 'grid',
    gap: 20,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  eyebrow: { margin: 0, color: '#94a3b8', fontSize: 14 },
  title: { margin: '4px 0 0', fontSize: 32, lineHeight: 1.1 },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 },
  card: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 14, padding: 16 },
  cardAccent: { background: '#052e16', border: '1px solid #14532d', borderRadius: 14, padding: 16 },
  cardLabel: { margin: 0, color: '#94a3b8', fontSize: 13 },
  cardValue: { margin: '8px 0 0', fontSize: 28, fontWeight: 700 },
  cardPanel: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 14, padding: 16 },
  sectionTitle: { margin: '0 0 12px', fontSize: 18 },
  chartWrap: { width: '100%', height: 260 },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 },
  input: { width: '100%', background: '#020617', color: '#f8fafc', border: '1px solid #334155', borderRadius: 8, padding: '10px 12px' },
  button: { background: '#22c55e', border: 'none', color: '#052e16', borderRadius: 8, padding: '10px 12px', cursor: 'pointer', fontWeight: 700 },
  tableHead: { display: 'grid', gridTemplateColumns: '1.2fr 1fr 1.4fr 0.6fr 0.8fr 0.7fr', gap: 8, color: '#94a3b8', fontSize: 13, marginBottom: 8 },
  tableRow: { display: 'grid', gridTemplateColumns: '1.2fr 1fr 1.4fr 0.6fr 0.8fr 0.7fr', gap: 8, alignItems: 'center', background: '#111827', borderRadius: 10, padding: 10, marginBottom: 8, fontSize: 14 },
  deleteBtn: { background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' },
  villaRow: { display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1fr', gap: 8, padding: '10px 0', borderTop: '1px solid #1e293b', fontSize: 14 },
  emptyState: { color: '#94a3b8', margin: 0, padding: '8px 0' },
}