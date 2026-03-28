'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts'
import { useParams } from 'next/navigation'
import { canAccessVilla, canEditBookings, canSeeAlerts, canSeeExpenseBreakdown, canSeeProfit, canSeeVendorDetails, filterBookingsForUser, filterExpensesForUser } from '@/lib/access'
import { useRole } from '@/components/auth/RoleProvider'
import { supabase } from '@/lib/supabase'
import type { BookingRecord, ExpenseRecord, VillaRecord } from '@/lib/types'

type DateRange = '7d' | '30d' | '90d' | 'ytd' | 'all'
type Granularity = 'day' | 'week' | 'month'
type Currency = 'IDR' | 'USD' | 'EUR'
type DailyMetric = { date: string; revenue: number; expenses: number; profit: number; bookings: BookingRecord[] }
type BookingForm = { checkIn: string; checkOut: string; guestName: string; price: string; source: string; notes: string }

const DAY = 86400000
const COLORS = ['#18c29c', '#f97316', '#ef4444', '#3b82f6', '#eab308']
const EMPTY_FORM: BookingForm = { checkIn: '', checkOut: '', guestName: '', price: '', source: 'Manual', notes: '' }
const INVESTOR_VILLA_HERO_IMAGES: Record<string, string> = {
  'Villa Mira': '/villa-mira-hero.jpg',
  'Villa Serra': '/villa-serra-hero.jpg',
}
const EXCHANGE_RATES: Record<Currency, number> = { IDR: 1, USD: 0.000064, EUR: 0.000059 }
const DISPLAY_RATES: Record<Currency, { locale: string; code: Currency; min: number; max: number }> = {
  IDR: { locale: 'id-ID', code: 'IDR', min: 0, max: 0 },
  USD: { locale: 'en-US', code: 'USD', min: 0, max: 0 },
  EUR: { locale: 'de-DE', code: 'EUR', min: 0, max: 0 },
}
const pct = (n: number) => `${n.toFixed(1)}%`
const iso = (d: Date) => d.toISOString().slice(0, 10)
const startDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const nights = (b: BookingRecord) => Math.max(0, (new Date(b.check_out).getTime() - new Date(b.check_in).getTime()) / DAY)
const revenue = (b: BookingRecord) => nights(b) * (Number(b.price_per_night) || 0)
const vendorOf = (e: ExpenseRecord) => e.vendor || e.note || 'Direct vendor'
const monthName = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

function cutoffOf(range: DateRange) {
  const d = new Date()
  if (range === '7d') d.setDate(d.getDate() - 7)
  else if (range === '30d') d.setDate(d.getDate() - 30)
  else if (range === '90d') d.setDate(d.getDate() - 90)
  else if (range === 'ytd') {
    d.setMonth(0, 1)
    d.setHours(0, 0, 0, 0)
  }
  else return new Date(0)
  return d
}

function weekKey(d: Date) {
  const copy = startDay(d)
  const offset = (copy.getDay() + 6) % 7
  copy.setDate(copy.getDate() - offset)
  return iso(copy)
}

function bookingOverlapsRange(booking: BookingRecord, rangeStart: Date, rangeEndExclusive: Date) {
  return new Date(booking.check_out) > rangeStart && new Date(booking.check_in) < rangeEndExclusive
}

function bookingNightsInRange(booking: BookingRecord, rangeStart: Date, rangeEndExclusive: Date) {
  const overlapStart = Math.max(new Date(booking.check_in).getTime(), rangeStart.getTime())
  const overlapEnd = Math.min(new Date(booking.check_out).getTime(), rangeEndExclusive.getTime())
  return Math.max(0, (overlapEnd - overlapStart) / DAY)
}

function bookingRevenueInRange(booking: BookingRecord, rangeStart: Date, rangeEndExclusive: Date) {
  return bookingNightsInRange(booking, rangeStart, rangeEndExclusive) * (Number(booking.price_per_night) || 0)
}

export default function VillaPage() {
  const { currentUser } = useRole()
  const params = useParams<{ villa: string }>()
  const villaId = params.villa
  const [villa, setVilla] = useState<VillaRecord | null>(null)
  const [bookings, setBookings] = useState<BookingRecord[]>([])
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([])
  const [today] = useState(() => startDay(new Date()))
  const [viewDate, setViewDate] = useState(() => startDay(new Date()))
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<DateRange>(currentUser.role === 'investor' ? 'ytd' : '90d')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [vendorFilter, setVendorFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [granularity, setGranularity] = useState<Granularity>('day')
  const [currency, setCurrency] = useState<Currency>('IDR')
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<BookingForm>(EMPTY_FORM)

  useEffect(() => {
    if (!villaId) return
    async function load() {
      const [v, b, e] = await Promise.all([
        supabase.from('villas').select('*').eq('id', villaId).single(),
        supabase.from('bookings').select('*').eq('villa_id', villaId).order('check_in', { ascending: false }),
        supabase.from('expenses').select('*').eq('villa_id', villaId).order('date', { ascending: false }),
      ])
      setVilla((v.data as VillaRecord | null) || null)
      setBookings((b.data as BookingRecord[]) || [])
      setExpenses((e.data as ExpenseRecord[]) || [])
    }
    void load()
  }, [villaId])

  const cutoff = cutoffOf(dateRange)
  const cutoffTime = cutoff.getTime()
  const scopeEndExclusive = new Date(today)
  scopeEndExclusive.setDate(scopeEndExclusive.getDate() + 1)
  const baseBookings = filterBookingsForUser(bookings, currentUser)
  const baseExpenses = filterExpensesForUser(expenses, currentUser)
  const filteredBookings = baseBookings.filter((b) => bookingOverlapsRange(b, cutoff, scopeEndExclusive))
  const filteredExpenses = baseExpenses.filter((e) => {
    if (!e.date) return false
    const expenseDate = new Date(e.date)
    if (expenseDate < cutoff || expenseDate >= scopeEndExclusive) return false
    if (categoryFilter !== 'all' && e.category !== categoryFilter) return false
    if (vendorFilter !== 'all' && vendorOf(e) !== vendorFilter) return false
    return true
  })

  const monthStart = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1)
  const gridStartBase = new Date(monthStart)
  gridStartBase.setDate(monthStart.getDate() - ((monthStart.getDay() + 6) % 7))
  const calendarEndExclusive = new Date(gridStartBase)
  calendarEndExclusive.setDate(gridStartBase.getDate() + 42)
  const calendarBookings = baseBookings.filter((b) => bookingOverlapsRange(b, gridStartBase, calendarEndExclusive))

  const daily: Record<string, DailyMetric> = (() => {
    const map: Record<string, DailyMetric> = {}
    const gridStart = new Date(gridStartBase)
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(gridStart)
      d.setDate(gridStart.getDate() + i)
      map[iso(d)] = { date: iso(d), revenue: 0, expenses: 0, profit: 0, bookings: [] }
    }
    calendarBookings.forEach((b) => {
      const perNight = Number(b.price_per_night) || 0
      for (let d = new Date(b.check_in); d < new Date(b.check_out); d.setDate(d.getDate() + 1)) {
        const key = iso(d)
        if (!map[key]) map[key] = { date: key, revenue: 0, expenses: 0, profit: 0, bookings: [] }
        map[key].revenue += perNight
        map[key].bookings.push(b)
      }
    })
    filteredExpenses.forEach((e) => {
      if (!e.date) return
      if (!map[e.date]) map[e.date] = { date: e.date, revenue: 0, expenses: 0, profit: 0, bookings: [] }
      map[e.date].expenses += Number(e.amount) || 0
    })
    Object.values(map).forEach((m) => {
      m.profit = m.revenue - m.expenses
    })
    return map
  })()

  const calendarDays = Array.from({ length: 42 }, (_, i) => {
    const gridStart = new Date(gridStartBase)
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    return d
  })

  const totalRevenue = filteredBookings.reduce((s, b) => s + bookingRevenueInRange(b, cutoff, scopeEndExclusive), 0)
  const totalCost = filteredExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const occupiedNights = filteredBookings.reduce((s, b) => s + bookingNightsInRange(b, cutoff, scopeEndExclusive), 0)
  const scopeDays = Math.max(1, Math.round((startDay(today).getTime() - startDay(cutoff).getTime()) / DAY) + 1)
  const profit = totalRevenue - totalCost
  const annualizedRevenue = (totalRevenue / Math.max(1, scopeDays)) * 365
  const annualizedProfit = (profit / Math.max(1, scopeDays)) * 365
  const costPerNight = occupiedNights ? totalCost / occupiedNights : 0
  const costPerBooking = filteredBookings.length ? totalCost / filteredBookings.length : 0
  const expenseRatio = totalRevenue ? (totalCost / totalRevenue) * 100 : 0
  const occupancy = Math.min(100, scopeDays ? (occupiedNights / scopeDays) * 100 : 0)
  const adr = occupiedNights ? totalRevenue / occupiedNights : 0
  const maintenanceCost = filteredExpenses.filter((e) => e.category === 'maintenance').reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const cleaningCost = filteredExpenses.filter((e) => e.category === 'cleaning').reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const staffCost = filteredExpenses.filter((e) => e.category === 'staff').reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const status = expenseRatio > 60 || costPerNight > adr * 0.7 ? 'Problem' : expenseRatio > 40 || occupancy < 35 ? 'Watch' : 'Healthy'
  const statusColor = status === 'Healthy' ? '#18c29c' : status === 'Watch' ? '#f59e0b' : '#ef4444'
  const showProfit = canSeeProfit(currentUser.role)
  const showAlerts = canSeeAlerts(currentUser.role)
  const showExpenseBreakdown = canSeeExpenseBreakdown(currentUser.role)
  const showVendorDetails = canSeeVendorDetails(currentUser.role)
  const canEdit = canEditBookings(currentUser.role)
  const isInvestor = currentUser.role === 'investor'
  const investorHeroImage = villa ? INVESTOR_VILLA_HERO_IMAGES[villa.name] || null : null
  const currencyRate = EXCHANGE_RATES[currency]
  const money = useMemo(
    () => (value: number) => {
      const props = DISPLAY_RATES[currency]
      return new Intl.NumberFormat(props.locale, {
        style: 'currency',
        currency: props.code,
        minimumFractionDigits: props.min,
        maximumFractionDigits: props.max,
      }).format(value * currencyRate)
    },
    [currency, currencyRate]
  )
  const moneyCompact = useMemo(
    () => (value: number) => {
      const converted = value * currencyRate

      if (currency === 'IDR') {
        const absolute = Math.abs(converted)
        if (absolute >= 1_000_000_000) return `Rp ${(converted / 1_000_000_000).toFixed(2)}B`
        if (absolute >= 1_000_000) return `Rp ${(converted / 1_000_000).toFixed(1)}M`
      }

      return money(value)
    },
    [currency, currencyRate, money]
  )

  const activeBookingId = selectedBookingId || (selectedDate ? daily[selectedDate]?.bookings[0]?.id || null : null)
  const selectedBooking = baseBookings.find((b) => b.id === activeBookingId) || null
  const selectedBookingExpenses = selectedBooking ? filteredExpenses.filter((e) => e.date && e.date >= selectedBooking.check_in && e.date < selectedBooking.check_out) : []
  const selectedBookingNet = selectedBooking ? revenue(selectedBooking) - selectedBookingExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0) : 0

  const previousSpanDays =
    dateRange === '7d'
      ? 7
      : dateRange === '30d'
        ? 30
        : dateRange === '90d'
          ? 90
          : dateRange === 'ytd'
            ? Math.max(1, Math.round((today.getTime() - cutoff.getTime()) / DAY))
            : 30
  const previousCutoff = new Date(cutoff)
  previousCutoff.setDate(previousCutoff.getDate() - previousSpanDays)
  const previousExpenses = expenses.filter((e) => e.date && new Date(e.date) >= previousCutoff && new Date(e.date) < cutoff)

  const categories = (() => {
    const nowMap = new Map<string, number>()
    const prevMap = new Map<string, number>()
    filteredExpenses.forEach((e) => {
      const k = e.category || 'other'
      nowMap.set(k, (nowMap.get(k) || 0) + (Number(e.amount) || 0))
    })
    previousExpenses.forEach((e) => {
      const k = e.category || 'other'
      prevMap.set(k, (prevMap.get(k) || 0) + (Number(e.amount) || 0))
    })
    const sum = Array.from(nowMap.values()).reduce((a, b) => a + b, 0)
    return Array.from(nowMap.entries()).map(([name, value]) => {
      const prev = prevMap.get(name) || 0
      return { name, value, percentage: sum ? (value / sum) * 100 : 0, trend: prev ? ((value - prev) / prev) * 100 : 100 }
    }).sort((a, b) => b.value - a.value)
  })()

  const chartData = (() => {
    const rows = Object.values(daily).filter((d) => {
      const date = new Date(d.date)
      return date.getTime() >= cutoffTime && date <= today
    }).sort((a, b) => a.date.localeCompare(b.date))
    if (granularity === 'day') return rows.map((r) => ({ label: new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), revenue: r.revenue, cost: r.expenses, profit: r.profit }))
    const grouped = new Map<string, { label: string; revenue: number; cost: number; profit: number }>()
    rows.forEach((r) => {
      const d = new Date(r.date)
      const key = granularity === 'week' ? weekKey(d) : `${d.getFullYear()}-${d.getMonth() + 1}`
      const label = granularity === 'week' ? `Week of ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      const prev = grouped.get(key) || { label, revenue: 0, cost: 0, profit: 0 }
      prev.revenue += r.revenue
      prev.cost += r.expenses
      prev.profit += r.profit
      grouped.set(key, prev)
    })
    return Array.from(grouped.values())
  })()

  const vendors = Array.from(new Set(baseExpenses.map((e) => vendorOf(e)))).sort()
  const alerts = [
    categories.find((c) => c.name === 'maintenance' && c.trend > 30) ? { text: 'Maintenance spike', action: () => setCategoryFilter('maintenance') } : null,
    cleaningCost > totalCost * 0.25 && totalCost > 0 ? { text: 'Cleaning cost above avg', action: () => setCategoryFilter('cleaning') } : null,
    costPerNight > adr * 0.65 && adr > 0 ? { text: 'Cost/night too high', action: () => setGranularity('week') } : null,
  ].filter(Boolean) as Array<{ text: string; action: () => void }>

  const transactions = filteredExpenses
    .map((e) => ({ ...e, vendorLabel: vendorOf(e) }))
    .filter((e) => {
      const q = search.trim().toLowerCase()
      if (!q) return true
      return [e.date || '', e.category || '', e.vendorLabel, e.note || ''].some((v) => v.toLowerCase().includes(q))
    })

  async function saveBooking() {
    if (!villaId || !form.checkIn || !form.checkOut || !form.guestName || !form.price) return
    setSaving(true)
    const richPayload = { guest_name: form.guestName, check_in: form.checkIn, check_out: form.checkOut, price_per_night: Number(form.price), villa_id: villaId, source: form.source, status: 'Confirmed', notes: form.notes }
    let inserted: BookingRecord | null = null
    const rich = await supabase.from('bookings').insert(richPayload).select('*').single()
    if (rich.data) inserted = rich.data as BookingRecord
    if (!inserted) {
      const fallback = await supabase.from('bookings').insert({ guest_name: richPayload.guest_name, check_in: richPayload.check_in, check_out: richPayload.check_out, price_per_night: richPayload.price_per_night, villa_id: richPayload.villa_id }).select('*').single()
      if (fallback.data) inserted = fallback.data as BookingRecord
    }
    if (inserted) {
      setBookings((curr) => [{ ...inserted, source: inserted.source || form.source, status: inserted.status || 'Confirmed', notes: inserted.notes || form.notes }, ...curr])
      setSelectedBookingId(inserted.id)
      setSelectedDate(inserted.check_in)
      setViewDate(new Date(inserted.check_in))
    }
    setForm(EMPTY_FORM)
    setModalOpen(false)
    setSaving(false)
  }

  if (!villaId || !canAccessVilla(currentUser, villaId)) return <div style={sx.loading}>You do not have access to this villa.</div>
  if (!villa) return <div style={sx.loading}>Loading villa dashboard...</div>

  return (
    <div style={sx.page}>
      <header style={sx.header}>
        <div style={sx.headerLeft}>
          <Link href="/villas" style={sx.back}>{'<'} Back</Link>
          <div>
            <h1 style={sx.title}>{villa.name}</h1>
            <div style={sx.status}><span style={{ ...sx.dot, background: statusColor }} />{isInvestor ? 'Investor villa view' : status}</div>
          </div>
        </div>
        {!isInvestor ? (
          <div style={sx.headerRight}>
            <div style={sx.filters}>
              <select value={dateRange} onChange={(e) => setDateRange(e.target.value as DateRange)} style={sx.input}><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option><option value="ytd">YTD</option><option value="all">All time</option></select>
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={sx.input}><option value="all">All Categories</option>{Array.from(new Set(expenses.map((e) => e.category || 'other'))).map((c) => <option key={c} value={c}>{c}</option>)}</select>
              <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} style={sx.input}><option value="all">All Vendors</option>{vendors.map((v) => <option key={v} value={v}>{v}</option>)}</select>
              <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} style={sx.input}><option value="IDR">IDR</option><option value="USD">USD</option><option value="EUR">EUR</option></select>
            </div>
            <Stat label="Occupancy" value={pct(occupancy)} />
            <Stat label="ADR" value={money(adr)} />
          </div>
        ) : null}
      </header>

      {isInvestor ? (
        <section style={sx.investorHero}>
          <div style={sx.investorHeroCopy}>
            <div style={sx.investorEyebrow}>Assigned Villa</div>
            <h2 style={sx.investorHeroTitle}>{villa.name}</h2>
            <p style={sx.investorHeroText}>A cleaner investor view of revenue, bookings, cost control, and operating health for this villa.</p>
            <div style={sx.investorHeroControls}>
              <select value={dateRange} onChange={(e) => setDateRange(e.target.value as DateRange)} style={sx.investorInput}><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option><option value="ytd">YTD</option><option value="all">All time</option></select>
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={sx.investorInput}><option value="all">All Categories</option>{Array.from(new Set(expenses.map((e) => e.category || 'other'))).map((c) => <option key={c} value={c}>{c}</option>)}</select>
              <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} style={sx.investorInput}><option value="all">All Vendors</option>{vendors.map((v) => <option key={v} value={v}>{v}</option>)}</select>
              <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} style={sx.investorInput}><option value="IDR">IDR</option><option value="USD">USD</option><option value="EUR">EUR</option></select>
            </div>
            {investorHeroImage ? (
              <div style={sx.investorHeroMedia}>
                <Image src={investorHeroImage} alt={`${villa.name} hero`} fill unoptimized sizes="(max-width: 900px) 100vw, 42vw" style={sx.investorHeroMediaImage} />
                <div style={sx.investorHeroMediaOverlay} />
                <div style={sx.investorHeroMediaCaption}>
                  <span style={sx.investorHeroMediaTag}>Signature View</span>
                  <strong style={sx.investorHeroMediaTitle}>{villa.name}</strong>
                </div>
              </div>
            ) : null}
          </div>
          <div style={sx.investorHeroSignals}>
            <div style={{ ...sx.investorSignalCard, ...sx.investorSignalPrimary }}>
              <div style={sx.investorSignalLabel}>{dateRange === 'ytd' ? 'Annualized Revenue' : 'Revenue'}</div>
              <div style={sx.investorSignalValue}>{moneyCompact(dateRange === 'ytd' ? annualizedRevenue : totalRevenue)}</div>
              <div style={sx.investorSignalSubtext}>
                {dateRange === 'ytd' ? `YTD actual ${moneyCompact(totalRevenue)}` : `${dateRange.toUpperCase()} in ${currency}`}
              </div>
            </div>
            <div style={{ ...sx.investorSignalCard, ...sx.investorSignalWarm }}>
              <div style={sx.investorSignalLabel}>{dateRange === 'ytd' ? 'Annualized Net Profit' : 'Net Profit'}</div>
              <div style={sx.investorSignalValue}>{moneyCompact(dateRange === 'ytd' ? annualizedProfit : profit)}</div>
              <div style={sx.investorSignalSubtext}>
                {dateRange === 'ytd' ? `${pct(100 - expenseRatio)} retained, YTD actual ${moneyCompact(profit)}` : `${pct(100 - expenseRatio)} retained after operating cost`}
              </div>
            </div>
            <div style={sx.investorMiniSignalRow}>
              <div style={sx.investorMiniSignalCard}>
                <div style={sx.investorMiniSignalLabel}>Occupancy</div>
                <div style={sx.investorMiniSignalValue}>{pct(occupancy)}</div>
                <div style={sx.investorMiniSignalSubtext}>{scopeDays} days in scope</div>
              </div>
              <div style={sx.investorMiniSignalCard}>
                <div style={sx.investorMiniSignalLabel}>ADR</div>
                <div style={sx.investorMiniSignalValue}>{moneyCompact(adr)}</div>
                <div style={sx.investorMiniSignalSubtext}>Cost / night {moneyCompact(costPerNight)}</div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section style={sx.kpis}>
        <Kpi title="Total Cost" value={moneyCompact(totalCost)} sub={`Prev ${moneyCompact(previousExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0))}`} onClick={() => setCategoryFilter('all')} active={categoryFilter === 'all'} />
        <Kpi title="Cost per Night" value={moneyCompact(costPerNight)} sub={`ADR ${moneyCompact(adr)}`} onClick={() => setGranularity('day')} />
        <Kpi title="Cost per Booking" value={moneyCompact(costPerBooking)} sub={`${filteredBookings.length} stays`} onClick={() => setSelectedBookingId(filteredBookings[0]?.id || null)} />
        {showProfit ? (
          <>
            <Kpi title="Profit" value={moneyCompact(profit)} sub={`Expense ratio ${pct(expenseRatio)}`} onClick={() => setGranularity('week')} />
            <Kpi title="Expense Ratio" value={pct(expenseRatio)} sub="Target under 60%" />
          </>
        ) : (
          <Kpi title="Bookings" value={`${filteredBookings.length}`} sub="Operational view only" />
        )}
        <Kpi title="Maintenance" value={moneyCompact(maintenanceCost)} sub="Drill into maintenance" onClick={() => setCategoryFilter('maintenance')} active={categoryFilter === 'maintenance'} />
        <Kpi title="Cleaning" value={moneyCompact(cleaningCost)} sub="Drill into cleaning" onClick={() => setCategoryFilter('cleaning')} active={categoryFilter === 'cleaning'} />
        <Kpi title="Staff" value={moneyCompact(staffCost)} sub="Operational payroll" onClick={() => setCategoryFilter('staff')} active={categoryFilter === 'staff'} />
      </section>

      <section style={sx.topGrid}>
        <div style={sx.panel}>
          <div style={sx.row}><div style={sx.row}><button type="button" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))} style={sx.icon}>‹</button><strong>{monthName(viewDate)}</strong><button type="button" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))} style={sx.icon}>›</button></div><button type="button" style={sx.ghost}>Month {'▾'}</button></div>
          <div style={sx.week}>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d} style={sx.weekCell}>{d}</span>)}</div>
          <div style={sx.calendar}>
            {calendarDays.map((date) => {
              const key = iso(date)
              const metric = daily[key]
              const currentMonth = date.getMonth() === viewDate.getMonth()
              const bg = metric?.bookings.length ? (metric.profit >= 0 ? 'rgba(24,194,156,0.22)' : 'rgba(239,68,68,0.22)') : 'rgba(255,255,255,0.03)'
              return <button key={key} type="button" title={`Revenue ${money(metric?.revenue || 0)} | Cost ${money(metric?.expenses || 0)} | Profit ${money(metric?.profit || 0)}`} onClick={() => { setSelectedDate(key); setSelectedBookingId(metric?.bookings[0]?.id || null) }} style={{ ...sx.day, background: bg, opacity: currentMonth ? 1 : 0.45, borderColor: selectedDate === key ? 'rgba(24,194,156,0.8)' : 'rgba(255,255,255,0.07)' }}><span>{date.getDate()}</span><span style={{ color: metric?.profit && metric.profit < 0 ? '#fecaca' : '#ccfbf1' }}>{metric?.bookings.length ? showProfit ? money(metric.profit) : `${metric.bookings.length} stay` : 'No stay'}</span></button>
            })}
          </div>
        </div>

        <aside style={sx.panel}>
          <div style={sx.row}><strong>Booking Panel</strong>{canEdit && <button type="button" onClick={() => setModalOpen(true)} style={sx.primary}>+ Add Booking</button>}</div>
          {selectedBooking ? <div style={sx.bookingCol}><div style={sx.row}><div><div style={sx.label}>Guest</div><div style={sx.big}>{selectedBooking.guest_name}</div></div><span style={sx.badge}>{selectedBooking.status || 'Confirmed'}</span></div><div style={sx.metaGrid}><Meta label="Dates" value={`${new Date(selectedBooking.check_in).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${new Date(selectedBooking.check_out).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`} /><Meta label="Nights" value={`${nights(selectedBooking)}`} /><Meta label="Total" value={money(revenue(selectedBooking))} /><Meta label="Source" value={selectedBooking.source || 'Manual'} /></div><div style={sx.profitBox}><div style={sx.smallTitle}>{showProfit ? 'Booking Profitability' : 'Booking Cost Summary'}</div><Sum label="Revenue" value={money(revenue(selectedBooking))} /><Sum label="Cleaning" value={`-${money(selectedBookingExpenses.filter((e) => e.category === 'cleaning').reduce((s, e) => s + (Number(e.amount) || 0), 0))}`} /><Sum label="Utilities" value={`-${money(selectedBookingExpenses.filter((e) => e.category === 'utilities').reduce((s, e) => s + (Number(e.amount) || 0), 0))}`} />{showProfit ? <Sum label="Net" value={money(selectedBookingNet)} strong /> : <Sum label="Expense Load" value={money(selectedBookingExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0))} strong />}</div>{canEdit && <div style={sx.actions}><button type="button" style={sx.ghost}>Edit</button><button type="button" style={sx.ghost}>Cancel</button><button type="button" style={sx.ghost}>Extend</button></div>}</div> : <div style={sx.empty}><strong>No booking selected</strong><p style={sx.emptyText}>Pick a day from the calendar to inspect the active stay and its linked expenses.</p></div>}
        </aside>
      </section>

      <section style={sx.panel}>
        <div style={sx.row}><strong>{isInvestor ? 'Performance Trend' : 'Revenue vs Cost vs Profit'}</strong><div style={sx.row}>{(['day', 'week', 'month'] as Granularity[]).map((g) => <button key={g} type="button" onClick={() => setGranularity(g)} style={granularity === g ? sx.toggleOn : sx.toggle}>{g}</button>)}</div></div>
        <div style={sx.chartGrid}>
          <div style={{ minHeight: 320 }}>
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={chartData}>
                <CartesianGrid stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="label" stroke="#8da2be" />
                <YAxis stroke="#8da2be" tickFormatter={(value) => money(Number(value))} />
                <Tooltip formatter={(value) => money(Number(value))} />
                <Legend />
                <Line type="monotone" dataKey="revenue" stroke={isInvestor ? '#c6a96b' : '#18c29c'} strokeWidth={3} dot={false} />
                <Line type="monotone" dataKey="cost" stroke="#f97316" strokeWidth={2} dot={false} />
                {showProfit && <Line type="monotone" dataKey="profit" stroke={isInvestor ? '#18c29c' : '#60a5fa'} strokeWidth={2.5} dot={false} />}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={sx.metrics}><Metric label="Efficiency" value={pct(100 - expenseRatio)} /><Metric label="Cost per Guest" value={money(costPerBooking)} /><Metric label="Cost per Stay" value={money(costPerBooking)} /><Metric label="Turnover Cost" value={money(cleaningCost + maintenanceCost)} /></div>
        </div>
      </section>

      <section style={sx.bottomGrid}>
        {showExpenseBreakdown && <div style={sx.panel}>
          <div style={sx.row}><strong>Expenses</strong><span style={sx.hint}>Click to filter</span></div>
          <div style={sx.list}>
            {categories.map((c) => <button key={c.name} type="button" onClick={() => setCategoryFilter(c.name)} style={{ ...sx.listRow, borderColor: categoryFilter === c.name ? 'rgba(249,115,22,0.7)' : 'rgba(255,255,255,0.08)' }}><div><div style={{ textTransform: 'capitalize' as const }}>{c.name}</div><div style={sx.trend}>{c.trend >= 0 ? 'Up' : 'Down'} {pct(Math.abs(c.trend))}</div></div><div style={{ textAlign: 'right' as const }}><div>{pct(c.percentage)}</div><strong>{money(c.value)}</strong></div></button>)}
          </div>
          <div style={{ height: 240, marginTop: 18 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={categories} dataKey="value" nameKey="name" innerRadius={48} outerRadius={84}>{categories.map((c, i) => <Cell key={c.name} fill={COLORS[i % COLORS.length]} />)}</Pie>
                <Tooltip formatter={(value) => money(Number(value))} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>}
        {showAlerts && <div style={sx.panel}>
          <div style={sx.row}><strong>Alerts</strong><span style={sx.hint}>Click to jump</span></div>
          <div style={sx.list}>{alerts.length ? alerts.map((a) => <button key={a.text} type="button" onClick={a.action} style={sx.alert}><span style={sx.mark}>!</span>{a.text}</button>) : <div style={sx.empty}>No active alerts for this villa.</div>}</div>
        </div>}
      </section>

      <section style={sx.panel}>
        <div style={sx.row}><strong>Transactions</strong><div style={sx.row}><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search note, vendor, category..." style={sx.input} /><button type="button" onClick={() => {
          const csv = [showVendorDetails ? 'Date,Category,Vendor,Amount,Note' : 'Date,Category,Amount,Note', ...transactions.map((t) => showVendorDetails ? [t.date || '', t.category || '', t.vendorLabel, Number(t.amount || 0).toFixed(0), (t.note || '').replace(/,/g, ';')].join(',') : [t.date || '', t.category || '', Number(t.amount || 0).toFixed(0), (t.note || '').replace(/,/g, ';')].join(','))].join('\n')
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = 'villa-transactions.csv'
          a.click()
          URL.revokeObjectURL(url)
        }} style={sx.ghost}>Export</button></div></div>
        <div style={sx.table}><div style={showVendorDetails ? sx.head : sx.headNoVendor}><span>Date</span><span>Category</span>{showVendorDetails && <span>Vendor</span>}<span>Amount</span><span>Note</span></div>{transactions.map((t) => <div key={t.id} style={showVendorDetails ? sx.tr : sx.trNoVendor}><span>{t.date || '—'}</span><span>{t.category || 'other'}</span>{showVendorDetails && <span>{t.vendorLabel}</span>}<span>{money(Number(t.amount) || 0)}</span><span>{t.note || '—'}</span></div>)}</div>
      </section>

      {canEdit && modalOpen && <div style={sx.scrim}><div style={sx.modal}><div style={sx.row}><strong>Add Booking</strong><button type="button" onClick={() => setModalOpen(false)} style={sx.icon}>×</button></div><div style={sx.formGrid}><Field label="Check-in"><input type="date" value={form.checkIn} onChange={(e) => setForm((s) => ({ ...s, checkIn: e.target.value }))} style={sx.input} /></Field><Field label="Check-out"><input type="date" value={form.checkOut} onChange={(e) => setForm((s) => ({ ...s, checkOut: e.target.value }))} style={sx.input} /></Field><Field label="Guest Name"><input value={form.guestName} onChange={(e) => setForm((s) => ({ ...s, guestName: e.target.value }))} style={sx.input} /></Field><Field label="Nightly Rate"><input value={form.price} onChange={(e) => setForm((s) => ({ ...s, price: e.target.value }))} style={sx.input} /></Field><Field label="Source"><select value={form.source} onChange={(e) => setForm((s) => ({ ...s, source: e.target.value }))} style={sx.input}><option value="Manual">Manual</option><option value="Airbnb">Airbnb</option><option value="Booking.com">Booking.com</option><option value="Direct">Direct</option></select></Field><Field label="Notes"><textarea value={form.notes} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} style={{ ...sx.input, minHeight: 110, resize: 'vertical' as const }} /></Field></div><div style={sx.actions}><button type="button" onClick={() => setModalOpen(false)} style={sx.ghost}>Cancel</button><button type="button" onClick={() => void saveBooking()} style={sx.primary}>{saving ? 'Saving...' : 'Save Booking'}</button></div></div></div>}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) { return <div style={sx.stat}><span style={sx.statLabel}>{label}</span><strong>{value}</strong></div> }
function Kpi({ title, value, sub, onClick, active }: { title: string; value: string; sub: string; onClick?: () => void; active?: boolean }) { return <button type="button" onClick={onClick} title={sub} style={{ ...sx.kpi, borderColor: active ? 'rgba(24,194,156,0.7)' : 'rgba(255,255,255,0.08)' }}><span style={sx.kpiTitle}>{title}</span><strong style={sx.kpiValue} title={value}>{value}</strong><span style={sx.kpiSub}>{sub}</span></button> }
function Meta({ label, value }: { label: string; value: string }) { return <div><div style={sx.label}>{label}</div><strong>{value}</strong></div> }
function Sum({ label, value, strong }: { label: string; value: string; strong?: boolean }) { return <div style={{ ...sx.sum, ...(strong ? sx.sumStrong : {}) }}><span>{label}</span><strong>{value}</strong></div> }
function Metric({ label, value }: { label: string; value: string }) { return <div style={sx.metric}><span style={sx.label}>{label}</span><strong>{value}</strong></div> }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label style={sx.field}><span>{label}</span>{children}</label> }

const sx = {
  page: { minHeight: '100vh', padding: 32, color: '#f8fafc', background: 'radial-gradient(circle at top left, rgba(24,194,156,0.12), transparent 28%), radial-gradient(circle at top right, rgba(198,169,107,0.10), transparent 24%), linear-gradient(180deg, #08111f 0%, #0d1729 100%)', display: 'flex', flexDirection: 'column' as const, gap: 24 },
  loading: { minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#08111f', color: '#f8fafc' },
  header: { minHeight: 64, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, padding: '22px 24px', borderRadius: 24, background: 'linear-gradient(180deg, rgba(8,17,31,0.92), rgba(10,18,33,0.88))', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(18px)', boxShadow: '0 20px 44px rgba(2,6,23,0.24), inset 0 1px 0 rgba(255,255,255,0.03)', flexWrap: 'wrap' as const },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 18 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' as const, marginLeft: 'auto' },
  back: { color: '#9ae6d6', textDecoration: 'none', fontSize: 14, padding: '10px 14px', borderRadius: 999, border: '1px solid rgba(154,230,214,0.26)' },
  title: { margin: 0, fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em' }, status: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, color: '#c6d0e1', fontSize: 14 }, dot: { width: 10, height: 10, borderRadius: 999 },
  investorHero: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.08fr) minmax(360px, 0.92fr)', gap: 20, padding: 26, borderRadius: 28, border: '1px solid rgba(198,169,107,0.18)', background: 'radial-gradient(circle at top right, rgba(24,194,156,0.14), transparent 26%), radial-gradient(circle at top left, rgba(198,169,107,0.08), transparent 22%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(8,17,31,0.94))', boxShadow: '0 20px 46px rgba(2,6,23,0.24), inset 0 1px 0 rgba(255,255,255,0.04)' },
  investorHeroCopy: { display: 'grid', alignContent: 'center' as const, gap: 12, minHeight: 160 },
  investorEyebrow: { fontSize: 12, textTransform: 'uppercase' as const, letterSpacing: '0.12em', color: '#c6a96b' },
  investorHeroTitle: { margin: 0, fontSize: 38, lineHeight: 1.02, letterSpacing: '-0.05em', fontWeight: 620 },
  investorHeroText: { margin: 0, color: '#adc1d8', fontSize: 15, lineHeight: 1.65, maxWidth: 520 },
  investorHeroControls: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginTop: 10 },
  investorInput: { minWidth: 130, width: '100%', padding: '13px 14px', borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(16,28,49,0.92)', color: '#f8fafc', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)' },
  investorHeroMedia: { position: 'relative' as const, minHeight: 240, marginTop: 6, overflow: 'hidden', borderRadius: 24, border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 24px 56px rgba(2,6,23,0.28), inset 0 1px 0 rgba(255,255,255,0.04)' },
  investorHeroMediaImage: { objectFit: 'cover' as const, objectPosition: 'center center' as const },
  investorHeroMediaOverlay: { position: 'absolute' as const, inset: 0, background: 'linear-gradient(180deg, rgba(7,12,20,0.04), rgba(7,12,20,0.18) 36%, rgba(7,12,20,0.72) 100%)' },
  investorHeroMediaCaption: { position: 'absolute' as const, left: 18, right: 18, bottom: 18, display: 'grid', gap: 6 },
  investorHeroMediaTag: { display: 'inline-flex', width: 'fit-content', padding: '6px 10px', borderRadius: 999, background: 'rgba(8,17,31,0.62)', border: '1px solid rgba(255,255,255,0.12)', color: '#e8eff8', fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.1em', backdropFilter: 'blur(10px)' },
  investorHeroMediaTitle: { fontSize: 22, lineHeight: 1.05, letterSpacing: '-0.03em', color: '#f9fbff', textShadow: '0 8px 28px rgba(2,6,23,0.45)' },
  investorHeroSignals: { display: 'grid', gap: 14, alignContent: 'stretch' as const },
  investorSignalCard: { minHeight: 164, padding: 22, borderRadius: 24, border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 12, alignContent: 'space-between' as const, boxShadow: '0 18px 42px rgba(2,6,23,0.22), inset 0 1px 0 rgba(255,255,255,0.04)' },
  investorSignalPrimary: { background: 'linear-gradient(180deg, rgba(19,29,42,0.96), rgba(12,20,32,0.92))', borderColor: 'rgba(255,255,255,0.08)' },
  investorSignalWarm: { background: 'linear-gradient(180deg, rgba(11,38,37,0.94), rgba(8,18,28,0.92))', borderColor: 'rgba(24,194,156,0.16)' },
  investorSignalLabel: { fontSize: 12, textTransform: 'uppercase' as const, letterSpacing: '0.1em', color: '#9fb2c8' },
  investorSignalValue: { fontSize: 'clamp(30px, 2.4vw, 44px)', lineHeight: 1, letterSpacing: '-0.05em', fontWeight: 720, color: '#f5f8fd' },
  investorSignalSubtext: { color: '#c5d2e2', fontSize: 13, lineHeight: 1.55 },
  investorMiniSignalRow: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 },
  investorMiniSignalCard: { padding: 18, borderRadius: 20, border: '1px solid rgba(255,255,255,0.07)', background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(10,18,31,0.88))', display: 'grid', gap: 10 },
  investorMiniSignalLabel: { fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.1em', color: '#9fb2c8' },
  investorMiniSignalValue: { fontSize: 'clamp(24px, 1.8vw, 32px)', lineHeight: 1, letterSpacing: '-0.04em', fontWeight: 680, color: '#eef6ff' },
  investorMiniSignalSubtext: { color: '#b9c7d8', fontSize: 12, lineHeight: 1.45 },
  filters: { display: 'flex', gap: 10, padding: 10, borderRadius: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', flexWrap: 'wrap' as const },
  stat: { minWidth: 90, padding: '10px 14px', borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column' as const, gap: 4 }, statLabel: { fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: '#8da2be' },
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }, kpi: { appearance: 'none' as const, textAlign: 'left' as const, padding: 20, borderRadius: 22, background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))', border: '1px solid rgba(255,255,255,0.08)', color: '#f8fafc', cursor: 'pointer', display: 'flex', flexDirection: 'column' as const, gap: 12 }, kpiTitle: { fontSize: 12, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: '#8da2be' }, kpiValue: { fontSize: 28, fontWeight: 700 }, kpiSub: { fontSize: 13, color: '#d5dfed', lineHeight: 1.5 },
  topGrid: { display: 'grid', gridTemplateColumns: 'minmax(0, 2.2fr) minmax(320px, 1fr)', gap: 20, alignItems: 'stretch' }, bottomGrid: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(300px, 0.8fr)', gap: 20 }, chartGrid: { display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 0.9fr)', gap: 18 },
  panel: { padding: 24, borderRadius: 26, background: 'rgba(8,17,31,0.88)', border: '1px solid rgba(255,255,255,0.08)' }, row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const },
  week: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 10, marginTop: 18, marginBottom: 12 }, weekCell: { fontSize: 12, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: '#8da2be', textAlign: 'center' as const },
  calendar: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 10, minHeight: 470 }, day: { minHeight: 82, borderRadius: 18, border: '1px solid rgba(255,255,255,0.06)', padding: '12px 10px', color: '#f8fafc', cursor: 'pointer', display: 'flex', flexDirection: 'column' as const, justifyContent: 'space-between', textAlign: 'left' as const },
  icon: { width: 36, height: 36, borderRadius: 999, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#f8fafc', cursor: 'pointer' }, ghost: { padding: '10px 14px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)', color: '#f8fafc', cursor: 'pointer' }, primary: { padding: '11px 16px', borderRadius: 999, border: 'none', background: 'linear-gradient(135deg, #18c29c, #0ea5e9)', color: '#02131f', fontWeight: 700, cursor: 'pointer' },
  bookingCol: { display: 'flex', flexDirection: 'column' as const, gap: 18, minHeight: 470 }, label: { display: 'block', marginBottom: 6, fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: '#8da2be' }, big: { fontSize: 22, fontWeight: 700 }, badge: { padding: '8px 12px', borderRadius: 999, background: 'rgba(24,194,156,0.18)', color: '#b6f7ea', fontSize: 13 }, metaGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }, profitBox: { padding: 18, borderRadius: 20, background: 'linear-gradient(180deg, rgba(24,194,156,0.12), rgba(255,255,255,0.03))', border: '1px solid rgba(24,194,156,0.16)' }, smallTitle: { marginBottom: 14, fontSize: 14, fontWeight: 700 }, sum: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', color: '#dce7f5' }, sumStrong: { marginTop: 8, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.08)', fontWeight: 700 }, actions: { display: 'flex', flexWrap: 'wrap' as const, gap: 10, marginTop: 'auto' as const }, empty: { padding: 24, borderRadius: 20, border: '1px dashed rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.02)' }, emptyText: { margin: '8px 0 0 0', color: '#b7c5d9', lineHeight: 1.6 },
  toggle: { padding: '8px 12px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: '#c7d3e2', cursor: 'pointer' }, toggleOn: { padding: '8px 12px', borderRadius: 999, border: '1px solid rgba(24,194,156,0.4)', background: 'rgba(24,194,156,0.18)', color: '#d7fff6', cursor: 'pointer' }, metrics: { display: 'grid', gap: 14 }, metric: { padding: 18, borderRadius: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column' as const, gap: 8 },
  hint: { fontSize: 12, color: '#8da2be' }, list: { display: 'grid', gap: 12, marginTop: 18 }, listRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 18, padding: '14px 16px', borderRadius: 18, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', color: '#f8fafc', cursor: 'pointer', textAlign: 'left' as const }, trend: { marginTop: 4, fontSize: 12, color: '#f8c98c' }, alert: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 18, border: '1px solid rgba(249,115,22,0.28)', background: 'rgba(249,115,22,0.08)', color: '#f8fafc', cursor: 'pointer', textAlign: 'left' as const }, mark: { width: 28, height: 28, borderRadius: 999, background: 'rgba(249,115,22,0.16)', display: 'inline-grid', placeItems: 'center', color: '#ffd7a8', fontWeight: 700 },
  table: { display: 'grid', gap: 8, marginTop: 18 }, head: { display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr 0.9fr 1.8fr', gap: 12, padding: '0 14px', color: '#8da2be', fontSize: 12, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }, headNoVendor: { display: 'grid', gridTemplateColumns: '1fr 1fr 0.9fr 1.8fr', gap: 12, padding: '0 14px', color: '#8da2be', fontSize: 12, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }, tr: { display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr 0.9fr 1.8fr', gap: 12, alignItems: 'center', padding: 14, borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', color: '#e6edf8' }, trNoVendor: { display: 'grid', gridTemplateColumns: '1fr 1fr 0.9fr 1.8fr', gap: 12, alignItems: 'center', padding: 14, borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', color: '#e6edf8' },
  scrim: { position: 'fixed' as const, inset: 0, background: 'rgba(1,7,15,0.7)', backdropFilter: 'blur(8px)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 24 }, modal: { width: 'min(760px, 100%)', padding: 24, borderRadius: 26, background: '#091220', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column' as const, gap: 20 }, formGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }, field: { display: 'flex', flexDirection: 'column' as const, gap: 8, fontSize: 13, color: '#c9d4e4' }, input: { minWidth: 130, width: '100%', padding: '12px 14px', borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', background: '#101c31', color: '#f8fafc' },
}

