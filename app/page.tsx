'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'

type Booking = {
  id: string
  guest_name: string
  check_in: string
  check_out: string
  price_per_night: number | null
}

export default function Home() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)

  const [investment] = useState(200000)

  useEffect(() => {
    fetchBookings()
  }, [])

  async function fetchBookings() {
    const { data } = await supabase.from('bookings').select('*')
    setBookings((data as any) || [])
    setLoading(false)
  }

  function nights(b: Booking) {
    return (
      (new Date(b.check_out).getTime() -
        new Date(b.check_in).getTime()) /
      (1000 * 60 * 60 * 24)
    )
  }

  const totalNights = bookings.reduce((a, b) => a + nights(b), 0)

  const totalRevenue = bookings.reduce(
    (a, b) => a + nights(b) * (b.price_per_night || 0),
    0
  )

  const avgNight =
    totalNights > 0 ? totalRevenue / totalNights : 0

  const monthlyRevenue = useMemo(() => {
    const map: any = {}

    bookings.forEach((b) => {
      const month = b.check_in.slice(0, 7)
      const rev = nights(b) * (b.price_per_night || 0)

      map[month] = (map[month] || 0) + rev
    })

    return Object.keys(map).map((m) => ({
      month: m,
      revenue: map[m],
    }))
  }, [bookings])

  const forecastMonthly = avgNight * 30
  const forecastYearly = forecastMonthly * 12
  const roi = (forecastYearly / investment) * 100

  if (loading) return <div style={styles.page}>Loading...</div>

  return (
    <div style={styles.page}>
      {/* SIDEBAR */}
      <div style={styles.sidebar}>
        <h2 style={{ marginBottom: 30 }}>Coralis</h2>

        <div style={styles.nav}>Dashboard</div>
        <div style={styles.nav}>Bookings</div>
        <div style={styles.nav}>Villas</div>
        <div style={styles.nav}>Analytics</div>
      </div>

      {/* MAIN */}
      <div style={styles.main}>
        <h1 style={{ marginBottom: 30 }}>Investor Dashboard</h1>

        {/* KPI */}
        <div style={styles.grid}>
          <Card title="Revenue" value={`$${Math.round(totalRevenue)}`} />
          <Card title="Avg Night" value={`$${Math.round(avgNight)}`} />
          <Card title="ROI" value={`${roi.toFixed(1)}%`} />
          <Card title="Nights" value={Math.round(totalNights)} />
        </div>

        {/* CHART */}
        <div style={styles.chart}>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={monthlyRevenue}>
              <CartesianGrid stroke="#222" />
              <XAxis dataKey="month" stroke="#888" />
              <YAxis stroke="#888" />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="revenue"
                stroke="#8b5cf6"
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* FORECAST */}
        <div style={styles.forecast}>
          <div>Monthly: ${Math.round(forecastMonthly)}</div>
          <div>Yearly: ${Math.round(forecastYearly)}</div>
          <div>ROI: {roi.toFixed(1)}%</div>
        </div>

        {/* BOOKINGS */}
        <div style={styles.table}>
          <h3>Bookings</h3>

          {bookings.map((b) => (
            <div key={b.id} style={styles.row}>
              <div>
                <b>{b.guest_name}</b>
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

function Card({ title, value }: any) {
  return (
    <div style={styles.card}>
      <div style={{ opacity: 0.6 }}>{title}</div>
      <div style={styles.value}>{value}</div>
    </div>
  )
}

const styles = {
  page: {
    display: 'flex',
    minHeight: '100vh',
    background:
      'radial-gradient(circle at top left, #7c3aed, #020617)',
    color: 'white',
    fontFamily: 'sans-serif',
  },

  sidebar: {
    width: 240,
    background: 'rgba(17,24,39,0.7)',
    backdropFilter: 'blur(10px)',
    padding: 20,
    borderRight: '1px solid rgba(255,255,255,0.1)',
  },

  nav: {
    marginBottom: 15,
    opacity: 0.7,
    cursor: 'pointer',
  },

  main: {
    flex: 1,
    padding: 40,
  },

  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 20,
    marginBottom: 30,
  },

  card: {
    background: 'rgba(17,24,39,0.8)',
    padding: 20,
    borderRadius: 16,
    border: '1px solid rgba(255,255,255,0.1)',
    backdropFilter: 'blur(10px)',
  },

  value: {
    fontSize: 24,
    marginTop: 10,
  },

  chart: {
    height: 280,
    background: 'rgba(17,24,39,0.8)',
    borderRadius: 16,
    padding: 20,
    marginBottom: 30,
    border: '1px solid rgba(255,255,255,0.1)',
  },

  forecast: {
    display: 'flex',
    gap: 20,
    marginBottom: 30,
  },

  table: {
    background: 'rgba(17,24,39,0.8)',
    borderRadius: 16,
    padding: 20,
    border: '1px solid rgba(255,255,255,0.1)',
  },

  row: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: 15,
    borderBottom: '1px solid rgba(255,255,255,0.05)',
  },
}