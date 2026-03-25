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

  const investment = 200000

  useEffect(() => {
    fetchBookings()
  }, [])

  async function fetchBookings() {
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .order('check_in', { ascending: true })

    if (error) {
      console.error(error)
    }

    setBookings((data as Booking[]) || [])
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
    const map: Record<string, number> = {}

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

  if (loading) return <div style={styles.main}>Loading...</div>

  return (
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
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={monthlyRevenue}>
            <defs>
              <linearGradient id="color" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.8} />
                <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid stroke="#222" />
            <XAxis dataKey="month" stroke="#888" />
            <YAxis stroke="#888" />
            <Tooltip />

            <Line
              type="monotone"
              dataKey="revenue"
              stroke="#8b5cf6"
              strokeWidth={3}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* FORECAST */}
      <div style={styles.forecast}>
        <Forecast label="Monthly" value={forecastMonthly} />
        <Forecast label="Yearly" value={forecastYearly} />
        <Forecast label="ROI" value={roi} isPercent />
      </div>

      {/* BOOKINGS */}
      <div style={styles.table}>
        <h3 style={{ marginBottom: 20 }}>Bookings</h3>

        {bookings.map((b) => (
          <div key={b.id} style={styles.row}>
            <div>
              <div style={{ fontWeight: 600 }}>{b.guest_name}</div>

              <div style={styles.sub}>
                {b.check_in} → {b.check_out}
              </div>
            </div>

            <div style={styles.price}>
              $
              {Math.round(
                nights(b) * (b.price_per_night || 0)
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------- COMPONENTS ---------- */

function Card({ title, value }: any) {
  return (
    <div style={styles.card}>
      <div style={styles.label}>{title}</div>
      <div style={styles.value}>{value}</div>
    </div>
  )
}

function Forecast({ label, value, isPercent }: any) {
  return (
    <div style={styles.forecastBox}>
      <div style={styles.label}>{label}</div>
      <div style={styles.value}>
        {isPercent
          ? `${value.toFixed(1)}%`
          : `$${Math.round(value)}`}
      </div>
    </div>
  )
}

/* ---------- STYLES ---------- */

const styles = {
  main: {
    flex: 1,
    padding: 40,
    color: 'white',
    background: `
      radial-gradient(circle at 20% 20%, #8b5cf6 0%, transparent 40%),
      radial-gradient(circle at 80% 0%, #6366f1 0%, transparent 40%),
      #020617
    `,
    minHeight: '100vh',
  },

  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 20,
    marginBottom: 30,
  },

  card: {
    padding: 20,
    borderRadius: 18,
    background:
      'linear-gradient(145deg, rgba(30,41,59,0.9), rgba(15,23,42,0.9))',
    border: '1px solid rgba(255,255,255,0.08)',
    boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
  },

  chart: {
    background: 'rgba(17,24,39,0.8)',
    borderRadius: 20,
    padding: 20,
    marginBottom: 30,
  },

  forecast: {
    display: 'flex',
    gap: 20,
    marginBottom: 30,
  },

  forecastBox: {
    padding: 16,
    borderRadius: 14,
    background: 'rgba(255,255,255,0.03)',
  },

  table: {
    padding: 20,
    borderRadius: 20,
    background: 'rgba(17,24,39,0.8)',
  },

  row: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: 16,
    borderBottom: '1px solid rgba(255,255,255,0.05)',
  },

  label: {
    opacity: 0.6,
    fontSize: 13,
  },

  value: {
    fontSize: 24,
    fontWeight: 600,
  },

  sub: {
    opacity: 0.6,
    fontSize: 13,
  },

  price: {
    fontWeight: 600,
    color: '#8b5cf6',
  },
}