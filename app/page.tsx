'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

// ❗ FIXED IMPORTS
import KPI from '../components/KPI'
import ChartMain from '../components/ChartMain'
import ChartMini from '../components/ChartMini'
import BookingList from '../components/BookingList'
import Forecast from '../components/Forecast'

// UI (EZ MARAD app/components-ben)
import Card from './components/ui/Card'
import Section from './components/ui/Section'
import { Grid4, GridChart, Column } from './components/ui/Grid'
import { tokens } from './components/ui/tokens'

type Booking = {
  id: string
  guest_name: string
  check_in: string
  check_out: string
  price_per_night: number | null
}

export default function Page() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [expenses, setExpenses] = useState<any[]>([])

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    const { data: bookingsData } = await supabase.from('bookings').select('*')
    const { data: expensesData } = await supabase.from('expenses').select('*')

    setBookings(bookingsData || [])
    setExpenses(expensesData || [])
  }

  function nights(b: Booking) {
    return (
      (new Date(b.check_out).getTime() -
        new Date(b.check_in).getTime()) /
      86400000
    )
  }

  const totalRevenue = bookings.reduce(
    (a, b) => a + nights(b) * (b.price_per_night || 0),
    0
  )

  const totalExpenses = expenses.reduce(
    (a, e) => a + Number(e.amount),
    0
  )

  const profit = totalRevenue - totalExpenses

  const monthly = useMemo(() => {
    const map: any = {}

    bookings.forEach((b) => {
      const m = b.check_in.slice(0, 7)
      map[m] = map[m] || { month: m, revenue: 0, expenses: 0 }
      map[m].revenue += nights(b) * (b.price_per_night || 0)
    })

    expenses.forEach((e) => {
      const m = e.date.slice(0, 7)
      map[m] = map[m] || { month: m, revenue: 0, expenses: 0 }
      map[m].expenses += Number(e.amount)
    })

    return Object.values(map)
  }, [bookings, expenses])

  return (
    <div style={styles.wrapper}>
      <div style={styles.inner}>

        <Section title="Overview">
          <Grid4>
            <KPI title="Revenue" value={`$${Math.round(totalRevenue)}`} />
            <KPI title="Expenses" value={`$${Math.round(totalExpenses)}`} />
            <KPI title="Profit" value={`$${Math.round(profit)}`} />
            <KPI title="ROI" value="28%" />
          </Grid4>
        </Section>

        <Section title="Performance">
          <GridChart>
            <Card>
              <ChartMain data={monthly} />
            </Card>

            <Column>
              <Card>
                <ChartMini title="Profit" data={monthly} color={tokens.colors.green} />
              </Card>

              <Card>
                <ChartMini title="Expenses" data={monthly} color={tokens.colors.red} />
              </Card>
            </Column>
          </GridChart>
        </Section>

        <Section title="Bookings">
          <Card>
            <BookingList bookings={bookings} nights={nights} />
          </Card>
        </Section>

      </div>
    </div>
  )
}

const styles = {
  wrapper: {
    minHeight: '100vh',
    background: tokens.colors.bgGradient,
  },

  inner: {
    padding: tokens.spacing.xxl,
    color: tokens.colors.text,
  },
}