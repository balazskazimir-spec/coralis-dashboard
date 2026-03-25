'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export const dynamic = 'force-dynamic'

export default function Home() {
  const [bookings, setBookings] = useState<any[]>([])

  const [guestName, setGuestName] = useState('')
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [price, setPrice] = useState('')
  const [villaId, setVillaId] = useState('')

  const [villas, setVillas] = useState<any[]>([])

  useEffect(() => {
    fetchBookings()
    fetchVillas()
  }, [])

  async function fetchBookings() {
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .order('created_at', { ascending: false })

    if (!error) setBookings(data || [])
  }

  async function fetchVillas() {
    const { data, error } = await supabase
      .from('villas')
      .select('*')

    if (!error) setVillas(data || [])
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
    <div style={{ padding: 20 }}>
      <h1>Coralis Dashboard</h1>

      {/* 📊 STATS */}
      <h2>Stats</h2>
      <p>Total bookings: {totalBookings}</p>
      <p>Total nights: {totalNights}</p>
      <p>Total revenue: ${totalRevenue}</p>
      <p>Occupancy: {occupancy}%</p>

      <hr />

      {/* ➕ ADD BOOKING */}
      <h2>Add Booking</h2>

      <input
        placeholder="Guest name"
        value={guestName}
        onChange={(e) => setGuestName(e.target.value)}
      />
      <br /><br />

      <input
        type="date"
        value={checkIn}
        onChange={(e) => setCheckIn(e.target.value)}
      />
      <br /><br />

      <input
        type="date"
        value={checkOut}
        onChange={(e) => setCheckOut(e.target.value)}
      />
      <br /><br />

      <input
        type="number"
        placeholder="Price per night"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
      />
      <br /><br />

      <select
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

      <br /><br />

      <button onClick={addBooking}>Add</button>

      <hr />

      {/* 📋 BOOKINGS */}
      <h2>Bookings</h2>

      {bookings.map((b) => {
        const nights =
          (new Date(b.check_out).getTime() -
            new Date(b.check_in).getTime()) /
          (1000 * 60 * 60 * 24)

        const total = nights * (b.price_per_night || 0)

        const villa = villas.find((v) => v.id === b.villa_id)

        return (
          <div key={b.id}>
            {b.guest_name} | {b.check_in} → {b.check_out} | 🏠{' '}
            {villa?.name || '—'} | 💰 ${total}
            <button onClick={() => deleteBooking(b.id)}>❌</button>
          </div>
        )
      })}
    </div>
  )
}