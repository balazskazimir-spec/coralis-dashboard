'use client'

import { useMemo } from 'react'
import type { BookingRecord, CalendarDay } from '@/lib/types'

type CalendarProps = {
  bookings: BookingRecord[]
}

export default function Calendar({ bookings }: CalendarProps) {
  const calendarData = useMemo<CalendarDay[]>(() => {
    const days: Record<string, CalendarDay> = {}
    const today = new Date()
    const start = new Date(today.getFullYear(), today.getMonth(), 1)
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0)

    for (let day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
      const dateStr = day.toISOString().split('T')[0]
      days[dateStr] = { date: dateStr, bookings: [] }
    }

    bookings.forEach((booking) => {
      const checkIn = new Date(booking.check_in)
      const checkOut = new Date(booking.check_out)

      for (let day = new Date(checkIn); day < checkOut; day.setDate(day.getDate() + 1)) {
        const dateStr = day.toISOString().split('T')[0]
        if (days[dateStr]) {
          days[dateStr].bookings.push(booking)
        }
      }
    })

    return Object.values(days)
  }, [bookings])

  return (
    <div style={styles.calendar}>
      <h3>Calendar</h3>
      <div style={styles.grid}>
        {calendarData.map((day) => (
          <div key={day.date} style={styles.day}>
            <div style={styles.date}>{new Date(day.date).getDate()}</div>
            {day.bookings.length > 0 && (
              <div style={styles.booking}>
                {day.bookings[0].guest_name}
                {day.bookings.length > 1 && ` +${day.bookings.length - 1}`}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

const styles = {
  calendar: {
    padding: 20,
    borderRadius: 20,
    background: 'rgba(17,24,39,0.7)',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 4,
  },
  day: {
    padding: 8,
    borderRadius: 8,
    background: 'rgba(255,255,255,0.05)',
    minHeight: 60,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center' as const,
  },
  date: {
    fontSize: 12,
    opacity: 0.7,
  },
  booking: {
    fontSize: 10,
    color: '#8b5cf6',
    textAlign: 'center' as const,
    marginTop: 4,
  },
}
