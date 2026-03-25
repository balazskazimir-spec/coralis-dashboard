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

  useEffect(() => {
    fetchBookings()
  }, [])

  async function fetchBookings() {
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .order('check_in', { ascending: true })

    if (error) console.error(error)
    else setBookings(data || [])
  }

  async function addBooking() {
    if (!guestName || !checkIn || !checkOut) return

    const { error } = await supabase.from('bookings').insert([
      {
        guest_name: guestName,
        check_in: checkIn,
        check_out: checkOut,
        price_per_night: price ? Number(price) : null,
      },
    ])

    if (error) console.error(error)
    else {
      setGuestName('')
      setCheckIn('')
      setCheckOut('')
      setPrice('')
      fetchBookings()
    }
  }

  async function deleteBooking(id: string) {
    await supabase.from('bookings').delete().eq('id', id)
    fetchBookings()
  }

  // ===== STATS =====

  const totalBookings = bookings.length

  const totalNights = bookings.reduce((acc, b) => {
    const nights =
      (new Date(b.check_out || '').getTime() -
        new Date(b.check_in || '').getTime()) /
      (1000 * 60 * 60 * 24)

    return acc + (nights || 0)
  }, 0)

  const totalRevenue = bookings.reduce((acc, b) => {
    const nights =
      (new Date(b.check_out || '').getTime() -
        new Date(b.check_in || '').getTime()) /
      (1000 * 60 * 60 * 24)

    return acc + (nights || 0) * (b.price_per_night || 0)
  }, 0)

  const occupancy = Math.round((totalNights / 30) * 100)

  return (
    <div style={{ padding: 20, color: 'white', background: '#000', minHeight: '100vh' }}>
      <h1>Coralis Dashboard</h1>

      {/* ===== STATS ===== */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 30 }}>
        <div style={card}>Revenue ${totalRevenue}</div>
        <div style={card}>Occupancy {occupancy}%</div>
        <div style={card}>Bookings {totalBookings}</div>
        <div style={card}>Nights {totalNights}</div>
      </div>

      {/* ===== ADD FORM ===== */}
      <h2>Add Booking</h2>

      <input
        placeholder="Guest name"
        value={guestName}
        onChange={(e) => setGuestName(e.target.value)}
        style={input}
      />

      <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} style={input} />

      <input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} style={input} />

      <input
        type="number"
        placeholder="Price per night"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        style={input}
      />

      <button onClick={addBooking} style={button}>
        Add
      </button>

      <hr style={{ margin: '30px 0' }} />

      {/* ===== LIST ===== */}
      <h2>Bookings</h2>

      {bookings.map((b) => {
        const nights =
          (new Date(b.check_out || '').getTime() -
            new Date(b.check_in || '').getTime()) /
          (1000 * 60 * 60 * 24)

        const total = (nights || 0) * (b.price_per_night || 0)

        return (
          <div key={b.id} style={row}>
            <div>
              <strong>{b.guest_name}</strong>
              <div>
                {b.check_in} → {b.check_out}
              </div>
            </div>

            <div>
              ${total}
              <button onClick={() => deleteBooking(b.id)} style={deleteBtn}>
                ❌
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ===== STYLES =====

const card = {
  background: '#111',
  padding: 20,
  borderRadius: 10,
  minWidth: 150,
}

const input = {
  display: 'block',
  marginBottom: 10,
  padding: 10,
  width: 250,
}

const button = {
  padding: 10,
  cursor: 'pointer',
}

const row = {
  display: 'flex',
  justifyContent: 'space-between',
  marginBottom: 10,
  padding: 10,
  background: '#111',
  borderRadius: 8,
}

const deleteBtn = {
  background: 'transparent',
  border: 'none',
  color: 'red',
  marginLeft: 10,
  cursor: 'pointer',
}