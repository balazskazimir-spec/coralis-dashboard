
'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Area, CartesianGrid, Cell, ComposedChart, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import BookingList from '@/components/BookingList'
import StaffDashboard from '@/components/staff/StaffDashboard'
import { canSeePortfolio, filterBookingsForUser, filterExpensesForUser, filterVillasForUser } from '@/lib/access'
import { useRole } from '@/components/auth/RoleProvider'
import type { BookingRecord, ExpenseRecord, StaffIssueRecord, StaffTaskRecord, VillaRecord } from '@/lib/types'

type DateRange = '7d' | '30d' | '90d'
type Currency = 'IDR' | 'USD' | 'EUR'
type AlertRow = { id: string; label: string; tone: 'good' | 'warn' | 'danger'; villaId?: string; section: 'ranking' | 'occupancy' | 'expenses' | 'operations'; dateRange?: DateRange }
type DailyPoint = { date: string; revenue: number; cost: number; profit: number; occupancy: number }
type VillaMetric = { id: string; name: string; revenue: number; cost: number; profit: number; occupancy: number; status: 'OK' | 'Watch' | 'Risk'; bookingCount: number }
type GapInfo = { days: number; start: string; end: string }

const DAY_MS = 86_400_000
const PIE_COLORS = ['#c6a96b', '#18c29c', '#f97316', '#ef4444', '#3b82f6']
const CATEGORY_COLORS: Record<string, string> = {
  staff: '#c6a96b',
  cleaning: '#18c29c',
  maintenance: '#f97316',
  utilities: '#3b82f6',
  supplies: '#8b5cf6',
  transport: '#ec4899',
  other: '#94a3b8',
}
const EXCHANGE_RATES: Record<Currency, number> = {
  IDR: 1,
  USD: 0.000064,
  EUR: 0.000059,
}
const DISPLAY_RATES: Record<Currency, { locale: string; code: Currency }> = {
  IDR: { locale: 'id-ID', code: 'IDR' },
  USD: { locale: 'en-US', code: 'USD' },
  EUR: { locale: 'de-DE', code: 'EUR' },
}
const formatPercent = (value: number) => `${value.toFixed(1)}%`
const toIsoDate = (date: Date) => date.toISOString().slice(0, 10)
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
const avg = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0)
const villaLocation = () => 'Lombok'

function getCutoff(range: DateRange) {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - (range === '7d' ? 6 : range === '30d' ? 29 : 89))
  return date
}

function bookingNights(booking: BookingRecord) {
  return Math.max(0, (new Date(booking.check_out).getTime() - new Date(booking.check_in).getTime()) / DAY_MS)
}

function bookingRevenue(booking: BookingRecord) {
  return bookingNights(booking) * (Number(booking.price_per_night) || 0)
}

function buildDailySeries(bookings: BookingRecord[], expenses: ExpenseRecord[], cutoff: Date) {
  const map = new Map<string, DailyPoint>()
  const today = startOfDay(new Date())
  for (let cursor = new Date(cutoff); cursor <= today; cursor.setDate(cursor.getDate() + 1)) {
    map.set(toIsoDate(cursor), { date: toIsoDate(cursor), revenue: 0, cost: 0, profit: 0, occupancy: 0 })
  }

  bookings.forEach((booking) => {
    const nightlyRevenue = Number(booking.price_per_night) || 0
    for (let cursor = new Date(booking.check_in); cursor < new Date(booking.check_out); cursor.setDate(cursor.getDate() + 1)) {
      const row = map.get(toIsoDate(cursor))
      if (!row) continue
      row.revenue += nightlyRevenue
      row.occupancy += 1
    }
  })

  expenses.forEach((expense) => {
    if (!expense.date) return
    const row = map.get(expense.date)
    if (!row) return
    row.cost += Number(expense.amount) || 0
  })

  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date)).map((row) => ({ ...row, profit: row.revenue - row.cost }))
}

function findLongestGap(days: DailyPoint[]) {
  let best: GapInfo | null = null
  let start = ''
  let length = 0

  days.forEach((day, index) => {
    if (day.revenue === 0) {
      if (!length) start = day.date
      length += 1
    }
    if (day.revenue > 0 || index === days.length - 1) {
      const end = day.revenue > 0 ? days[index - 1]?.date ?? start : day.date
      if (length >= 3 && (!best || length > best.days)) best = { days: length, start, end }
      if (day.revenue > 0) {
        start = ''
        length = 0
      }
    }
  })

  return best
}

function PortfolioKpi({
  title,
  value,
  subtext,
  accent,
  chip,
  featured = false,
}: {
  title: string
  value: string
  subtext?: string
  accent: string
  chip: string
  featured?: boolean
}) {
  return (
    <div
      style={{
        ...styles.kpiCard,
        ...(featured ? styles.kpiCardFeatured : null),
        borderColor: accent,
        boxShadow: `0 18px 40px ${accent}22`,
      }}
    >
      <div style={styles.kpiTop}>
        <div style={styles.kpiTitle}>{title}</div>
        <span style={styles.kpiChip}>{chip}</span>
      </div>
      <div style={styles.kpiValue}>{value}</div>
      {subtext ? <div style={styles.kpiSubtext}>{subtext}</div> : null}
    </div>
  )
}

function HeroStat({
  label,
  value,
  subtext,
}: {
  label: string
  value: string
  subtext?: string
}) {
  return (
    <div style={styles.heroStatCard}>
      <div style={styles.heroStatLabel}>{label}</div>
      <div style={styles.heroStatValue}>{value}</div>
      {subtext ? <div style={styles.heroStatSubtext}>{subtext}</div> : null}
    </div>
  )
}

function ExecutiveTrendTooltip({
  active,
  payload,
  label,
  formatCurrency,
}: {
  active?: boolean
  payload?: Array<{ dataKey?: string | number; value?: number | string | null; color?: string }>
  label?: string
  formatCurrency: (value: number) => string
}) {
  if (!active || !payload?.length) {
    return null
  }

  const rows = payload
    .map((entry) => ({
      key: typeof entry.dataKey === 'string' ? entry.dataKey : String(entry.dataKey ?? ''),
      value: Number(entry.value ?? 0),
      color: entry.color || '#94a3b8',
    }))
    .filter((entry) => Number.isFinite(entry.value) && ['revenue', 'cost', 'profit'].includes(entry.key))
    .sort((left, right) => ['profit', 'revenue', 'cost'].indexOf(left.key) - ['profit', 'revenue', 'cost'].indexOf(right.key))

  return (
    <div style={styles.chartTooltip}>
      <div style={styles.chartTooltipLabel}>{label}</div>
      <div style={styles.chartTooltipRows}>
        {rows.map((row) => (
          <div key={row.key} style={{ ...styles.chartTooltipRow, ...(row.key === 'profit' ? styles.chartTooltipProfitRow : null) }}>
            <div style={styles.chartTooltipSeries}>
              <span style={{ ...styles.chartTooltipDot, background: row.color }} />
              <span style={row.key === 'profit' ? styles.chartTooltipProfitKey : styles.chartTooltipKey}>
                {row.key === 'revenue' ? 'Revenue' : row.key === 'cost' ? 'Cost' : 'Profit'}
              </span>
            </div>
            <strong style={row.key === 'profit' ? styles.chartTooltipProfitValue : styles.chartTooltipValue}>
              {formatCurrency(row.value)}
            </strong>
          </div>
        ))}
      </div>
    </div>
  )
}

function ExecutiveTrendChart({
  data,
  formatCurrency,
  formatCompactCurrency,
}: {
  data: Array<{ label: string; revenue: number; cost: number; profit: number }>
  formatCurrency: (value: number) => string
  formatCompactCurrency: (value: number) => string
}) {
  return (
    <div style={styles.executiveChartShell}>
      <div style={styles.executiveChartLegend}>
        <div style={styles.executiveLegendItem}>
          <span style={{ ...styles.executiveLegendDot, background: '#c6a96b' }} />
          <span style={styles.executiveLegendLabel}>Revenue</span>
        </div>
        <div style={styles.executiveLegendItem}>
          <span style={{ ...styles.executiveLegendDot, background: '#f97316' }} />
          <span style={styles.executiveLegendLabel}>Cost</span>
        </div>
        <div style={styles.executiveLegendItem}>
          <span style={{ ...styles.executiveLegendDot, background: '#18c29c' }} />
          <span style={styles.executiveLegendLabel}>Profit</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="ceoRevenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#c6a96b" stopOpacity={0.28} />
              <stop offset="95%" stopColor="#c6a96b" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="ceoCostFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f97316" stopOpacity={0.18} />
              <stop offset="95%" stopColor="#f97316" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(143,163,189,0.12)" vertical={false} />
          <XAxis dataKey="label" stroke="#8fa3bd" tickLine={false} axisLine={false} />
          <YAxis
            stroke="#8fa3bd"
            tickLine={false}
            axisLine={false}
            width={86}
            tickFormatter={(value) => formatCompactCurrency(Number(value))}
          />
          <Tooltip content={<ExecutiveTrendTooltip formatCurrency={formatCurrency} />} />
          <Area type="monotone" dataKey="revenue" stroke="#c6a96b" fill="url(#ceoRevenueFill)" strokeWidth={2.5} />
          <Area type="monotone" dataKey="cost" stroke="#f97316" fill="url(#ceoCostFill)" strokeWidth={2} />
          <Line type="monotone" dataKey="profit" stroke="#18c29c" strokeWidth={3.5} dot={false} activeDot={{ r: 5, strokeWidth: 0 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function Page() {
  const { currentUser } = useRole()
  const [bookings, setBookings] = useState<BookingRecord[]>([])
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([])
  const [villas, setVillas] = useState<VillaRecord[]>([])
  const [taskRows, setTaskRows] = useState<StaffTaskRecord[]>([])
  const [issueRows, setIssueRows] = useState<StaffIssueRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [dateRange, setDateRange] = useState<DateRange>('30d')
  const [selectedVillaIds, setSelectedVillaIds] = useState<string[]>([])
  const [location, setLocation] = useState('all')
  const [currency, setCurrency] = useState<Currency>('IDR')
  const [sortBy, setSortBy] = useState<'profit' | 'revenue' | 'cost' | 'occupancy'>('profit')

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      setLoadError('')
      try {
        const response = await fetch('/api/admin-dashboard', { cache: 'no-store' })
        const payload = (await response.json()) as {
          error?: string
          bookings?: BookingRecord[]
          expenses?: ExpenseRecord[]
          villas?: VillaRecord[]
          taskRows?: StaffTaskRecord[]
          issueRows?: StaffIssueRecord[]
        }

        if (!response.ok) {
          setLoadError(payload.error || 'Failed to load admin dashboard data.')
          setLoading(false)
          return
        }

        setBookings(payload.bookings || [])
        setExpenses(payload.expenses || [])
        setVillas(payload.villas || [])
        setTaskRows(payload.taskRows || [])
        setIssueRows(payload.issueRows || [])
      } catch (error) {
        setLoadError(String(error))
      } finally {
        setLoading(false)
      }
    }
    void loadData()
  }, [])

  const visibleVillas = useMemo(() => filterVillasForUser(villas, currentUser), [currentUser, villas])
  const visibleVillaIds = useMemo(() => new Set(visibleVillas.map((villa) => villa.id)), [visibleVillas])
  const scopedBookings = useMemo(
    () => filterBookingsForUser(bookings, currentUser).filter((booking) => booking.villa_id && visibleVillaIds.has(booking.villa_id)),
    [bookings, currentUser, visibleVillaIds]
  )
  const scopedExpenses = useMemo(
    () => filterExpensesForUser(expenses, currentUser).filter((expense) => expense.villa_id && visibleVillaIds.has(expense.villa_id)),
    [currentUser, expenses, visibleVillaIds]
  )
  const effectiveVillaIds = useMemo(
    () => new Set(selectedVillaIds.length ? selectedVillaIds : visibleVillas.map((villa) => villa.id)),
    [selectedVillaIds, visibleVillas]
  )
  const filteredVillas = useMemo(
    () => visibleVillas.filter((villa) => effectiveVillaIds.has(villa.id) && (location === 'all' || villaLocation() === location)),
    [effectiveVillaIds, location, visibleVillas]
  )
  const filteredVillaIds = useMemo(() => new Set(filteredVillas.map((villa) => villa.id)), [filteredVillas])
  const cutoff = useMemo(() => getCutoff(dateRange), [dateRange])
  const currencyRate = EXCHANGE_RATES[currency]
  const filteredBookings = useMemo(() => {
    const now = new Date()
    return scopedBookings.filter(
      (booking) => booking.villa_id && filteredVillaIds.has(booking.villa_id) && new Date(booking.check_in) >= cutoff && new Date(booking.check_in) <= now
    )
  }, [cutoff, filteredVillaIds, scopedBookings])
  const filteredExpenses = useMemo(
    () => scopedExpenses.filter((expense) => expense.villa_id && expense.date && filteredVillaIds.has(expense.villa_id) && new Date(expense.date) >= cutoff),
    [cutoff, filteredVillaIds, scopedExpenses]
  )
  const scopedTaskRows = useMemo(
    () => taskRows.filter((task) => task.villa_id && filteredVillaIds.has(task.villa_id)),
    [filteredVillaIds, taskRows]
  )
  const scopedIssueRows = useMemo(
    () => issueRows.filter((issue) => issue.villa_id && filteredVillaIds.has(issue.villa_id)),
    [filteredVillaIds, issueRows]
  )

  const formatCurrency = (value: number) => {
    const props = DISPLAY_RATES[currency]
    return new Intl.NumberFormat(props.locale, {
      style: 'currency',
      currency: props.code,
      maximumFractionDigits: currency === 'IDR' ? 0 : 2,
      minimumFractionDigits: currency === 'IDR' ? 0 : 2,
    }).format(value * currencyRate)
  }

  const formatCompactCurrency = (value: number) => {
    const converted = value * currencyRate

    if (currency === 'IDR') {
      const absolute = Math.abs(converted)
      if (absolute >= 1_000_000_000) return `Rp ${(converted / 1_000_000_000).toFixed(2)}B`
      if (absolute >= 1_000_000) return `Rp ${(converted / 1_000_000).toFixed(1)}M`
      return formatCurrency(value)
    }

    const props = DISPLAY_RATES[currency]
    return new Intl.NumberFormat(props.locale, {
      style: 'currency',
      currency: props.code,
      notation: Math.abs(converted) >= 1000 ? 'compact' : 'standard',
      maximumFractionDigits: 1,
    }).format(converted)
  }

  const dailySeries = useMemo(() => buildDailySeries(filteredBookings, filteredExpenses, cutoff), [cutoff, filteredBookings, filteredExpenses])
  const villaSeries = useMemo(
    () =>
      Object.fromEntries(
        filteredVillas.map((villa) => [
          villa.id,
          buildDailySeries(
            filteredBookings.filter((booking) => booking.villa_id === villa.id),
            filteredExpenses.filter((expense) => expense.villa_id === villa.id),
            cutoff
          ),
        ])
      ) as Record<string, DailyPoint[]>,
    [cutoff, filteredBookings, filteredExpenses, filteredVillas]
  )
  const totalRevenue = useMemo(() => filteredBookings.reduce((sum, booking) => sum + bookingRevenue(booking), 0), [filteredBookings])
  const totalCost = useMemo(() => filteredExpenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0), [filteredExpenses])
  const occupiedNights = useMemo(() => filteredBookings.reduce((sum, booking) => sum + bookingNights(booking), 0), [filteredBookings])
  const occupancy = (occupiedNights / Math.max(1, dailySeries.length * Math.max(1, filteredVillas.length))) * 100
  const adr = occupiedNights > 0 ? totalRevenue / occupiedNights : 0
  const revPar = (occupancy / 100) * adr
  const burnRate = dateRange === '7d' ? (totalCost / 7) * 30 : dateRange === '30d' ? totalCost : (totalCost / 90) * 30
  const netProfit = totalRevenue - totalCost
  const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0
  const selectedScopeLabel = selectedVillaIds.length ? `${selectedVillaIds.length} villas selected` : 'All villas in view'
  const rangeLabel = dateRange === '7d' ? 'Last 7 days' : dateRange === '30d' ? 'Last 30 days' : 'Last 90 days'

  const villaMetrics: VillaMetric[] = useMemo(() => filteredVillas.map((villa) => {
    const villaBookings = filteredBookings.filter((booking) => booking.villa_id === villa.id)
    const villaExpenses = filteredExpenses.filter((expense) => expense.villa_id === villa.id)
    const revenue = villaBookings.reduce((sum, booking) => sum + bookingRevenue(booking), 0)
    const cost = villaExpenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0)
    const profit = revenue - cost
    const villaOccupancy = (villaBookings.reduce((sum, booking) => sum + bookingNights(booking), 0) / Math.max(1, dailySeries.length)) * 100
    const status: VillaMetric['status'] = profit < 0 ? 'Risk' : villaOccupancy < 45 || cost > revenue * 0.8 ? 'Watch' : 'OK'
    return {
      id: villa.id,
      name: villa.name,
      revenue,
      cost,
      profit,
      occupancy: villaOccupancy,
      status,
      bookingCount: villaBookings.length,
    }
  }).sort((a, b) => b[sortBy] - a[sortBy]), [dailySeries.length, filteredBookings, filteredExpenses, filteredVillas, sortBy])

  const occupancyTrend = dailySeries.map((row) => ({ label: new Date(row.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), occupancy: filteredVillas.length ? (row.occupancy / filteredVillas.length) * 100 : 0 }))
  const heatmapDays = dailySeries.slice(-35)
  const expenseByCategory = Array.from(filteredExpenses.reduce((map, expense) => map.set(expense.category || 'other', (map.get(expense.category || 'other') || 0) + (Number(expense.amount) || 0)), new Map<string, number>()))
    .map(([name, value]) => ({
      name,
      value,
      percentage: totalCost > 0 ? (value / totalCost) * 100 : 0,
      color: CATEGORY_COLORS[name] || PIE_COLORS[0],
    }))
    .sort((a, b) => b.value - a.value)

  const priorCutoff = new Date(cutoff)
  priorCutoff.setDate(priorCutoff.getDate() - (dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90))
  const priorExpenses = scopedExpenses.filter((expense) => expense.date && expense.villa_id && filteredVillaIds.has(expense.villa_id) && new Date(expense.date) >= priorCutoff && new Date(expense.date) < cutoff)
  const categoryTrends = expenseByCategory.map((row) => {
    const previous = priorExpenses.filter((expense) => (expense.category || 'other') === row.name).reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0)
    return { ...row, trend: previous > 0 ? ((row.value - previous) / previous) * 100 : row.value > 0 ? 100 : 0 }
  })
  const lowOccupancy = filteredVillas.map((villa) => {
    const recent = villaSeries[villa.id].slice(-14)
    return { villa, occupancy: avg(recent.map((day) => day.occupancy * 100)), emptyDays: recent.filter((day) => day.revenue === 0).length }
  }).filter((row) => row.occupancy < 38 && row.emptyDays >= 6).sort((a, b) => a.occupancy - b.occupancy)

  const maintenanceSpike = filteredVillas.map((villa) => {
    const current = filteredExpenses.filter((expense) => expense.villa_id === villa.id && (expense.category || 'other') === 'maintenance').reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0)
    const previous = priorExpenses.filter((expense) => expense.villa_id === villa.id && (expense.category || 'other') === 'maintenance').reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0)
    return { villa, current, trend: previous > 0 ? ((current - previous) / previous) * 100 : current > 0 ? 100 : 0 }
  }).filter((row) => row.current > 0 && row.trend >= 35).sort((a, b) => b.trend - a.trend)[0]

  const leaderVilla = villaMetrics[0] || null
  const topProfitVilla = [...villaMetrics].sort((a, b) => b.profit - a.profit)[0] || null
  const riskCount = villaMetrics.filter((villa) => villa.status === 'Risk').length
  const watchCount = villaMetrics.filter((villa) => villa.status === 'Watch').length
  const costRatio = totalRevenue > 0 ? (totalCost / totalRevenue) * 100 : 0
  const openIssueCount = scopedIssueRows.filter((issue) => issue.status !== 'Resolved').length
  const criticalIssueCount = scopedIssueRows.filter((issue) => issue.status !== 'Resolved' && issue.severity === 'Critical').length
  const openTaskCount = scopedTaskRows.filter((task) => task.status !== 'Done').length
  const blockedTaskCount = scopedTaskRows.filter((task) => task.status === 'Blocked').length

  const gapAlerts = filteredVillas.reduce<Array<{ villa: VillaRecord; gap: GapInfo }>>((rows, villa) => {
    const gap = findLongestGap(villaSeries[villa.id])
    if (gap) rows.push({ villa, gap })
    return rows
  }, []).sort((a, b) => b.gap.days - a.gap.days)

  const alerts: AlertRow[] = [
    ...(criticalIssueCount > 0 ? [{ id: 'critical-issues', label: `${criticalIssueCount} critical issue${criticalIssueCount > 1 ? 's' : ''} need executive attention`, tone: 'danger' as const, section: 'operations' as const }] : []),
    ...(blockedTaskCount > 0 ? [{ id: 'blocked-tasks', label: `${blockedTaskCount} blocked task${blockedTaskCount > 1 ? 's' : ''} are slowing operations`, tone: 'warn' as const, section: 'operations' as const }] : []),
    ...villaMetrics.filter((villa) => villa.profit < 0).slice(0, 2).map((villa) => ({ id: `loss-${villa.id}`, label: `${villa.name} is losing money (${formatCompactCurrency(villa.profit)})`, tone: 'danger' as const, villaId: villa.id, section: 'ranking' as const, dateRange: '30d' as const })),
    ...(maintenanceSpike ? [{ id: `maintenance-${maintenanceSpike.villa.id}`, label: `Maintenance spike at ${maintenanceSpike.villa.name} (+${Math.round(maintenanceSpike.trend)}%)`, tone: 'warn' as const, villaId: maintenanceSpike.villa.id, section: 'expenses' as const, dateRange: '30d' as const }] : []),
    ...lowOccupancy.slice(0, 2).map((row) => ({ id: `occupancy-${row.villa.id}`, label: `${row.villa.name} occupancy is soft (${formatPercent(row.occupancy)}, ${row.emptyDays} empty days)`, tone: 'warn' as const, villaId: row.villa.id, section: 'occupancy' as const, dateRange: '30d' as const })),
    ...gapAlerts.slice(0, 2).map((row) => ({ id: `gap-${row.villa.id}`, label: `${row.villa.name} gap from ${row.gap?.start.slice(5)} to ${row.gap?.end.slice(5)} (${row.gap?.days} days)`, tone: 'warn' as const, villaId: row.villa.id, section: 'occupancy' as const, dateRange: '30d' as const })),
  ]

  const vendors = Array.from(filteredExpenses.reduce((map, expense) => map.set(expense.vendor || expense.note || 'Direct vendor', (map.get(expense.vendor || expense.note || 'Direct vendor') || 0) + (Number(expense.amount) || 0)), new Map<string, number>())).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 5)

  const focusAlert = (alert: AlertRow) => {
    if (alert.dateRange) setDateRange(alert.dateRange)
    if (alert.villaId) setSelectedVillaIds([alert.villaId])
    document.getElementById(alert.section)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const toggleVilla = (villaId: string) => {
    setSelectedVillaIds((current) => {
      if (!current.length) return visibleVillas.map((villa) => villa.id).filter((id) => id !== villaId)
      if (current.includes(villaId)) {
        const next = current.filter((id) => id !== villaId)
        return !next.length || next.length === visibleVillas.length ? [] : next
      }
      const next = [...current, villaId]
      return next.length === visibleVillas.length ? [] : next
    })
  }

  if (currentUser.role === 'staff') {
    return <StaffDashboard />
  }

  if (loading && currentUser.role === 'admin') {
    return (
      <div style={styles.page}>
        <div style={styles.panelGold}>
          <div style={styles.sectionHeader}>
            <div>
              <div style={styles.brand}>Coralis Dashboard</div>
              <h2 style={styles.sectionTitle}>Loading portfolio data</h2>
              <div style={styles.subtle}>The admin dashboard is pulling live villas, bookings, expenses, tasks, and issues.</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!canSeePortfolio(currentUser.role)) {
    const fallbackMonthly = Array.from(filteredBookings.reduce((map, booking) => map.set(booking.check_in.slice(0, 7), (map.get(booking.check_in.slice(0, 7)) || 0) + bookingRevenue(booking)), new Map<string, number>())).map(([month, revenue]) => ({ month, revenue }))
    return (
      <div style={styles.page}>
        <div style={styles.header}><div><div style={styles.brand}>Coralis Dashboard</div><h1 style={styles.title}>Assigned Portfolio</h1></div></div>
        <div style={styles.kpiGrid}>
          <PortfolioKpi title="Revenue" value={formatCompactCurrency(totalRevenue)} subtext={formatCurrency(totalRevenue)} accent="#c6a96b" chip="Revenue" featured />
          <PortfolioKpi title="Expenses" value={formatCompactCurrency(totalCost)} subtext={formatCurrency(totalCost)} accent="#ef4444" chip="Cost" featured />
          <PortfolioKpi title="Occupied Nights" value={occupiedNights.toString()} subtext={rangeLabel} accent="#60a5fa" chip="Demand" />
          <PortfolioKpi title="ADR" value={formatCompactCurrency(adr)} subtext={formatCurrency(adr)} accent="#18c29c" chip="Rate" />
        </div>
        <div style={styles.twoColumn}>
          <div style={styles.panel}><div style={styles.sectionHeader}><h2 style={styles.sectionTitle}>Revenue Trend</h2></div><ResponsiveContainer width="100%" height={280}><LineChart data={fallbackMonthly}><CartesianGrid stroke="rgba(255,255,255,0.08)" /><XAxis dataKey="month" stroke="#8fa3bd" /><YAxis stroke="#8fa3bd" /><Tooltip formatter={(value) => formatCurrency(Number(value))} /><Line type="monotone" dataKey="revenue" stroke="#18c29c" strokeWidth={3} dot={false} /></LineChart></ResponsiveContainer></div>
          <div style={styles.panel}><div style={styles.sectionHeader}><h2 style={styles.sectionTitle}>Assigned Bookings</h2></div><BookingList bookings={filteredBookings} nights={bookingNights} /></div>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      {loadError ? <div style={styles.emptyState}>{loadError}</div> : null}
      <header style={styles.hero}>
        <div style={styles.heroCopyBlock}>
          <div style={styles.brand}>Coralis Dashboard</div>
          <h1 style={styles.title}>Admin / CEO View</h1>
          <p style={styles.copy}>A sharper daily board for yield, drag, occupancy softness, and where the portfolio needs executive attention next.</p>
          <div style={styles.heroMetaRow}>
            <span style={styles.heroMetaChip}>{rangeLabel}</span>
            <span style={styles.heroMetaChip}>{selectedScopeLabel}</span>
            <span style={styles.heroMetaChip}>{currency} reporting</span>
          </div>
        </div>

        <div style={styles.heroControlColumn}>
          <div style={styles.filterPanel}>
            <div style={styles.filterPanelLabel}>Global filters</div>
            <div style={styles.filterBar}>
              <label style={styles.filterField}>
                <span style={styles.filterFieldLabel}>Range</span>
                <select value={dateRange} onChange={(event) => setDateRange(event.target.value as DateRange)} style={styles.select}><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option></select>
              </label>
              <label style={styles.filterField}>
                <span style={styles.filterFieldLabel}>Location</span>
                <select value={location} onChange={(event) => setLocation(event.target.value)} style={styles.select}><option value="all">All Locations</option><option value="Lombok">Lombok</option></select>
              </label>
              <label style={styles.filterField}>
                <span style={styles.filterFieldLabel}>Currency</span>
                <select value={currency} onChange={(event) => setCurrency(event.target.value as Currency)} style={styles.select}><option value="IDR">IDR</option><option value="USD">USD</option><option value="EUR">EUR</option></select>
              </label>
            </div>
          </div>

          <div style={styles.heroStatsGrid}>
            <HeroStat label="Revenue in scope" value={formatCompactCurrency(totalRevenue)} subtext={`${filteredVillas.length} villas active`} />
            <HeroStat label="Net yield" value={formatPercent(profitMargin)} subtext={netProfit >= 0 ? `${formatCompactCurrency(netProfit)} profit` : `${formatCompactCurrency(netProfit)} drag`} />
            <HeroStat label="Watchlist" value={`${riskCount + watchCount}`} subtext={riskCount ? `${riskCount} risk, ${watchCount} watch` : `${watchCount} villas on watch`} />
            <HeroStat label="Operations" value={`${openIssueCount + openTaskCount}`} subtext={criticalIssueCount ? `${criticalIssueCount} critical issue, ${blockedTaskCount} blocked task` : `${openIssueCount} open issues, ${openTaskCount} open tasks`} />
          </div>
        </div>
      </header>

      <section style={styles.scopeBoard}>
        <div style={styles.scopeBoardTop}>
          <div>
            <div style={styles.eyebrow}>Villa scope</div>
            <h2 style={styles.scopeTitle}>{selectedScopeLabel}</h2>
            <div style={styles.subtle}>Use this layer to isolate the handful of villas shaping the current portfolio story.</div>
          </div>
          <div style={styles.scopeActionRow}>
            <button type="button" onClick={() => setSelectedVillaIds([])} style={styles.scopeAction}>All Villas</button>
            <button type="button" onClick={() => setSelectedVillaIds(villaMetrics.slice(0, 3).map((villa) => villa.id))} style={{ ...styles.scopeAction, ...styles.scopeActionStrong }}>Top 3 Focus</button>
          </div>
        </div>

        <div style={styles.scopeSummaryBar}>
          <div style={styles.scopeSummaryItem}>
            <div style={styles.scopeSummaryLabel}>Leading villa</div>
            <div style={styles.scopeSummaryValue}>{leaderVilla?.name || 'No villa in scope'}</div>
          </div>
          <div style={styles.scopeSummaryItem}>
            <div style={styles.scopeSummaryLabel}>Top profit</div>
            <div style={styles.scopeSummaryValue}>{topProfitVilla ? formatCompactCurrency(topProfitVilla.profit) : formatCompactCurrency(0)}</div>
          </div>
          <div style={styles.scopeSummaryItem}>
            <div style={styles.scopeSummaryLabel}>Cost ratio</div>
            <div style={styles.scopeSummaryValue}>{formatPercent(costRatio)}</div>
          </div>
          <div id="operations" style={styles.scopeSummaryItem}>
            <div style={styles.scopeSummaryLabel}>Operations pulse</div>
            <div style={styles.scopeSummaryValue}>{criticalIssueCount > 0 ? `${criticalIssueCount} critical issue${criticalIssueCount > 1 ? 's' : ''}` : blockedTaskCount > 0 ? `${blockedTaskCount} blocked task${blockedTaskCount > 1 ? 's' : ''}` : 'Stable'}</div>
          </div>
        </div>

        <div style={styles.filterGrid}>
          {visibleVillas.map((villa) => {
            const metric = villaMetrics.find((item) => item.id === villa.id)
            const active = !selectedVillaIds.length || selectedVillaIds.includes(villa.id)
            return (
              <button key={villa.id} type="button" onClick={() => toggleVilla(villa.id)} style={{ ...styles.filterCard, borderColor: active ? 'rgba(198,169,107,0.45)' : 'rgba(255,255,255,0.08)', background: active ? 'linear-gradient(180deg, rgba(198,169,107,0.16), rgba(8,13,22,0.96))' : 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(8,13,22,0.94))' }}>
                <div style={styles.filterCardTop}>
                  <span style={{ ...styles.dot, background: metric?.status === 'Risk' ? '#ef4444' : metric?.status === 'Watch' ? '#c6a96b' : '#18c29c' }} />
                  <strong style={styles.filterCardName}>{villa.name}</strong>
                  <span style={{ ...styles.tag, ...(active ? styles.tagActive : styles.tagIdle) }}>{active ? 'Selected' : 'Standby'}</span>
                </div>
                <div style={styles.filterCardStatusRow}>
                  <span style={{ ...styles.miniStatus, ...(metric?.status === 'Risk' ? styles.danger : metric?.status === 'Watch' ? styles.warn : styles.good) }}>{metric?.status || 'OK'}</span>
                  <span style={styles.filterCardMeta}>{metric?.bookingCount ?? 0} bookings in scope</span>
                </div>
                <div style={styles.filterStats}>
                  <span><small style={styles.small}>Profit</small><strong style={styles.filterMetric}>{formatCompactCurrency(metric?.profit ?? 0)}</strong></span>
                  <span><small style={styles.small}>Occ</small><strong style={styles.filterMetric}>{formatPercent(metric?.occupancy ?? 0)}</strong></span>
                  <span><small style={styles.small}>Revenue</small><strong style={styles.filterMetric}>{formatCompactCurrency(metric?.revenue ?? 0)}</strong></span>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      <section style={styles.topInsightGrid}>
        <div style={styles.kpiCluster}>
          <div style={styles.kpiClusterHeader}>
            <div>
              <div style={styles.eyebrow}>Portfolio snapshot</div>
              <h2 style={styles.sectionTitle}>Today&apos;s financial picture</h2>
            </div>
          </div>
          <div style={styles.kpiGrid}>
            <PortfolioKpi title="Total Revenue" value={formatCompactCurrency(totalRevenue)} subtext={`${formatCurrency(totalRevenue)} in ${rangeLabel.toLowerCase()}`} accent="#c6a96b" chip="Revenue" featured />
            <PortfolioKpi title="Total Cost" value={formatCompactCurrency(totalCost)} subtext={`${formatCurrency(totalCost)} operating spend`} accent="#ef4444" chip="Cost" featured />
            <PortfolioKpi title="Net Profit" value={formatCompactCurrency(netProfit)} subtext={`${formatPercent(profitMargin)} portfolio margin`} accent="#18c29c" chip="Yield" featured />
            <PortfolioKpi title="Profit Margin" value={formatPercent(profitMargin)} subtext={`Revenue less cost across ${filteredVillas.length} villas`} accent="#60a5fa" chip="Board" />
            <PortfolioKpi title="Occupancy" value={formatPercent(occupancy)} subtext={`${occupiedNights.toFixed(0)} occupied nights`} accent="#18c29c" chip="Demand" />
            <PortfolioKpi title="ADR" value={formatCompactCurrency(adr)} subtext={formatCurrency(adr)} accent="#c6a96b" chip="Rate" />
            <PortfolioKpi title="RevPAR" value={formatCompactCurrency(revPar)} subtext={formatCurrency(revPar)} accent="#60a5fa" chip="Efficiency" />
            <PortfolioKpi title="Burn Rate" value={formatCompactCurrency(burnRate)} subtext="Estimated monthly burn" accent="#ef4444" chip="Liquidity" />
          </div>
        </div>

        <div style={styles.chartBoard}>
          <div style={styles.sectionHeader}>
            <div>
              <div style={styles.eyebrow}>Momentum</div>
              <h2 style={styles.sectionTitle}>Revenue vs Cost vs Profit</h2>
              <div style={styles.subtle}>Read momentum, compression, and seasonality in one pass.</div>
            </div>
            <div style={styles.rangePills}>{(['7d', '30d', '90d'] as DateRange[]).map((range) => <button key={range} type="button" onClick={() => setDateRange(range)} style={{ ...styles.rangeButton, borderColor: dateRange === range ? '#c6a96b' : 'rgba(255,255,255,0.08)', background: dateRange === range ? 'rgba(198,169,107,0.14)' : 'rgba(255,255,255,0.03)' }}>{range.toUpperCase()}</button>)}</div>
          </div>
          <div style={styles.chartInsightRow}>
            <div style={styles.chartInsightCard}>
              <div style={styles.chartInsightLabel}>Leading villa</div>
              <div style={styles.chartInsightValue}>{leaderVilla?.name || 'No active villa'}</div>
            </div>
            <div style={styles.chartInsightCard}>
              <div style={styles.chartInsightLabel}>Portfolio cost ratio</div>
              <div style={styles.chartInsightValue}>{formatPercent(costRatio)}</div>
            </div>
            <div style={styles.chartInsightCard}>
              <div style={styles.chartInsightLabel}>Monthly burn</div>
              <div style={styles.chartInsightValue}>{formatCompactCurrency(burnRate)}</div>
            </div>
          </div>
          <ExecutiveTrendChart
            data={dailySeries.map((row) => ({
              label: new Date(row.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
              revenue: row.revenue,
              cost: row.cost,
              profit: row.profit,
            }))}
            formatCurrency={formatCurrency}
            formatCompactCurrency={formatCompactCurrency}
          />
        </div>
      </section>

      <section id="ranking" style={styles.panel}>
        <div style={styles.sectionHeader}><div><h2 style={styles.sectionTitle}>Villa Performance</h2><div style={styles.subtle}>Stronger boardroom ranking with status-first scanning.</div></div><div style={styles.rangePills}>{(['profit', 'revenue', 'cost', 'occupancy'] as const).map((key) => <button key={key} type="button" onClick={() => setSortBy(key)} style={{ ...styles.rangeButton, borderColor: sortBy === key ? '#18c29c' : 'rgba(255,255,255,0.08)', background: sortBy === key ? 'rgba(24,194,156,0.14)' : 'rgba(255,255,255,0.03)' }}>{key}</button>)}</div></div>
        <div style={styles.table}><div style={styles.tableHead}><span>Rank</span><span>Villa</span><span>Revenue</span><span>Cost</span><span>Profit</span><span>Occ</span><span>Status</span></div>{villaMetrics.map((villa, index) => <Link key={villa.id} href={`/villas/${villa.id}`} style={styles.tableRow}><span style={styles.rankBadge}>{String(index + 1).padStart(2, '0')}</span><span><strong style={styles.rowName}>{villa.name}</strong><small style={styles.rowMeta}>{villa.bookingCount} bookings</small></span><span>{formatCompactCurrency(villa.revenue)}</span><span>{formatCompactCurrency(villa.cost)}</span><span style={{ color: villa.profit >= 0 ? '#8ef0cf' : '#fecdd3' }}>{formatCompactCurrency(villa.profit)}</span><span>{formatPercent(villa.occupancy)}</span><span style={{ ...styles.statusBadge, ...(villa.status === 'Risk' ? styles.danger : villa.status === 'Watch' ? styles.warn : styles.good) }}>{villa.status}</span></Link>)}</div>
      </section>

      <section id="occupancy" style={styles.twoColumn}>
        <div style={styles.panel}><div style={styles.sectionHeader}><div><h2 style={styles.sectionTitle}>Occupancy Trend</h2><div style={styles.subtle}>Low occupancy now requires sustained softness plus empty nights.</div></div></div><ResponsiveContainer width="100%" height={260}><LineChart data={occupancyTrend}><CartesianGrid stroke="rgba(255,255,255,0.08)" /><XAxis dataKey="label" stroke="#8fa3bd" /><YAxis stroke="#8fa3bd" /><Tooltip formatter={(value) => formatPercent(Number(value))} /><Line type="monotone" dataKey="occupancy" stroke="#18c29c" strokeWidth={3} dot={false} /></LineChart></ResponsiveContainer></div>
        <div style={styles.panel}><div style={styles.sectionHeader}><div><h2 style={styles.sectionTitle}>Calendar Heatmap</h2><div style={styles.subtle}>Gap detection only flags 3+ consecutive zero-revenue days.</div></div></div><div style={styles.heatmap}>{heatmapDays.map((day) => <div key={day.date} title={`${day.date} | Revenue ${formatCurrency(day.revenue)} | Cost ${formatCurrency(day.cost)} | Profit ${formatCurrency(day.profit)}`} style={{ ...styles.heatCell, background: day.revenue === 0 ? 'rgba(255,255,255,0.05)' : day.profit >= 0 ? 'rgba(24,194,156,0.3)' : 'rgba(239,68,68,0.28)' }}><span>{new Date(day.date).getDate()}</span></div>)}</div></div>
      </section>

      <section style={styles.twoColumn}>
        <div id="expenses" style={styles.panel}>
          <div style={styles.sectionHeader}>
            <div>
              <h2 style={styles.sectionTitle}>Expense Breakdown</h2>
              <div style={styles.subtle}>Category drift shows where margin disappears.</div>
            </div>
          </div>
          <div style={styles.expenseLayout}>
            <div style={styles.expenseList}>
              {categoryTrends.map((row) => (
                <div key={row.name} style={styles.expenseRow}>
                  <div style={styles.expenseRowTop}>
                    <div style={styles.expenseNameWrap}>
                      <span style={{ ...styles.expenseColorDot, background: CATEGORY_COLORS[row.name] || '#94a3b8' }} />
                      <div>
                        <div style={styles.expenseName}>{row.name}</div>
                        <div style={{ ...styles.expenseTrend, color: row.trend > 25 ? '#f6c27d' : row.trend < 0 ? '#93c5fd' : '#8fa3bd' }}>
                          {row.trend >= 0 ? 'Up' : 'Down'} {formatPercent(Math.abs(row.trend))}
                        </div>
                      </div>
                    </div>
                    <div style={styles.expenseRight}>
                      <div style={styles.expensePercent}>{formatPercent(row.percentage)}</div>
                      <strong>{formatCompactCurrency(row.value)}</strong>
                    </div>
                  </div>
                  <div style={styles.expenseBarTrack}>
                    <div style={{ ...styles.expenseBarFill, width: `${Math.min(100, row.percentage)}%`, background: CATEGORY_COLORS[row.name] || '#94a3b8' }} />
                  </div>
                </div>
              ))}
            </div>

            <div style={styles.expenseVizCard}>
              <div style={styles.expenseVizHeadline}>Total Cost</div>
              <div style={styles.expenseVizValue}>{formatCompactCurrency(totalCost)}</div>
              <div style={styles.expenseVizSubtle}>{formatCurrency(totalCost)} in {rangeLabel.toLowerCase()}</div>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={expenseByCategory} dataKey="value" nameKey="name" innerRadius={68} outerRadius={94} paddingAngle={3} cornerRadius={8}>
                    {expenseByCategory.map((row) => <Cell key={row.name} fill={row.color} />)}
                  </Pie>
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                </PieChart>
              </ResponsiveContainer>
              <div style={styles.expenseMiniLegend}>
                {expenseByCategory.slice(0, 3).map((row) => (
                  <div key={row.name} style={styles.expenseMiniLegendRow}>
                    <span style={{ ...styles.expenseColorDot, background: row.color }} />
                    <span style={styles.expenseMiniLegendLabel}>{row.name}</span>
                    <strong style={styles.expenseMiniLegendValue}>{formatPercent(row.percentage)}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div style={styles.panel}><div style={styles.sectionHeader}><div><h2 style={styles.sectionTitle}>Alerts</h2><div style={styles.subtle}>Click an alert to focus the affected villa and jump to the right section.</div></div></div><div style={styles.alertList}>{alerts.length ? alerts.map((alert) => <button key={alert.id} type="button" onClick={() => focusAlert(alert)} style={{ ...styles.alertRow, borderColor: alert.tone === 'danger' ? 'rgba(239,68,68,0.4)' : 'rgba(198,169,107,0.45)' }}><small style={styles.alertTone}>{alert.tone === 'danger' ? 'Critical' : alert.tone === 'warn' ? 'Watch' : 'Healthy'}</small><span>{alert.label}</span></button>) : <div style={styles.emptyState}>No critical alerts in the current scope.</div>}</div><div style={styles.sectionHeader}><div><h2 style={styles.sectionTitle}>Top Vendors</h2><div style={styles.subtle}>Quick read on who absorbs the biggest share of spend.</div></div></div><div style={styles.vendorList}>{vendors.map((vendor) => <div key={vendor.name} style={styles.vendorRow}><span>{vendor.name}</span><strong>{formatCurrency(vendor.value)}</strong></div>)}</div></div>
      </section>
    </div>
  )
}

const styles = {
  page: { minHeight: '100vh', padding: 32, color: '#f7fbff', background: 'radial-gradient(circle at top left, rgba(198,169,107,0.18), transparent 28%), radial-gradient(circle at top right, rgba(24,194,156,0.14), transparent 24%), linear-gradient(180deg, #050b14 0%, #0d1729 100%)', display: 'flex', flexDirection: 'column' as const, gap: 24 },
  hero: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(360px, 0.85fr)', gap: 24, padding: 32, borderRadius: 34, background: 'radial-gradient(circle at top right, rgba(24,194,156,0.12), transparent 24%), radial-gradient(circle at top left, rgba(198,169,107,0.12), transparent 26%), linear-gradient(135deg, rgba(10,16,28,0.98), rgba(17,26,43,0.92))', border: '1px solid rgba(198,169,107,0.22)', boxShadow: '0 26px 70px rgba(2,6,23,0.35), inset 0 1px 0 rgba(255,255,255,0.04)' },
  heroCopyBlock: { display: 'flex', flexDirection: 'column' as const, justifyContent: 'space-between' as const, gap: 18 },
  heroControlColumn: { display: 'grid', gap: 16, alignContent: 'start' as const },
  header: { padding: 24, borderRadius: 24, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' },
  brand: { fontSize: 13, textTransform: 'uppercase' as const, letterSpacing: '0.12em', color: '#c6a96b', marginBottom: 8 },
  title: { margin: 0, fontSize: 42, letterSpacing: '-0.05em', maxWidth: 560 },
  copy: { margin: '10px 0 0', color: '#9fb0c6', maxWidth: 560, lineHeight: 1.5 },
  heroMetaRow: { display: 'flex', gap: 10, flexWrap: 'wrap' as const },
  heroMetaChip: { display: 'inline-flex', alignItems: 'center', padding: '9px 13px', borderRadius: 999, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#d4dfed', fontSize: 12, letterSpacing: '0.05em' },
  filterPanel: { padding: 18, borderRadius: 22, background: 'rgba(6,11,19,0.58)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)' },
  filterPanelLabel: { fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.12em', color: '#c6a96b', marginBottom: 12 },
  eyebrow: { color: '#c6a96b', textTransform: 'uppercase' as const, letterSpacing: '0.1em', fontSize: 12, marginBottom: 6 },
  subtle: { color: '#8fa3bd', marginTop: 6, fontSize: 14 },
  filterBar: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 },
  filterField: { display: 'grid', gap: 8 },
  filterFieldLabel: { fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: '#8fa3bd' },
  select: { minWidth: 150, padding: '12px 14px', borderRadius: 14, border: '1px solid rgba(198,169,107,0.24)', background: '#0f1a2b', color: 'white' },
  panel: { padding: 24, borderRadius: 28, background: 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(6,11,19,0.95))', border: '1px solid rgba(255,255,255,0.08)' },
  panelGold: { padding: 28, borderRadius: 30, background: 'radial-gradient(circle at top right, rgba(24,194,156,0.1), transparent 24%), linear-gradient(180deg, rgba(255,255,255,0.05), rgba(6,11,19,0.98))', border: '1px solid rgba(198,169,107,0.18)', boxShadow: '0 22px 58px rgba(2,6,23,0.28), inset 0 1px 0 rgba(255,255,255,0.04)' },
  scopeBoard: { padding: 28, borderRadius: 30, background: 'radial-gradient(circle at top right, rgba(24,194,156,0.1), transparent 24%), linear-gradient(180deg, rgba(255,255,255,0.05), rgba(6,11,19,0.98))', border: '1px solid rgba(198,169,107,0.18)', boxShadow: '0 22px 58px rgba(2,6,23,0.28), inset 0 1px 0 rgba(255,255,255,0.04)' },
  scopeBoardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 18, flexWrap: 'wrap' as const, marginBottom: 18 },
  scopeActionRow: { display: 'flex', gap: 10, flexWrap: 'wrap' as const },
  scopeAction: { padding: '10px 14px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)', color: '#f7fbff', cursor: 'pointer' },
  scopeActionStrong: { borderColor: 'rgba(198,169,107,0.45)', background: 'rgba(198,169,107,0.14)' },
  scopeSummaryBar: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 },
  scopeSummaryItem: { padding: 16, borderRadius: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' },
  scopeSummaryLabel: { fontSize: 11, color: '#8fa3bd', textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 8 },
  scopeSummaryValue: { fontSize: 20, fontWeight: 700, letterSpacing: '-0.03em' },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' as const, marginBottom: 18 },
  sectionTitle: { margin: 0, fontSize: 22, letterSpacing: '-0.03em' },
  scopeTitle: { margin: 0, fontSize: 32, letterSpacing: '-0.05em', color: '#f8fbff' },
  scopeMetaRow: { display: 'flex', gap: 10, flexWrap: 'wrap' as const, marginTop: 14 },
  scopeMetaChip: { display: 'inline-flex', alignItems: 'center', padding: '8px 12px', borderRadius: 999, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#c7d4e6', fontSize: 12, letterSpacing: '0.04em' },
  rangePills: { display: 'flex', gap: 8, flexWrap: 'wrap' as const },
  rangeButton: { padding: '8px 12px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', color: 'white', cursor: 'pointer' },
  filterGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 },
  filterCard: { padding: 18, borderRadius: 22, border: '1px solid rgba(255,255,255,0.08)', color: '#f7fbff', cursor: 'pointer', textAlign: 'left' as const, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)' },
  filterCardTop: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  filterCardName: { fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em' },
  filterCardStatusRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 16, flexWrap: 'wrap' as const },
  filterCardMeta: { color: '#8fa3bd', fontSize: 12 },
  filterStats: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 },
  dot: { width: 10, height: 10, borderRadius: 999, flexShrink: 0 },
  tag: { fontSize: 11, marginLeft: 'auto', color: '#d8c39d', textTransform: 'uppercase' as const, letterSpacing: '0.08em' },
  tagActive: { color: '#f4e6c8' },
  tagIdle: { color: '#8fa3bd' },
  small: { display: 'block', color: '#8fa3bd', textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 6 },
  filterMetric: { display: 'block', fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em' },
  miniStatus: { display: 'inline-flex', justifyContent: 'center', padding: '6px 10px', borderRadius: 999, fontSize: 11, border: '1px solid transparent' },
  topInsightGrid: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.05fr) minmax(0, 1.2fr)', gap: 20, alignItems: 'start' as const },
  kpiCluster: { padding: 24, borderRadius: 28, background: 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(6,11,19,0.95))', border: '1px solid rgba(255,255,255,0.08)' },
  kpiClusterHeader: { marginBottom: 16 },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 18 },
  kpiCard: { minHeight: 188, padding: 22, borderRadius: 24, background: 'radial-gradient(circle at top right, rgba(255,255,255,0.06), transparent 30%), linear-gradient(180deg, rgba(255,255,255,0.05), rgba(7,12,20,0.94))', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column' as const, justifyContent: 'space-between' as const, overflow: 'hidden' },
  kpiCardFeatured: { minHeight: 208, background: 'radial-gradient(circle at top right, rgba(198,169,107,0.14), transparent 30%), linear-gradient(180deg, rgba(255,255,255,0.06), rgba(7,12,20,0.96))' },
  kpiTop: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' },
  kpiTitle: { fontSize: 12, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: '#8fa3bd' },
  kpiChip: { fontSize: 10, padding: '5px 9px', borderRadius: 999, background: 'rgba(255,255,255,0.05)', letterSpacing: '0.08em', color: '#e2e8f0', textTransform: 'uppercase' as const },
  kpiValue: { marginTop: 18, fontSize: 'clamp(30px, 2.6vw, 46px)', fontWeight: 700, letterSpacing: '-0.06em', lineHeight: 1, whiteSpace: 'nowrap' as const },
  kpiSubtext: { marginTop: 14, color: '#c8d3e1', fontSize: 13, lineHeight: 1.5 },
  heroStatsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 },
  heroStatCard: { padding: 16, borderRadius: 18, background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(9,14,24,0.9))', border: '1px solid rgba(255,255,255,0.08)' },
  heroStatLabel: { fontSize: 11, color: '#8fa3bd', textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 10 },
  heroStatValue: { fontSize: 24, fontWeight: 700, letterSpacing: '-0.04em' },
  heroStatSubtext: { marginTop: 8, fontSize: 12, color: '#c8d3e1', lineHeight: 1.5 },
  chartBoard: { padding: 24, borderRadius: 28, background: 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(6,11,19,0.95))', border: '1px solid rgba(255,255,255,0.08)' },
  chartInsightRow: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginBottom: 16 },
  chartInsightCard: { padding: 14, borderRadius: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' },
  chartInsightLabel: { fontSize: 11, color: '#8fa3bd', textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 8 },
  chartInsightValue: { fontSize: 18, fontWeight: 700, letterSpacing: '-0.03em' },
  executiveChartShell: { padding: 20, borderRadius: 24, background: 'radial-gradient(circle at top left, rgba(198,169,107,0.10), transparent 22%), linear-gradient(180deg, rgba(9,14,24,0.96), rgba(10,16,28,0.86))', border: '1px solid rgba(255,255,255,0.06)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)' },
  executiveChartLegend: { display: 'flex', gap: 12, flexWrap: 'wrap' as const, marginBottom: 14 },
  executiveLegendItem: { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 999, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' },
  executiveLegendDot: { width: 10, height: 10, borderRadius: 999, display: 'inline-block' },
  executiveLegendLabel: { fontSize: 12, color: '#d7e1ee' },
  chartTooltip: { minWidth: 220, padding: '14px 15px', borderRadius: 16, background: 'rgba(8,12,22,0.96)', border: '1px solid rgba(255,255,255,0.10)', boxShadow: '0 18px 38px rgba(2,6,23,0.42)' },
  chartTooltipLabel: { fontSize: 13, color: '#f8fbff', fontWeight: 700, marginBottom: 10 },
  chartTooltipRows: { display: 'grid', gap: 8 },
  chartTooltipRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
  chartTooltipProfitRow: { paddingBottom: 8, marginBottom: 2, borderBottom: '1px solid rgba(255,255,255,0.08)' },
  chartTooltipSeries: { display: 'flex', alignItems: 'center', gap: 8 },
  chartTooltipDot: { width: 9, height: 9, borderRadius: 999, display: 'inline-block' },
  chartTooltipKey: { color: '#c6d3e5', fontSize: 12 },
  chartTooltipProfitKey: { color: '#a7f3d0', fontSize: 12, fontWeight: 700 },
  chartTooltipValue: { color: '#f8fbff', fontSize: 12 },
  chartTooltipProfitValue: { color: '#86efac', fontSize: 13 },
  table: { display: 'grid', gap: 10 },
  tableHead: { display: 'grid', gridTemplateColumns: '0.8fr 2fr 1fr 1fr 1fr 0.8fr 0.9fr', gap: 12, padding: '0 14px', color: '#8fa3bd', textTransform: 'uppercase' as const, fontSize: 12, letterSpacing: '0.08em' },
  tableRow: { display: 'grid', gridTemplateColumns: '0.8fr 2fr 1fr 1fr 1fr 0.8fr 0.9fr', gap: 12, padding: 16, borderRadius: 18, background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(12,18,31,0.92))', border: '1px solid rgba(198,169,107,0.14)', color: '#f7fbff', textDecoration: 'none', alignItems: 'center' },
  rankBadge: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 42, height: 42, borderRadius: 14, background: 'linear-gradient(180deg, rgba(198,169,107,0.28), rgba(198,169,107,0.08))', border: '1px solid rgba(198,169,107,0.26)', color: '#f4e6c8', fontWeight: 700 },
  rowName: { display: 'block', fontSize: 16, marginBottom: 4 },
  rowMeta: { display: 'block', color: '#8fa3bd' },
  statusBadge: { display: 'inline-flex', justifyContent: 'center', padding: '7px 10px', borderRadius: 999, fontSize: 12, border: '1px solid transparent' },
  good: { color: '#8ef0cf', background: 'rgba(24,194,156,0.12)', borderColor: 'rgba(24,194,156,0.28)' },
  warn: { color: '#f6c27d', background: 'rgba(198,169,107,0.12)', borderColor: 'rgba(198,169,107,0.24)' },
  danger: { color: '#fecdd3', background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.24)' },
  twoColumn: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(320px, 1fr)', gap: 20 },
  heatmap: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 8 },
  heatCell: { minHeight: 48, borderRadius: 14, border: '1px solid rgba(255,255,255,0.06)', display: 'grid', placeItems: 'center', fontSize: 12 },
  expenseLayout: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(260px, 0.9fr)', gap: 18, alignItems: 'stretch' },
  expenseList: { display: 'grid', gap: 10 },
  expenseRow: { display: 'grid', gap: 12, padding: 16, borderRadius: 18, background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(8,13,22,0.86))', border: '1px solid rgba(255,255,255,0.06)' },
  expenseRowTop: { display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', flexWrap: 'wrap' as const },
  expenseNameWrap: { display: 'flex', alignItems: 'center', gap: 12 },
  expenseColorDot: { width: 10, height: 10, borderRadius: 999, display: 'inline-block', flexShrink: 0 },
  expenseName: { textTransform: 'capitalize' as const, fontWeight: 700, fontSize: 15 },
  expenseTrend: { marginTop: 4, fontSize: 12 },
  expenseRight: { textAlign: 'right' as const, display: 'grid', gap: 4 },
  expensePercent: { fontSize: 12, color: '#8fa3bd' },
  expenseBarTrack: { width: '100%', height: 8, borderRadius: 999, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  expenseBarFill: { height: '100%', borderRadius: 999, boxShadow: '0 0 18px rgba(255,255,255,0.12)' },
  expenseVizCard: { borderRadius: 22, padding: 18, background: 'radial-gradient(circle at top, rgba(198,169,107,0.10), transparent 28%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(8,13,22,0.88))', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'space-between' as const },
  expenseVizHeadline: { fontSize: 12, color: '#8fa3bd', textTransform: 'uppercase' as const, letterSpacing: '0.08em' },
  expenseVizValue: { marginTop: 10, fontSize: 34, fontWeight: 700, letterSpacing: '-0.05em', color: '#f8fbff' },
  expenseVizSubtle: { marginTop: 6, fontSize: 13, color: '#aebdd1', textAlign: 'center' as const },
  expenseMiniLegend: { width: '100%', display: 'grid', gap: 10 },
  expenseMiniLegendRow: { display: 'grid', gridTemplateColumns: '10px 1fr auto', gap: 10, alignItems: 'center' },
  expenseMiniLegendLabel: { textTransform: 'capitalize' as const, color: '#dbe5f2', fontSize: 13 },
  expenseMiniLegendValue: { color: '#f8fbff', fontSize: 13 },
  alertList: { display: 'grid', gap: 10, marginBottom: 20 },
  alertRow: { padding: 14, borderRadius: 16, background: 'linear-gradient(180deg, rgba(255,255,255,0.045), rgba(8,13,22,0.92))', border: '1px solid rgba(255,255,255,0.08)', color: '#f7fbff', textAlign: 'left' as const, cursor: 'pointer', display: 'grid', gap: 6 },
  alertTone: { color: '#c6a96b', textTransform: 'uppercase' as const, letterSpacing: '0.08em' },
  emptyState: { padding: 16, borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#8fa3bd' },
  vendorList: { display: 'grid', gap: 10 },
  vendorRow: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: 12, borderRadius: 14, background: 'rgba(255,255,255,0.03)' },
}
