'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Home() {
  const [bookings, setBookings] = useState<any[]>([])
  const [villas, setVillas] = useState<any[]>([])

  const [guestName, setGuestName] = useState('')
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [price, setPrice] = useState('')
  const [villaId, setVillaId] = useState('')

  useEffect(() => {
    fetchBookings()
    fetchVillas()
  }, [])

  async function fetchBookings() {
    const { data } = await supabase
      .from('bookings')
      .select('*')
      .order('created_at', { ascending: false })

    setBookings(data || [])
  }

  async function fetchVillas() {
    const { data } = await supabase.from('villas').select('*')
    setVillas(data || [])
  }

  async function addBooking() {
    if (!guestName || !checkIn || !checkOut || !price || !villaId) return

    await supabase.from('bookings').insert([
      {
        guest_name: guestName,
        check_in: checkIn,
        check_out: checkOut,
        price_per_night: Number(price),
        villa_id: villaId,
      },
    ])

    setGuestName('')
    setCheckIn('')
    setCheckOut('')
    setPrice('')

    fetchBookings()
  }

  async function deleteBooking(id: string) {
    await supabase.from('bookings').delete().eq('id', id)
    fetchBookings()
  }

  // 📊 STATS
  const totalBookings = bookings.length

  const totalNights = bookings.reduce((acc, b) => {
    const nights =
      (new Date(b.check_out).getTime() -
        new Date(b.check_in).getTime()) /
      (1000 * 60 * 60 * 24)
    return acc + nights
  }, 0)

  const totalRevenue = bookings.reduce((acc, b) => {
    const nights =
      (new Date(b.check_out).getTime() -
        new Date(b.check_in).getTime()) /
      (1000 * 60 * 60 * 24)

    return acc + nights * (b.price_per_night || 0)
  }, 0)

  const occupancy = Math.round((totalNights / 30) * 100)

  return (
    <div style={container}>
      <h1 style={{ marginBottom: 20 }}>Coralis Dashboard</h1>

      {/* KPI */}
      <div style={kpiContainer}>
        <div style={card}>
          <p>Revenue</p>
          <h2>${totalRevenue}</h2>
        </div>

        <div style={card}>
          <p>Occupancy</p>
          <h2>{occupancy}%</h2>
        </div>

        <div style={card}>
          <p>Bookings</p>
          <h2>{totalBookings}</h2>
        </div>

        <div style={card}>
          <p>Nights</p>
          <h2>{totalNights}</h2>
        </div>
      </div>

      {/* ADD */}
      <div style={section}>
        <h3>Add Booking</h3>

        <input
          style={input}
          placeholder="Guest name"
          value={guestName}
          onChange={(e) => setGuestName(e.target.value)}
        />

        <input
          style={input}
          type="date"
          value={checkIn}
          onChange={(e) => setCheckIn(e.target.value)}
        />

        <input
          style={input}
          type="date"
          value={checkOut}
          onChange={(e) => setCheckOut(e.target.value)}
        />

        <input
          style={input}
          type="number"
          placeholder="Price per night"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />

        <select
          style={input}
          value={villaId}
          onChange={(e) => setVillaId(e.target.value)}
        >
          <option value="">Select villa</option>
          {villas.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>

        <button style={button} onClick={addBooking}>
          Add Booking
        </button>
      </div>

      {/* LIST */}
      <div style={section}>
        <h3>Bookings</h3>

        {bookings.map((b) => {
          const nights =
            (new Date(b.check_out).getTime() -
              new Date(b.check_in).getTime()) /
            (1000 * 60 * 60 * 24)

          const total = nights * (b.price_per_night || 0)
          const villa = villas.find((v) => v.id === b.villa_id)

          return (
            <div key={b.id} style={bookingRow}>
              <div>
                <b>{b.guest_name}</b>
                <p>
                  {b.check_in} → {b.check_out}
                </p>
                <p style={{ opacity: 0.6 }}>
                  {villa?.name || 'No villa'}
                </p>
              </div>

              <div style={{ textAlign: 'right' }}>
                <p>${total}</p>
                <button
                  style={deleteBtn}
                  onClick={() => deleteBooking(b.id)}
                >
                  ❌
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// 🎨 STYLES

const container = {
  padding: 30,
  fontFamily: 'Arial',
  background: '#000',
  minHeight: '100vh',
  color: 'white',
}

const kpiContainer = {
  display: 'flex',
  gap: 20,
  marginBottom: 30,
}

const card = {
  background: '#111',
  padding: 20,
  borderRadius: 10,
  flex: 1,
}

const section = {
  background: '#111',
  padding: 20,
  borderRadius: 10,
  marginBottom: 20,
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 10,
}

const input = {
  padding: 10,
  borderRadius: 6,
  border: '1px solid #333',
  background: '#1a1a1a',
  color: 'white',
}

const button = {
  padding: 12,
  borderRadius: 8,
  background: '#4f46e5',
  color: 'white',
  border: 'none',
  cursor: 'pointer',
}

const bookingRow = {
  display: 'flex',
  justifyContent: 'space-between',
  background: '#1a1a1a',
  padding: 15,
  borderRadius: 8,
}

const deleteBtn = {
  background: 'transparent',
  border: 'none',
  color: 'red',
  cursor: 'pointer',
}