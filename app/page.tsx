
'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Area, CartesianGrid, Cell, ComposedChart, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import BookingList from '@/components/BookingList'
import StaffDashboard from '@/components/staff/StaffDashboard'
import { canSeePortfolio, filterBookingsForUser, filterExpensesForUser, filterVillasForUser } from '@/lib/access'
import { useRole } from '@/components/auth/RoleProvider'
import { calculateManagementFeeForRange, normalizeManagementFeeConfigs } from '@/lib/managementFees'
import { getAnnualizedRoiPercent, getCapitalBasisForVilla } from '@/lib/marketModel'
import type { BookingRecord, ExpenseRecord, ManagementFeeConfigRecord, StaffIssueRecord, StaffTaskRecord, VillaRecord } from '@/lib/types'

type DateRange = '7d' | '30d' | '90d' | 'ytd'
type Currency = 'IDR' | 'USD' | 'EUR'
type AlertRow = { id: string; label: string; tone: 'good' | 'warn' | 'danger'; villaId?: string; section: 'ranking' | 'occupancy' | 'expenses' | 'operations'; dateRange?: DateRange }
type DailyPoint = { date: string; revenue: number; cost: number; profit: number; occupancy: number }
type VillaMetric = { id: string; name: string; revenue: number; cost: number; managementFee: number; profit: number; occupancy: number; status: 'OK' | 'Watch' | 'Risk'; bookingCount: number }
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
const formatDelta = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
const toIsoDate = (date: Date) => date.toISOString().slice(0, 10)
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
const avg = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0)
const villaLocation = () => 'Lombok'

function getCutoff(range: DateRange) {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  if (range === 'ytd') {
    date.setMonth(0, 1)
    return date
  }
  date.setDate(date.getDate() - (range === '7d' ? 6 : range === '30d' ? 29 : 89))
  return date
}

function bookingNights(booking: BookingRecord) {
  return Math.max(0, (new Date(booking.check_out).getTime() - new Date(booking.check_in).getTime()) / DAY_MS)
}

function bookingRevenue(booking: BookingRecord) {
  return bookingNights(booking) * (Number(booking.price_per_night) || 0)
}

function bookingRevenueInRange(booking: BookingRecord, rangeStart: Date, rangeEnd: Date) {
  let revenue = 0
  const nightlyRevenue = Number(booking.price_per_night) || 0
  const checkOut = new Date(booking.check_out)

  for (let cursor = new Date(booking.check_in); cursor < checkOut; cursor.setDate(cursor.getDate() + 1)) {
    if (cursor >= rangeStart && cursor <= rangeEnd) {
      revenue += nightlyRevenue
    }
  }

  return revenue
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
  valueColor,
}: {
  label: string
  value: string
  subtext?: string
  valueColor?: string
}) {
  return (
    <div style={styles.heroStatCard}>
      <div style={styles.heroStatLabel}>{label}</div>
      <div style={{ ...styles.heroStatValue, ...(valueColor ? { color: valueColor } : null) }}>{value}</div>
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
  data: Array<{ label: string; revenue: number | null; cost: number | null; profit: number | null }>
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

function InvestorAllocationDonut({
  data,
  centerLabel,
  centerValue,
  formatCurrency,
}: {
  data: Array<{ name: string; value: number; color: string }>
  centerLabel: string
  centerValue: string
  formatCurrency: (value: number) => string
}) {
  const total = data.reduce((sum, row) => sum + row.value, 0)
  const gradientSegments = data
    .filter((row) => row.value > 0)
    .reduce<{ angle: number; segments: string[] }>(
      (result, row) => {
        const sweep = total > 0 ? (row.value / total) * 360 : 0
        const start = result.angle
        const end = result.angle + Math.max(sweep - 2.8, 0)
        result.segments.push(`${row.color} ${start}deg ${end}deg`)
        return { angle: result.angle + sweep, segments: result.segments }
      },
      { angle: -90, segments: [] }
    )
    .segments.join(', ')
  const donutBackground = gradientSegments
    ? `conic-gradient(from -90deg, ${gradientSegments})`
    : 'conic-gradient(from -90deg, rgba(255,255,255,0.06) 0deg 360deg)'

  return (
    <div style={styles.investorDonutShell}>
      <div style={styles.investorDonutVisualWrap}>
        <div style={styles.investorDonutAura} />
        <div style={{ ...styles.investorTechDonut, background: donutBackground }}>
          <div style={styles.investorTechDonutInnerRing} />
          <div style={styles.investorTechDonutCore}>
            <div style={styles.investorDonutCenterLabel}>{centerLabel}</div>
            <div style={styles.investorDonutCenterValue}>{centerValue}</div>
            <div style={styles.investorAllocationTotal}>Gross revenue {formatCurrency(total)}</div>
          </div>
        </div>
      </div>
      <div style={styles.investorDonutLegend}>
        {data.map((row) => (
          <div key={row.name} style={styles.investorDonutLegendItem}>
            <div style={styles.investorAllocationLegendTop}>
              <span style={{ ...styles.executiveLegendDot, background: row.color }} />
              <span style={styles.investorDonutLegendCopy}>
                <strong>{row.name}</strong>
                <small>{total > 0 ? formatPercent((row.value / total) * 100) : '0.0%'}</small>
              </span>
              <strong style={styles.investorAllocationValue}>{formatCurrency(row.value)}</strong>
            </div>
            <div style={styles.investorAllocationMiniTrack}>
              <div style={{ ...styles.investorAllocationMiniFill, width: `${total > 0 ? (row.value / total) * 100 : 0}%`, background: row.color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function InvestorMiniSparkline({
  data,
  color,
}: {
  data: Array<{ label: string; value: number }>
  color: string
}) {
  return (
    <div style={styles.investorSparkline}>
      <ResponsiveContainer width="100%" height={54}>
        <LineChart data={data}>
          <defs>
            <linearGradient id="investorSparkFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.28} />
              <stop offset="95%" stopColor={color} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2.6} dot={false} />
          <Area type="monotone" dataKey="value" stroke="transparent" fill="url(#investorSparkFill)" />
        </LineChart>
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
  const [managementFeeRows, setManagementFeeRows] = useState<ManagementFeeConfigRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [dateRange, setDateRange] = useState<DateRange>(currentUser.role === 'investor' ? 'ytd' : '30d')
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
          managementFeeRows?: ManagementFeeConfigRecord[]
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
        setManagementFeeRows(payload.managementFeeRows || [])
      } catch (error) {
        setLoadError(String(error))
      } finally {
        setLoading(false)
      }
    }
    void loadData()
  }, [])

  useEffect(() => {
    setDateRange(currentUser.role === 'investor' ? 'ytd' : '30d')
  }, [currentUser.role])

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
  const managementFeeConfigs = useMemo(
    () => normalizeManagementFeeConfigs(managementFeeRows, visibleVillas),
    [managementFeeRows, visibleVillas]
  )
  const managementFeeByVillaId = useMemo(
    () => new Map(managementFeeConfigs.map((config) => [config.villaId, config])),
    [managementFeeConfigs]
  )
  const scopeStartDate = useMemo(() => startOfDay(cutoff), [cutoff])
  const scopeEndDate = useMemo(() => startOfDay(new Date()), [])
  const scopeDays = useMemo(() => Math.max(1, Math.round((scopeEndDate.getTime() - scopeStartDate.getTime()) / DAY_MS) + 1), [scopeEndDate, scopeStartDate])

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
  const totalManagementFee = useMemo(
    () =>
      filteredVillas.reduce((sum, villa) => {
        const villaRevenue = filteredBookings
          .filter((booking) => booking.villa_id === villa.id)
          .reduce((revenueSum, booking) => revenueSum + bookingRevenue(booking), 0)

        return sum + calculateManagementFeeForRange({
          revenue: villaRevenue,
          config: managementFeeByVillaId.get(villa.id),
          scopeStart: scopeStartDate,
          scopeEnd: scopeEndDate,
        })
      }, 0),
    [filteredBookings, filteredVillas, managementFeeByVillaId, scopeEndDate, scopeStartDate]
  )
  const burnRate = (totalCost / Math.max(1, scopeDays)) * 30
  const netProfit = totalRevenue - totalCost - totalManagementFee
  const annualizedRevenue = (totalRevenue / Math.max(1, scopeDays)) * 365
  const annualizedManagementFee = (totalManagementFee / Math.max(1, scopeDays)) * 365
  const annualizedNetProfit = (netProfit / Math.max(1, scopeDays)) * 365
  const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0
  const selectedScopeLabel = selectedVillaIds.length ? `${selectedVillaIds.length} villas selected` : 'All villas in view'
  const rangeLabel = dateRange === '7d' ? 'Last 7 days' : dateRange === '30d' ? 'Last 30 days' : dateRange === '90d' ? 'Last 90 days' : 'YTD'

  const villaMetrics: VillaMetric[] = useMemo(() => filteredVillas.map((villa) => {
    const villaBookings = filteredBookings.filter((booking) => booking.villa_id === villa.id)
    const villaExpenses = filteredExpenses.filter((expense) => expense.villa_id === villa.id)
    const revenue = villaBookings.reduce((sum, booking) => sum + bookingRevenue(booking), 0)
    const cost = villaExpenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0)
    const managementFee = calculateManagementFeeForRange({
      revenue,
      config: managementFeeByVillaId.get(villa.id),
      scopeStart: scopeStartDate,
      scopeEnd: scopeEndDate,
    })
    const profit = revenue - cost - managementFee
    const villaOccupancy = (villaBookings.reduce((sum, booking) => sum + bookingNights(booking), 0) / Math.max(1, dailySeries.length)) * 100
    const status: VillaMetric['status'] = profit < 0 ? 'Risk' : villaOccupancy < 45 || cost + managementFee > revenue * 0.8 ? 'Watch' : 'OK'
    return {
      id: villa.id,
      name: villa.name,
      revenue,
      cost,
      managementFee,
      profit,
      occupancy: villaOccupancy,
      status,
      bookingCount: villaBookings.length,
    }
  }).sort((a, b) => b[sortBy] - a[sortBy]), [dailySeries.length, filteredBookings, filteredExpenses, filteredVillas, managementFeeByVillaId, scopeEndDate, scopeStartDate, sortBy])

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

  const priorRangeStart = useMemo(() => {
    if (dateRange === 'ytd') {
      return startOfDay(new Date(scopeStartDate.getFullYear() - 1, 0, 1))
    }

    return new Date(scopeStartDate.getTime() - scopeDays * DAY_MS)
  }, [dateRange, scopeDays, scopeStartDate])
  const priorRangeEnd = useMemo(() => {
    if (dateRange === 'ytd') {
      return startOfDay(new Date(scopeEndDate.getFullYear() - 1, scopeEndDate.getMonth(), scopeEndDate.getDate()))
    }

    return new Date(scopeStartDate.getTime() - DAY_MS)
  }, [dateRange, scopeEndDate, scopeStartDate])
  const priorScopeDays = useMemo(
    () => Math.max(1, Math.round((priorRangeEnd.getTime() - priorRangeStart.getTime()) / DAY_MS) + 1),
    [priorRangeEnd, priorRangeStart]
  )
  const priorPeriodLabel = dateRange === 'ytd' ? 'vs prior YTD' : 'vs prior period'
  const priorExpenses = scopedExpenses.filter((expense) => expense.date && expense.villa_id && filteredVillaIds.has(expense.villa_id) && new Date(expense.date) >= priorRangeStart && new Date(expense.date) <= priorRangeEnd)
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
  const roiCapitalBasis = useMemo(() => filteredVillas.reduce((sum, villa) => sum + getCapitalBasisForVilla(villa.id), 0), [filteredVillas])
  const annualizedRoi = useMemo(() => getAnnualizedRoiPercent(netProfit, roiCapitalBasis, scopeDays), [netProfit, roiCapitalBasis, scopeDays])
  const previousBookings = useMemo(
    () =>
      scopedBookings.filter(
        (booking) =>
          booking.villa_id &&
          filteredVillaIds.has(booking.villa_id) &&
          new Date(booking.check_in) >= priorRangeStart &&
          new Date(booking.check_in) <= priorRangeEnd
      ),
    [filteredVillaIds, priorRangeEnd, priorRangeStart, scopedBookings]
  )
  const previousRevenue = useMemo(() => previousBookings.reduce((sum, booking) => sum + bookingRevenue(booking), 0), [previousBookings])
  const previousCost = useMemo(() => priorExpenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0), [priorExpenses])
  const previousManagementFee = useMemo(
    () =>
      filteredVillas.reduce((sum, villa) => {
        const villaRevenue = previousBookings
          .filter((booking) => booking.villa_id === villa.id)
          .reduce((revenueSum, booking) => revenueSum + bookingRevenue(booking), 0)

        return sum + calculateManagementFeeForRange({
          revenue: villaRevenue,
          config: managementFeeByVillaId.get(villa.id),
          scopeStart: priorRangeStart,
          scopeEnd: priorRangeEnd,
        })
      }, 0),
    [filteredVillas, managementFeeByVillaId, previousBookings, priorRangeEnd, priorRangeStart]
  )
  const previousNetProfit = previousRevenue - previousCost - previousManagementFee
  const previousAnnualizedRoi = useMemo(
    () => getAnnualizedRoiPercent(previousNetProfit, roiCapitalBasis, priorScopeDays),
    [previousNetProfit, priorScopeDays, roiCapitalBasis]
  )
  const roiDelta = previousAnnualizedRoi !== 0 ? ((annualizedRoi - previousAnnualizedRoi) / Math.abs(previousAnnualizedRoi)) * 100 : annualizedRoi > 0 ? 100 : 0
  const profitDelta = previousNetProfit !== 0 ? ((netProfit - previousNetProfit) / Math.abs(previousNetProfit)) * 100 : netProfit > 0 ? 100 : 0
  const investorHealthTone: 'good' | 'warn' | 'danger' = riskCount > 0 ? 'danger' : watchCount > 0 ? 'warn' : 'good'
  const investorHealthHeadline = riskCount > 0 ? `${riskCount} villa${riskCount > 1 ? 's' : ''} in risk` : watchCount > 0 ? `${watchCount} villa${watchCount > 1 ? 's' : ''} on watch` : 'Portfolio healthy'
  const investorMonthlyTrend = useMemo(() => {
    const ytdStart = startOfDay(new Date(scopeEndDate.getFullYear(), 0, 1))
    const buckets: Array<{ label: string; revenue: number; cost: number; profit: number }> = []
    let cursor = new Date(ytdStart)
    let cumulativeRevenue = 0
    let cumulativeCost = 0

    while (cursor <= scopeEndDate) {
      const bucketStart = new Date(cursor)
      const bucketEnd = new Date(Math.min(scopeEndDate.getTime(), cursor.getTime() + 6 * DAY_MS))
      const label = bucketStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      const bucketBookings = scopedBookings.filter((booking) => booking.villa_id && filteredVillaIds.has(booking.villa_id))
      const bucketExpenses = scopedExpenses.filter(
        (expense) =>
          expense.villa_id &&
          filteredVillaIds.has(expense.villa_id) &&
          expense.date &&
          new Date(expense.date) >= bucketStart &&
          new Date(expense.date) <= bucketEnd
      )
      const revenue = bucketBookings.reduce((sum, booking) => sum + bookingRevenueInRange(booking, bucketStart, bucketEnd), 0)
      const cost = bucketExpenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0)
      const fee = filteredVillas.reduce((sum, villa) => {
        const villaRevenue = bucketBookings
          .filter((booking) => booking.villa_id === villa.id)
          .reduce((revenueSum, booking) => revenueSum + bookingRevenueInRange(booking, bucketStart, bucketEnd), 0)

        return sum + calculateManagementFeeForRange({
          revenue: villaRevenue,
          config: managementFeeByVillaId.get(villa.id),
          scopeStart: bucketStart,
          scopeEnd: bucketEnd,
        })
      }, 0)
      cumulativeRevenue += revenue
      cumulativeCost += cost + fee

      buckets.push({
        label,
        revenue: cumulativeRevenue,
        cost: cumulativeCost,
        profit: cumulativeRevenue - cumulativeCost,
      })

      cursor = new Date(bucketEnd)
      cursor.setDate(cursor.getDate() + 1)
    }

    return buckets
  }, [filteredVillaIds, filteredVillas, managementFeeByVillaId, scopeEndDate, scopedBookings, scopedExpenses])
  const upcomingInvestorBookings = useMemo(
    () =>
      scopedBookings
        .filter((booking) => booking.villa_id && filteredVillaIds.has(booking.villa_id) && new Date(booking.check_in) >= startOfDay(new Date()))
        .sort((left, right) => left.check_in.localeCompare(right.check_in))
        .slice(0, 6),
    [filteredVillaIds, scopedBookings]
  )
  const upcomingRevenue = useMemo(
    () => upcomingInvestorBookings.reduce((sum, booking) => sum + bookingRevenue(booking), 0),
    [upcomingInvestorBookings]
  )
  const investorHealthRanking = useMemo(
    () =>
      [...villaMetrics].sort((left, right) => {
        const statusScore = { Risk: 0, Watch: 1, OK: 2 } as const
        const statusDelta = statusScore[left.status] - statusScore[right.status]
        if (statusDelta !== 0) return statusDelta
        return left.profit - right.profit
      }),
    [villaMetrics]
  )
  const investorAllocationData = useMemo(
    () => [
      { name: 'Net profit', value: Math.max(netProfit, 0), color: '#18c29c' },
      { name: 'Operating cost', value: totalCost, color: '#3b82f6' },
      { name: 'Mgmt fee', value: totalManagementFee, color: '#c6a96b' },
    ].filter((row) => row.value > 0),
    [netProfit, totalCost, totalManagementFee]
  )
  const healthyVillaCount = villaMetrics.filter((villa) => villa.status === 'OK').length
  const feeLoadPercent = totalRevenue > 0 ? (totalManagementFee / totalRevenue) * 100 : 0

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

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.panelGold}>
          <div style={styles.sectionHeader}>
            <div>
              <div style={styles.brand}>Coralis Dashboard</div>
              <h2 style={styles.sectionTitle}>
                {currentUser.role === 'admin' ? 'Loading portfolio data' : 'Loading assigned portfolio'}
              </h2>
              <div style={styles.subtle}>
                {currentUser.role === 'admin'
                  ? 'The admin dashboard is pulling live villas, bookings, expenses, tasks, and issues.'
                  : 'Preparing the latest bookings, expenses, and performance for your assigned villas.'}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!canSeePortfolio(currentUser.role)) {
    return (
      <div style={styles.page}>
        <header style={styles.investorHero}>
          <div style={styles.investorHeroTopBar}>
            <div style={styles.investorTopMeta}>
              <div style={styles.brand}>Coralis Investor View</div>
              <div style={styles.heroMetaRow}>
                <span style={styles.heroMetaChip}>{visibleVillas.length} villas assigned</span>
                <span style={styles.heroMetaChip}>{healthyVillaCount}/{villaMetrics.length || 0} healthy</span>
              </div>
            </div>
            <div style={styles.investorControlsCluster}>
              <div style={styles.rangePills}>
                {(['30d', '90d', 'ytd'] as DateRange[]).map((range) => (
                  <button
                    key={range}
                    type="button"
                    onClick={() => setDateRange(range)}
                    style={{
                      ...styles.rangeButton,
                      borderColor: dateRange === range ? '#c6a96b' : 'rgba(255,255,255,0.08)',
                      background: dateRange === range ? 'rgba(198,169,107,0.14)' : 'rgba(255,255,255,0.03)',
                    }}
                  >
                    {range === 'ytd' ? 'YTD' : range.toUpperCase()}
                  </button>
                ))}
              </div>
              <label style={styles.investorCurrencyWrap}>
                <span style={styles.filterFieldLabel}>Currency</span>
                <select value={currency} onChange={(event) => setCurrency(event.target.value as Currency)} style={styles.investorCurrencySelect}>
                  <option value="IDR">IDR</option>
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                </select>
              </label>
            </div>
          </div>
          <div style={styles.investorHeroBoard}>
            <div style={styles.investorLeadPanel}>
              <div style={styles.investorLeadEyebrow}>Portfolio overview</div>
              <div style={styles.investorLeadCore}>
                <h1 style={styles.investorLeadTitle}>Private Villa Portfolio</h1>
                <p style={styles.investorLeadCopy}>A focused investor view of yield, health, and forward bookings across the villas currently assigned to this account.</p>
              </div>
            </div>
            <div style={styles.investorMetricBoard}>
              <div style={{ ...styles.investorSignalCard, ...styles.investorSignalPrimary }}>
                <div style={styles.investorSignalLabel}>Annualized ROI</div>
                <div style={{ ...styles.investorSignalValue, color: annualizedRoi >= 0 ? '#a7f3d0' : '#fecdd3' }}>{annualizedRoi.toFixed(1)}%</div>
                <div style={{ ...styles.investorSignalDelta, color: roiDelta >= 0 ? '#9df6d6' : '#fecdd3' }}>{formatDelta(roiDelta)} {priorPeriodLabel}</div>
              </div>
              <div style={{ ...styles.investorSignalCard, ...styles.investorSignalWarm }}>
                <div style={styles.investorSignalLabel}>{dateRange === 'ytd' ? 'Annualized Net Profit' : 'Net Profit'}</div>
                <div style={{ ...styles.investorSignalValue, color: netProfit >= 0 ? '#86efac' : '#fecdd3' }}>{formatCompactCurrency(dateRange === 'ytd' ? annualizedNetProfit : netProfit)}</div>
                <div style={{ ...styles.investorSignalDelta, color: profitDelta >= 0 ? '#9df6d6' : '#fecdd3' }}>{formatDelta(profitDelta)} {priorPeriodLabel}</div>
              </div>
              <div style={{ ...styles.investorHealthHero, ...(investorHealthTone === 'danger' ? styles.investorHealthDanger : investorHealthTone === 'warn' ? styles.investorHealthWarn : styles.investorHealthGood) }}>
                <div>
                  <div style={styles.investorHealthLabel}>Villa Health</div>
                  <div style={styles.investorHealthTitle}>{investorHealthHeadline}</div>
                </div>
                <div style={styles.investorHealthStats}>
                  <span><strong>{healthyVillaCount}</strong> OK</span>
                  <span><strong>{watchCount}</strong> Watch</span>
                  <span><strong>{riskCount}</strong> Risk</span>
                </div>
              </div>
              <div style={styles.investorMiniMetricRow}>
                <div style={styles.investorMiniMetric}>
                  <div style={styles.investorMiniMetricLabel}>{dateRange === 'ytd' ? 'Annualized Revenue' : 'Revenue'}</div>
                  <div style={{ ...styles.investorMiniMetricValue, color: '#8ef0cf' }}>{formatCompactCurrency(dateRange === 'ytd' ? annualizedRevenue : totalRevenue)}</div>
                </div>
                <div style={styles.investorMiniMetric}>
                  <div style={styles.investorMiniMetricLabel}>{dateRange === 'ytd' ? 'Annualized Mgmt Fee' : 'Mgmt Fee'}</div>
                  <div style={{ ...styles.investorMiniMetricValue, color: '#93c5fd' }}>{formatCompactCurrency(dateRange === 'ytd' ? annualizedManagementFee : totalManagementFee)}</div>
                </div>
                <div style={styles.investorMiniMetric}>
                  <div style={styles.investorMiniMetricLabel}>Occupancy</div>
                  <div style={{ ...styles.investorMiniMetricValue, color: occupancy >= 50 ? '#8ef0cf' : '#f6c27d' }}>{formatPercent(occupancy)}</div>
                </div>
                <div style={styles.investorMiniMetric}>
                  <div style={styles.investorMiniMetricLabel}>ADR</div>
                  <div style={{ ...styles.investorMiniMetricValue, color: '#f4dba4' }}>{formatCompactCurrency(adr)}</div>
                </div>
              </div>
            </div>
          </div>
          <div style={styles.investorHeroFooter}>
            <div style={styles.investorLeadCard}>
              <div style={styles.investorLeadLabel}>Top villa</div>
              <div style={styles.investorLeadValue}>{leaderVilla?.name || 'No villa'}</div>
              <div style={styles.investorLeadSubtext}>{topProfitVilla ? `${formatCompactCurrency(topProfitVilla.profit)} net profit leader` : 'No active profit leader yet'}</div>
            </div>
            <div style={styles.investorLeadCard}>
              <div style={styles.investorLeadLabel}>Forward revenue</div>
              <div style={styles.investorLeadValue}>{formatCompactCurrency(upcomingRevenue)}</div>
              <div style={styles.investorLeadSubtext}>{upcomingInvestorBookings.length} upcoming bookings already on the books.</div>
            </div>
            <div style={styles.investorLeadCard}>
              <div style={styles.investorLeadLabel}>Fee load</div>
              <div style={{ ...styles.investorLeadValue, color: feeLoadPercent <= 18 ? '#83ddb8' : feeLoadPercent <= 24 ? '#dcc07b' : '#e7a5af' }}>{formatPercent(feeLoadPercent)}</div>
              <div style={styles.investorLeadSubtext}>Management fee share of revenue in current scope.</div>
            </div>
          </div>
        </header>
        {!visibleVillas.length ? <div style={styles.emptyState}>No villas are assigned to this investor profile yet.</div> : null}
        <section style={styles.investorWealthStripe}>
          <div style={styles.investorWealthCard}>
            <div style={styles.investorWealthLabel}>{dateRange === 'ytd' ? 'Annualized Wealth Summary' : 'Wealth Summary'}</div>
            <div style={styles.investorWealthValue}>{formatCompactCurrency(dateRange === 'ytd' ? annualizedNetProfit : netProfit)}</div>
            <div style={styles.investorWealthSubtext}>{dateRange === 'ytd' ? `YTD actual ${formatCompactCurrency(netProfit)} after operating cost and management fee.` : 'Net cash generated after operating cost and management fee.'}</div>
          </div>
          <div style={styles.investorWealthCard}>
            <div style={styles.investorWealthLabel}>ROI Run Rate</div>
            <div style={{ ...styles.investorWealthValue, color: annualizedRoi >= 0 ? '#8ef0cf' : '#fecdd3' }}>{annualizedRoi.toFixed(1)}%</div>
            <div style={styles.investorWealthSubtext}>{formatDelta(roiDelta)} {dateRange === 'ytd' ? 'versus last year YTD.' : 'versus the prior matched period.'}</div>
          </div>
          <div style={styles.investorWealthCard}>
            <div style={styles.investorWealthLabel}>Healthy Villas</div>
            <div style={{ ...styles.investorWealthValue, color: '#8ef0cf' }}>{villaMetrics.filter((villa) => villa.status === 'OK').length}/{villaMetrics.length || 0}</div>
            <div style={styles.investorWealthSubtext}>Villas currently trading in the healthy zone.</div>
          </div>
          <div style={styles.investorWealthCard}>
            <div style={styles.investorWealthLabel}>Next Arrivals</div>
            <div style={styles.investorWealthValue}>{upcomingInvestorBookings.length}</div>
            <div style={styles.investorWealthSubtext}>Upcoming stays already visible in the forward booking curve.</div>
          </div>
        </section>
        <section style={styles.investorActionBar}>
          <Link href="/invoices" style={styles.investorActionCard}>
            <small style={styles.small}>Investor billing</small>
            <strong style={styles.investorActionTitle}>Invoices</strong>
            <span style={styles.subtle}>Download the latest expense-backed statements.</span>
          </Link>
          <Link href="/management-fees" style={styles.investorActionCard}>
            <small style={styles.small}>Fee transparency</small>
            <strong style={styles.investorActionTitle}>Management Fee</strong>
            <span style={styles.subtle}>Review how each villa is charged and how it impacts net yield.</span>
          </Link>
        </section>
        <div style={styles.investorBoardGrid}>
          <div style={{ ...styles.panelGold, gridArea: 'trend' }}>
            <div style={styles.sectionHeader}>
              <div>
                <h2 style={styles.sectionTitle}>Net Performance Trend</h2>
                <div style={styles.subtle}>Cumulative weekly YTD revenue versus operating cost and management fee across your assigned villas.</div>
              </div>
            </div>
            <ExecutiveTrendChart data={investorMonthlyTrend} formatCurrency={formatCurrency} formatCompactCurrency={formatCompactCurrency} />
          </div>
          <div style={{ ...styles.investorTechPanel, ...styles.investorAllocationPanel, gridArea: 'allocation' }}>
            <div style={styles.sectionHeader}>
              <div>
                <h2 style={styles.sectionTitle}>Revenue Allocation</h2>
                <div style={styles.subtle}>How revenue resolves into retained profit, operating cost, and fee load.</div>
              </div>
            </div>
            <InvestorAllocationDonut
              data={investorAllocationData}
              centerLabel="Net retained"
              centerValue={formatCompactCurrency(Math.max(netProfit, 0))}
              formatCurrency={formatCurrency}
            />
          </div>
          <div style={{ ...styles.investorTechPanel, gridArea: 'health' }}>
            <div style={styles.sectionHeader}>
              <div>
                <h2 style={styles.sectionTitle}>Health Pulse</h2>
                <div style={styles.subtle}>A tighter ranking of which villas are strong and which need attention.</div>
              </div>
            </div>
            <div style={styles.investorPulseList}>
              {investorHealthRanking.slice(0, 4).map((villa, index) => (
                <Link key={villa.id} href={`/villas/${villa.id}`} style={styles.investorPulseRow}>
                  <span style={styles.investorPulseRank}>{String(index + 1).padStart(2, '0')}</span>
                  <span style={styles.investorPulseCopy}>
                    <strong>{villa.name}</strong>
                    <small>{formatCompactCurrency(villa.profit)} net</small>
                  </span>
                  <span style={{ ...styles.statusBadge, ...(villa.status === 'Risk' ? styles.danger : villa.status === 'Watch' ? styles.warn : styles.good) }}>
                    {villa.status}
                  </span>
                </Link>
              ))}
            </div>
          </div>
          <div style={{ ...styles.investorTechPanel, gridArea: 'upcoming' }}>
            <div style={styles.sectionHeader}>
              <div>
                <h2 style={styles.sectionTitle}>Upcoming Bookings</h2>
                <div style={styles.subtle}>The next arrivals shaping near-term revenue visibility.</div>
              </div>
            </div>
            {upcomingInvestorBookings.length ? <BookingList bookings={upcomingInvestorBookings} nights={bookingNights} formatAmount={formatCurrency} title="" /> : <div style={styles.emptyState}>No upcoming bookings in the current investor scope.</div>}
          </div>
        </div>
        <section style={styles.panelGold}>
          <div style={styles.sectionHeader}>
            <div>
              <h2 style={styles.sectionTitle}>Assigned Villas</h2>
              <div style={styles.subtle}>Luxury summary cards with revenue, fee, and net contribution for each villa.</div>
            </div>
          </div>
          <div style={styles.investorVillaGrid}>
            {villaMetrics.map((villa) => (
              <Link key={villa.id} href={`/villas/${villa.id}`} style={styles.investorVillaCard}>
                <div style={styles.investorVillaTop}>
                  <div>
                    <strong style={styles.investorVillaName}>{villa.name}</strong>
                    <div style={styles.rowMeta}>{villa.bookingCount} bookings in scope</div>
                  </div>
                  <span style={{ ...styles.statusBadge, ...(villa.status === 'Risk' ? styles.danger : villa.status === 'Watch' ? styles.warn : styles.good) }}>
                    {villa.status}
                  </span>
                </div>
                <InvestorMiniSparkline
                  data={(villaSeries[villa.id] || []).slice(-14).map((day) => ({
                    label: day.date,
                    value: day.profit,
                  }))}
                  color={villa.profit >= 0 ? '#18c29c' : '#ef4444'}
                />
                <div style={styles.investorVillaMetrics}>
                  <span><small style={styles.small}>Revenue</small><strong style={{ ...styles.filterMetric, color: '#8ef0cf' }}>{formatCompactCurrency(villa.revenue)}</strong></span>
                  <span><small style={styles.small}>Mgmt Fee</small><strong style={{ ...styles.filterMetric, color: '#93c5fd' }}>{formatCompactCurrency(villa.managementFee)}</strong></span>
                  <span><small style={styles.small}>Net Profit</small><strong style={{ ...styles.filterMetric, color: villa.profit >= 0 ? '#8ef0cf' : '#fecdd3' }}>{formatCompactCurrency(villa.profit)}</strong></span>
                  <span><small style={styles.small}>Occupancy</small><strong style={{ ...styles.filterMetric, color: villa.occupancy >= 50 ? '#8ef0cf' : villa.occupancy >= 40 ? '#f6c27d' : '#fecdd3' }}>{formatPercent(villa.occupancy)}</strong></span>
                </div>
              </Link>
            ))}
          </div>
        </section>
        <div style={styles.investorBottomGrid}>
          <div style={styles.panel}>
            <div style={styles.sectionHeader}>
              <div>
                <h2 style={styles.sectionTitle}>Cost Structure</h2>
                <div style={styles.subtle}>High-level view of where operating spend is concentrated.</div>
              </div>
            </div>
            <div style={styles.expenseList}>
              {expenseByCategory.slice(0, 5).map((row) => (
                <div key={row.name} style={styles.expenseRow}>
                  <div style={styles.expenseRowTop}>
                    <div style={styles.expenseNameWrap}>
                      <span style={{ ...styles.expenseColorDot, background: row.color }} />
                      <div>
                        <div style={styles.expenseName}>{row.name}</div>
                        <div style={styles.expenseTrend}>{formatPercent(row.percentage)} of spend</div>
                      </div>
                    </div>
                    <strong>{formatCompactCurrency(row.value)}</strong>
                  </div>
                  <div style={styles.expenseBarTrack}>
                    <div style={{ ...styles.expenseBarFill, width: `${Math.min(100, row.percentage)}%`, background: row.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={styles.panel}>
            <div style={styles.sectionHeader}>
              <div>
                <h2 style={styles.sectionTitle}>Villa Health Ranking</h2>
                <div style={styles.subtle}>A clear top-down ranking of which villas are healthy, soft, or need attention.</div>
              </div>
            </div>
            <div style={styles.investorHealthRanking}>
              {investorHealthRanking.map((villa, index) => (
                <Link key={villa.id} href={`/villas/${villa.id}`} style={styles.investorHealthRow}>
                  <div style={styles.investorHealthRank}>{String(index + 1).padStart(2, '0')}</div>
                  <div style={styles.investorHealthRowCopy}>
                    <strong style={styles.rowName}>{villa.name}</strong>
                    <small style={styles.rowMeta}>{formatCompactCurrency(villa.profit)} net profit</small>
                  </div>
                  <div style={styles.investorHealthRowMetrics}>
                    <span style={{ color: villa.occupancy >= 50 ? '#8ef0cf' : villa.occupancy >= 40 ? '#f6c27d' : '#fecdd3' }}>{formatPercent(villa.occupancy)}</span>
                    <span style={{ ...styles.statusBadge, ...(villa.status === 'Risk' ? styles.danger : villa.status === 'Watch' ? styles.warn : styles.good) }}>{villa.status}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
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
            <HeroStat label="Mgmt fee" value={formatCompactCurrency(totalManagementFee)} subtext="Deducted from villa profit" />
            <HeroStat label="Net yield" value={formatPercent(profitMargin)} subtext={netProfit >= 0 ? `${formatCompactCurrency(netProfit)} after fee` : `${formatCompactCurrency(netProfit)} after fee`} />
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
          <div style={styles.scopeSummaryItem}>
            <div style={styles.scopeSummaryLabel}>Management fee</div>
            <div style={styles.scopeSummaryValue}>{formatCompactCurrency(totalManagementFee)}</div>
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
            <PortfolioKpi title="Net Profit" value={formatCompactCurrency(netProfit)} subtext={`${formatPercent(profitMargin)} margin after management fee`} accent="#18c29c" chip="Yield" featured />
            <PortfolioKpi title="Management Fee" value={formatCompactCurrency(totalManagementFee)} subtext={`Across ${filteredVillas.length} villas in ${rangeLabel.toLowerCase()}`} accent="#60a5fa" chip="Fee" />
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
        <div style={styles.table}><div style={styles.tableHead}><span>Rank</span><span>Villa</span><span>Revenue</span><span>Cost</span><span>Mgmt Fee</span><span>Profit</span><span>Occ</span><span>Status</span></div>{villaMetrics.map((villa, index) => <Link key={villa.id} href={`/villas/${villa.id}`} style={styles.tableRow}><span style={styles.rankBadge}>{String(index + 1).padStart(2, '0')}</span><span><strong style={styles.rowName}>{villa.name}</strong><small style={styles.rowMeta}>{villa.bookingCount} bookings</small></span><span>{formatCompactCurrency(villa.revenue)}</span><span>{formatCompactCurrency(villa.cost)}</span><span>{formatCompactCurrency(villa.managementFee)}</span><span style={{ color: villa.profit >= 0 ? '#8ef0cf' : '#fecdd3' }}>{formatCompactCurrency(villa.profit)}</span><span>{formatPercent(villa.occupancy)}</span><span style={{ ...styles.statusBadge, ...(villa.status === 'Risk' ? styles.danger : villa.status === 'Watch' ? styles.warn : styles.good) }}>{villa.status}</span></Link>)}</div>
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
  investorHero: { display: 'grid', gap: 28, padding: 34, borderRadius: 34, background: 'radial-gradient(circle at top right, rgba(24,194,156,0.07), transparent 24%), linear-gradient(180deg, rgba(7,13,24,0.98), rgba(11,20,34,0.96))', border: '1px solid rgba(198,169,107,0.18)', boxShadow: '0 26px 64px rgba(2,6,23,0.30), inset 0 1px 0 rgba(255,255,255,0.04)' },
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
  investorControlRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' as const },
  investorCurrencyWrap: { display: 'grid', gap: 8 },
  investorCurrencySelect: { minWidth: 128, padding: '12px 14px', borderRadius: 14, border: '1px solid rgba(24,194,156,0.22)', background: 'rgba(9,14,24,0.9)', color: '#f7fbff', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)' },
  investorHeroTopBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' as const },
  investorTopMeta: { display: 'grid', gap: 10 },
  investorControlsCluster: { display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' as const },
  investorHeroBoard: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(420px, 0.8fr)', gap: 28, alignItems: 'stretch' as const, minHeight: 360 },
  investorLeadPanel: { display: 'grid', gap: 20, minWidth: 0, alignContent: 'center' as const, paddingRight: 10 },
  investorLeadEyebrow: { fontSize: 12, color: '#c6a96b', textTransform: 'uppercase' as const, letterSpacing: '0.12em' },
  investorLeadCore: { display: 'grid', gap: 18, alignContent: 'center' as const },
  investorLeadTitle: { margin: 0, fontSize: 'clamp(36px, 3.8vw, 58px)', lineHeight: 0.98, letterSpacing: '-0.06em', maxWidth: 620, fontWeight: 560, color: '#f5f7fb' },
  investorLeadCopy: { margin: 0, maxWidth: 560, color: '#aebed1', fontSize: 15, lineHeight: 1.7 },
  investorHeroFooter: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14 },
  investorLeadCard: { padding: 18, borderRadius: 22, background: 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(8,13,22,0.88))', border: '1px solid rgba(255,255,255,0.06)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)' },
  investorLeadLabel: { fontSize: 11, color: '#9bb0c9', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 10 },
  investorLeadValue: { fontSize: 'clamp(21px, 1.7vw, 28px)', lineHeight: 1.1, fontWeight: 650, letterSpacing: '-0.04em', color: '#eef3f9' },
  investorLeadSubtext: { marginTop: 8, fontSize: 13, color: '#a6b6ca', lineHeight: 1.55 },
  investorMetricBoard: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14, alignContent: 'start' as const, minWidth: 0 },
  investorSignalCard: { minHeight: 160, padding: 20, borderRadius: 24, display: 'grid', gap: 10, alignContent: 'space-between' as const, border: '1px solid rgba(255,255,255,0.07)', boxShadow: '0 16px 34px rgba(2,6,23,0.20), inset 0 1px 0 rgba(255,255,255,0.03)' },
  investorSignalPrimary: { background: 'linear-gradient(180deg, rgba(14,38,37,0.94), rgba(8,16,23,0.94))', borderColor: 'rgba(24,194,156,0.18)' },
  investorSignalWarm: { background: 'linear-gradient(180deg, rgba(36,27,15,0.92), rgba(8,16,23,0.94))', borderColor: 'rgba(198,169,107,0.18)' },
  investorSignalLabel: { fontSize: 11, color: '#a9b9cd', textTransform: 'uppercase' as const, letterSpacing: '0.1em' },
  investorSignalValue: { fontSize: 'clamp(28px, 2.3vw, 42px)', lineHeight: 0.98, fontWeight: 650, letterSpacing: '-0.05em' },
  investorSignalDelta: { fontSize: 12, fontWeight: 600, letterSpacing: '0.01em' },
  investorMiniMetricRow: { gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 },
  investorMiniMetric: { padding: 18, borderRadius: 20, background: 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(8,13,22,0.90))', border: '1px solid rgba(255,255,255,0.06)' },
  investorMiniMetricLabel: { fontSize: 11, color: '#9db2cb', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 10 },
  investorMiniMetricValue: { fontSize: 'clamp(20px, 1.6vw, 28px)', lineHeight: 1, fontWeight: 620, letterSpacing: '-0.04em' },
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
  investorHeroStats: { position: 'relative' as const, zIndex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, alignContent: 'start' as const },
  investorSpotlightCard: { minHeight: 188, padding: 20, borderRadius: 24, display: 'flex', flexDirection: 'column' as const, justifyContent: 'space-between' as const, border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 18px 40px rgba(2,6,23,0.24), inset 0 1px 0 rgba(255,255,255,0.04)' },
  investorSpotlightPrimary: { background: 'radial-gradient(circle at top right, rgba(24,194,156,0.18), transparent 32%), linear-gradient(180deg, rgba(15,41,38,0.96), rgba(8,16,23,0.94))', borderColor: 'rgba(24,194,156,0.28)' },
  investorSpotlightSecondary: { background: 'radial-gradient(circle at top right, rgba(198,169,107,0.18), transparent 32%), linear-gradient(180deg, rgba(40,28,12,0.92), rgba(8,16,23,0.94))', borderColor: 'rgba(198,169,107,0.24)' },
  investorSpotlightLabel: { fontSize: 11, color: '#a9b9cd', textTransform: 'uppercase' as const, letterSpacing: '0.1em' },
  investorSpotlightValue: { fontSize: 'clamp(36px, 3vw, 58px)', lineHeight: 1, fontWeight: 800, letterSpacing: '-0.07em' },
  investorSpotlightDelta: { marginTop: 10, fontSize: 13, fontWeight: 700, letterSpacing: '0.01em' },
  investorSpotlightSubtext: { marginTop: 8, color: '#d1d9e5', fontSize: 13, lineHeight: 1.5 },
  investorHealthHero: { minHeight: 118, padding: 18, borderRadius: 22, border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, gridColumn: '1 / -1', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)' },
  investorHealthGood: { background: 'linear-gradient(135deg, rgba(24,194,156,0.16), rgba(8,16,23,0.92))', borderColor: 'rgba(24,194,156,0.28)' },
  investorHealthWarn: { background: 'linear-gradient(135deg, rgba(198,169,107,0.16), rgba(8,16,23,0.92))', borderColor: 'rgba(198,169,107,0.28)' },
  investorHealthDanger: { background: 'linear-gradient(135deg, rgba(239,68,68,0.16), rgba(8,16,23,0.92))', borderColor: 'rgba(239,68,68,0.28)' },
  investorHealthLabel: { fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.1em', color: '#c8d3e1', marginBottom: 8 },
  investorHealthTitle: { fontSize: 26, fontWeight: 800, letterSpacing: '-0.05em' },
  investorHealthStats: { display: 'flex', gap: 14, flexWrap: 'wrap' as const, color: '#eef6ff', fontSize: 13 },
  heroStatCard: { padding: 16, borderRadius: 18, background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(9,14,24,0.9))', border: '1px solid rgba(255,255,255,0.08)' },
  heroStatLabel: { fontSize: 11, color: '#8fa3bd', textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 10 },
  heroStatValue: { fontSize: 24, fontWeight: 700, letterSpacing: '-0.04em' },
  heroStatSubtext: { marginTop: 8, fontSize: 12, color: '#c8d3e1', lineHeight: 1.5 },
  investorActionBar: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 },
  investorActionCard: { padding: 20, borderRadius: 24, border: '1px solid rgba(198,169,107,0.18)', background: 'radial-gradient(circle at top right, rgba(198,169,107,0.10), transparent 28%), linear-gradient(180deg, rgba(255,255,255,0.05), rgba(8,13,22,0.92))', color: '#f7fbff', textDecoration: 'none', display: 'grid', gap: 10, boxShadow: '0 16px 40px rgba(2,6,23,0.24), inset 0 1px 0 rgba(255,255,255,0.04)' },
  investorActionTitle: { fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em' },
  investorWealthStripe: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 },
  investorWealthCard: { padding: 20, borderRadius: 24, border: '1px solid rgba(24,194,156,0.16)', background: 'radial-gradient(circle at top left, rgba(24,194,156,0.10), transparent 24%), linear-gradient(180deg, rgba(255,255,255,0.05), rgba(8,13,22,0.92))', boxShadow: '0 18px 42px rgba(2,6,23,0.22), inset 0 1px 0 rgba(255,255,255,0.04)' },
  investorWealthLabel: { fontSize: 11, color: '#a9b9cd', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 10 },
  investorWealthValue: { fontSize: 'clamp(28px, 2.4vw, 40px)', lineHeight: 1, fontWeight: 800, letterSpacing: '-0.06em', color: '#8ef0cf' },
  investorWealthSubtext: { marginTop: 10, color: '#cbd6e4', fontSize: 13, lineHeight: 1.5 },
  investorBoardGrid: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.12fr) minmax(320px, 0.88fr)', gridTemplateAreas: '"trend allocation" "health upcoming"', gap: 20, alignItems: 'stretch' as const },
  investorRail: { display: 'grid', gap: 20, alignItems: 'start' as const },
  investorTechPanel: { minWidth: 0, padding: 22, borderRadius: 26, border: '1px solid rgba(96,165,250,0.14)', background: 'radial-gradient(circle at top right, rgba(96,165,250,0.10), transparent 28%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(8,13,22,0.94))', boxShadow: '0 18px 42px rgba(2,6,23,0.22), inset 0 1px 0 rgba(255,255,255,0.04)' },
  investorAllocationPanel: { height: '100%', display: 'grid', alignContent: 'center' as const },
  investorDonutShell: { display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(220px, 0.95fr)', gap: 18, minHeight: 290, alignItems: 'center' as const },
  investorDonutVisualWrap: { position: 'relative' as const, minHeight: 280, display: 'grid', placeItems: 'center' as const },
  investorDonutAura: { position: 'absolute' as const, width: 244, height: 244, borderRadius: '50%', background: 'radial-gradient(circle, rgba(24,194,156,0.16), rgba(59,130,246,0.08) 48%, transparent 72%)', filter: 'blur(18px)', opacity: 0.95 },
  investorTechDonut: { position: 'relative' as const, width: 244, height: 244, borderRadius: '50%', display: 'grid', placeItems: 'center' as const, boxShadow: '0 0 0 1px rgba(255,255,255,0.05), 0 22px 44px rgba(2,6,23,0.34), inset 0 0 32px rgba(255,255,255,0.04)' },
  investorTechDonutInnerRing: { position: 'absolute' as const, inset: 16, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.06)', boxShadow: 'inset 0 0 24px rgba(255,255,255,0.04)' },
  investorTechDonutCore: { position: 'absolute' as const, inset: 44, borderRadius: '50%', display: 'grid', alignContent: 'center' as const, justifyItems: 'center' as const, gap: 8, textAlign: 'center' as const, background: 'radial-gradient(circle at top, rgba(18,29,45,0.96), rgba(8,13,22,0.98))', border: '1px solid rgba(255,255,255,0.06)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)' },
  investorDonutCenterLabel: { fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#8fa3bd' },
  investorDonutCenterValue: { fontSize: 'clamp(22px, 1.8vw, 32px)', lineHeight: 1.05, fontWeight: 750, letterSpacing: '-0.04em', color: '#eef6ff', textAlign: 'center' as const },
  investorAllocationTotal: { color: '#9fb2c8', fontSize: 13 },
  investorDonutLegend: { display: 'grid', gap: 12, alignContent: 'center' as const },
  investorDonutLegendItem: { padding: 14, borderRadius: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', display: 'grid', gap: 10 },
  investorAllocationLegendTop: { display: 'grid', gridTemplateColumns: '10px minmax(0, 1fr) auto', gap: 10, alignItems: 'center' },
  investorDonutLegendCopy: { display: 'grid', gap: 2, color: '#d7e1ee', fontSize: 13 },
  investorAllocationValue: { color: '#eef6ff', fontSize: 13 },
  investorAllocationMiniTrack: { height: 8, borderRadius: 999, overflow: 'hidden', background: 'rgba(255,255,255,0.06)' },
  investorAllocationMiniFill: { height: '100%', borderRadius: 999 },
  investorPulseList: { display: 'grid', gap: 10 },
  investorPulseRow: { display: 'grid', gridTemplateColumns: '42px minmax(0, 1fr) auto', gap: 12, alignItems: 'center', padding: 14, borderRadius: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: '#f7fbff', textDecoration: 'none' },
  investorPulseRank: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 42, height: 42, borderRadius: 14, background: 'linear-gradient(180deg, rgba(96,165,250,0.24), rgba(96,165,250,0.08))', border: '1px solid rgba(96,165,250,0.20)', color: '#dbeafe', fontWeight: 700 },
  investorPulseCopy: { display: 'grid', gap: 4, minWidth: 0 },
  investorSparkline: { marginTop: -2, marginBottom: 4, padding: '2px 0 0' },
  investorVillaGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 },
  investorVillaCard: { padding: 20, borderRadius: 24, border: '1px solid rgba(198,169,107,0.16)', background: 'radial-gradient(circle at top left, rgba(24,194,156,0.08), transparent 26%), linear-gradient(180deg, rgba(255,255,255,0.05), rgba(8,13,22,0.94))', color: '#f7fbff', textDecoration: 'none', display: 'grid', gap: 16, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)' },
  investorVillaTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  investorVillaName: { display: 'block', fontSize: 20, letterSpacing: '-0.03em', marginBottom: 6 },
  investorVillaMetrics: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 },
  investorBottomGrid: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.05fr) minmax(320px, 0.95fr)', gap: 20, alignItems: 'start' as const },
  investorHealthRanking: { display: 'grid', gap: 12 },
  investorHealthRow: { display: 'grid', gridTemplateColumns: '54px minmax(0, 1fr) auto', alignItems: 'center', gap: 14, padding: 16, borderRadius: 18, background: 'linear-gradient(180deg, rgba(255,255,255,0.045), rgba(8,13,22,0.92))', border: '1px solid rgba(255,255,255,0.08)', color: '#f7fbff', textDecoration: 'none' },
  investorHealthRank: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 54, height: 54, borderRadius: 16, background: 'linear-gradient(180deg, rgba(198,169,107,0.28), rgba(198,169,107,0.08))', border: '1px solid rgba(198,169,107,0.24)', color: '#f4e6c8', fontWeight: 800, letterSpacing: '0.04em' },
  investorHealthRowCopy: { display: 'grid', gap: 4 },
  investorHealthRowMetrics: { display: 'grid', justifyItems: 'end' as const, gap: 8, fontWeight: 700 },
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
  tableHead: { display: 'grid', gridTemplateColumns: '0.8fr 2fr 1fr 1fr 1fr 1fr 0.8fr 0.9fr', gap: 12, padding: '0 14px', color: '#8fa3bd', textTransform: 'uppercase' as const, fontSize: 12, letterSpacing: '0.08em' },
  tableRow: { display: 'grid', gridTemplateColumns: '0.8fr 2fr 1fr 1fr 1fr 1fr 0.8fr 0.9fr', gap: 12, padding: 16, borderRadius: 18, background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(12,18,31,0.92))', border: '1px solid rgba(198,169,107,0.14)', color: '#f7fbff', textDecoration: 'none', alignItems: 'center' },
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
