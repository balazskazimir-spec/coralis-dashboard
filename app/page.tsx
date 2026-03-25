'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Home() {
  const [bookings, setBookings] = useState<any[]>([])

  const [guestName, setGuestName] = useState('')
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')

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
    } else {
      setBookings(data || [])
    }
  }

  async function addBooking() {
    if (!guestName || !checkIn || !checkOut) {
      alert('Fill all fields')
      return
    }

    const { error } = await supabase.from('bookings').insert([
      {
        guest_name: guestName,
        check_in: checkIn,
        check_out: checkOut,
      },
    ])

    if (error) {
      console.error(error)
      alert('Error adding booking')
    } else {
      setGuestName('')
      setCheckIn('')
      setCheckOut('')
      fetchBookings()
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>Coralis Dashboard</h1>

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

      <button onClick={addBooking}>
        Add
      </button>

      <hr />

      <h2>Bookings:</h2>

      {bookings.length === 0 && <p>No bookings yet</p>}

      {bookings.map((b) => (
        <div key={b.id}>
          {b.guest_name} | {b.check_in} → {b.check_out}
        </div>
      ))}
    </div>
  )
}