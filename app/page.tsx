'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Home() {
  const [bookings, setBookings] = useState<any[]>([])

  useEffect(() => {
    fetchBookings()
  }, [])

  async function fetchBookings() {
    const { data, error } = await supabase
      .from('bookings')
      .select('*')

    if (error) {
      console.error(error)
    } else {
      setBookings(data || [])
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>Coralis Dashboard</h1>

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