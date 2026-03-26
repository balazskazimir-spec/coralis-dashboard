'use client'

import { useEffect, useMemo, useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import Link from 'next/link'
import { canAccessExpenses, canSeeAlerts, canSeeProfit, filterBookingsForUser, filterExpensesForUser, filterVillasForUser } from '@/lib/access'
import { useRole } from '@/components/auth/RoleProvider'
import ChartMain from '@/components/ChartMain'
import StaffExpensesWorkspace from '@/components/staff/StaffExpensesWorkspace'
import { BOOKING_SELECT, EXPENSE_SELECT, VILLA_SELECT } from '@/lib/dbSelects'
import { getAnnualizedRoiPercent, getCapitalBasisForVilla } from '@/lib/marketModel'
import { supabase } from '@/lib/supabase'
import type {
  AlertItem,
  AppUser,
  BookingRecord,
  ExpenseRecord,
  RevenueExpensePoint,
  VillaPerformanceRow,
  VillaRecord,
} from '@/lib/types'

type Currency = 'IDR' | 'EUR' | 'USD'
type DateRange = '7d' | '30d' | '90d' | 'ytd' | 'all'
type SortBy = 'expenses' | 'night' | 'booking'

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

const PIE_COLORS = ['#8b5cf6', '#f97316', '#22c55e', '#3b82f6', '#ef4444', '#0ea5e9']
const EXPENSE_CATEGORIES = ['cleaning', 'maintenance', 'utilities', 'staff'] as const
const CATEGORY_COLORS: Record<(typeof EXPENSE_CATEGORIES)[number], string> = {
  cleaning: '#34d399',
  maintenance: '#ef4444',
  utilities: '#38bdf8',
  staff: '#f59e0b',
}
const HIGH_EXPENSE_PER_NIGHT_IDR = 900_000
const CRITICAL_EXPENSE_PER_NIGHT_IDR = 1_250_000

function getCutoffDate(range: DateRange) {
  const now = new Date()
  const cutoff = new Date(now)

  if (range === '7d') {
    cutoff.setDate(now.getDate() - 7)
    return cutoff
  }

  if (range === '30d') {
    cutoff.setDate(now.getDate() - 30)
    return cutoff
  }

  if (range === '90d') {
    cutoff.setDate(now.getDate() - 90)
    return cutoff
  }

  if (range === 'ytd') {
    cutoff.setMonth(0, 1)
    cutoff.setHours(0, 0, 0, 0)
    return cutoff
  }

  return new Date(0)
}

function bookingNights(booking: BookingRecord) {
  return Math.max(
    0,
    (new Date(booking.check_out).getTime() - new Date(booking.check_in).getTime()) / 86400000
  )
}

function createVillaPerformanceRow(villa: VillaRecord): VillaPerformanceRow {
  return {
    id: villa.id,
    name: villa.name,
    expenses: 0,
    bookings: 0,
    nights: 0,
    revenue: 0,
    expensePerNight: 0,
    expensePerBooking: 0,
    status: 'OK',
  }
}

export default function ExpensesPage() {
  const { currentUser } = useRole()

  if (currentUser.role === 'staff') {
    return <StaffExpensesWorkspace />
  }

  return <AnalyticsExpensesPage currentUser={currentUser} />
}

function AnalyticsExpensesPage({ currentUser }: { currentUser: AppUser }) {
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([])
  const [bookings, setBookings] = useState<BookingRecord[]>([])
  const [villas, setVillas] = useState<VillaRecord[]>([])
  const [currency, setCurrency] = useState<Currency>('IDR')
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterMonth, setFilterMonth] = useState('all')
  const [selectedVilla, setSelectedVilla] = useState('all')
  const [dateRange, setDateRange] = useState<DateRange>('ytd')
  const [chartMode, setChartMode] = useState<'revenue' | 'expenses' | 'profit'>('expenses')
  const [sortBy, setSortBy] = useState<SortBy>('expenses')

  useEffect(() => {
    async function loadData() {
      const [villasResult, expensesResult, bookingsResult] = await Promise.all([
        supabase.from('villas').select(VILLA_SELECT).order('name'),
        supabase.from('expenses').select(EXPENSE_SELECT).order('date', { ascending: false }),
        supabase.from('bookings').select(BOOKING_SELECT).order('check_in', { ascending: false }),
      ])

      setVillas((villasResult.data as VillaRecord[]) || [])
      setExpenses((expensesResult.data as ExpenseRecord[]) || [])
      setBookings((bookingsResult.data as BookingRecord[]) || [])
    }

    void loadData()
  }, [])

  const visibleExpensesBase = useMemo(() => filterExpensesForUser(expenses, currentUser), [currentUser, expenses])
  const visibleBookingsBase = useMemo(() => filterBookingsForUser(bookings, currentUser), [bookings, currentUser])
  const visibleVillasBase = useMemo(() => filterVillasForUser(villas, currentUser), [currentUser, villas])
  const villaById = useMemo(() => new Map(villas.map((villa) => [villa.id, villa])), [villas])
  const currencyRate = EXCHANGE_RATES[currency]

  const months = useMemo(() => {
    const monthSet = new Set<string>()

    visibleExpensesBase.forEach((expense) => {
      if (expense.date) {
        monthSet.add(expense.date.slice(0, 7))
      }
    })

    return Array.from(monthSet).sort((a, b) => a.localeCompare(b))
  }, [visibleExpensesBase])

  const visibleVillas = useMemo(() => {
    if (selectedVilla === 'all') {
      return visibleVillasBase
    }

    return visibleVillasBase.filter((villa) => villa.id === selectedVilla)
  }, [selectedVilla, visibleVillasBase])

  const filteredExpenses = useMemo(() => {
    const cutoff = getCutoffDate(dateRange)

    return visibleExpensesBase.filter((expense) => {
      if (!expense.date) {
        return false
      }

      if (filterCategory !== 'all' && expense.category !== filterCategory) {
        return false
      }

      if (selectedVilla !== 'all' && expense.villa_id !== selectedVilla) {
        return false
      }

      const expenseDate = new Date(expense.date)
      if (Number.isNaN(expenseDate.getTime()) || expenseDate < cutoff) {
        return false
      }

      if (filterMonth !== 'all' && expense.date.slice(0, 7) !== filterMonth) {
        return false
      }

      return true
    })
  }, [dateRange, filterCategory, filterMonth, selectedVilla, visibleExpensesBase])

  const filteredBookings = useMemo(() => {
    const cutoff = getCutoffDate(dateRange)
    const now = new Date()

    return visibleBookingsBase.filter((booking) => {
      if (!booking.check_in) {
        return false
      }

      if (selectedVilla !== 'all' && booking.villa_id !== selectedVilla) {
        return false
      }

      const bookingDate = new Date(booking.check_in)
      if (Number.isNaN(bookingDate.getTime()) || bookingDate < cutoff || bookingDate > now) {
        return false
      }

      if (filterMonth !== 'all' && booking.check_in.slice(0, 7) !== filterMonth) {
        return false
      }

      return true
    })
  }, [dateRange, filterMonth, selectedVilla, visibleBookingsBase])

  const formatCurrency = (value: number) => {
    const props = DISPLAY_RATES[currency]
    return new Intl.NumberFormat(props.locale, {
      style: 'currency',
      currency: props.code,
      minimumFractionDigits: currency === 'IDR' ? 0 : 2,
      maximumFractionDigits: currency === 'IDR' ? 0 : 2,
    }).format(value)
  }

  const formatHeadlineCurrency = (value: number) => {
    const absolute = Math.abs(value)

    if (currency === 'IDR') {
      if (absolute >= 1_000_000_000) {
        return `Rp ${(value / 1_000_000_000).toFixed(2)}B`
      }

      if (absolute >= 1_000_000) {
        return `Rp ${(value / 1_000_000).toFixed(2)}M`
      }
    }

    if (absolute >= 1_000_000) {
      const props = DISPLAY_RATES[currency]
      return new Intl.NumberFormat(props.locale, {
        style: 'currency',
        currency: props.code,
        notation: 'compact',
        maximumFractionDigits: 2,
      }).format(value)
    }

    return formatCurrency(value)
  }

  const formatAxisValue = (value: number) => {
    if (Math.abs(value) >= 1_000_000_000) {
      return `${(value / 1_000_000_000).toFixed(1)}B`
    }

    if (Math.abs(value) >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(0)}M`
    }

    if (Math.abs(value) >= 1_000) {
      return `${(value / 1_000).toFixed(0)}K`
    }

    return value.toFixed(0)
  }

  const totalRevenue = useMemo(() => {
    return filteredBookings.reduce((sum, booking) => {
      return sum + bookingNights(booking) * (Number(booking.price_per_night) || 0) * currencyRate
    }, 0)
  }, [currencyRate, filteredBookings])

  const totalExpenses = useMemo(() => {
    return filteredExpenses.reduce((sum, expense) => {
      return sum + Number(expense.amount) * currencyRate
    }, 0)
  }, [currencyRate, filteredExpenses])

  const startOfMonth = useMemo(() => {
    const today = new Date()
    return new Date(today.getFullYear(), today.getMonth(), 1)
  }, [])

  const mtdExpenses = useMemo(() => {
    return filteredExpenses
      .filter((expense) => expense.date && new Date(expense.date) >= startOfMonth)
      .reduce((sum, expense) => sum + Number(expense.amount) * currencyRate, 0)
  }, [currencyRate, filteredExpenses, startOfMonth])

  const occupiedNights = useMemo(() => {
    return filteredBookings.reduce((sum, booking) => sum + bookingNights(booking), 0)
  }, [filteredBookings])

  const expensePerVilla = useMemo(() => {
    return totalExpenses / Math.max(1, visibleVillas.length)
  }, [totalExpenses, visibleVillas.length])

  const expensePerUnit = useMemo(() => {
    return totalExpenses / Math.max(1, filteredBookings.length)
  }, [filteredBookings.length, totalExpenses])

  const netProfit = totalRevenue - totalExpenses
  const expenseRatio = totalRevenue > 0 ? (totalExpenses / totalRevenue) * 100 : 0
  const analysisRange = useMemo(() => {
    const dates: Date[] = []

    filteredExpenses.forEach((expense) => {
      if (expense.date) {
        const date = new Date(expense.date)
        if (!Number.isNaN(date.getTime())) {
          dates.push(date)
        }
      }
    })

    filteredBookings.forEach((booking) => {
      const checkIn = new Date(booking.check_in)
      const checkOut = new Date(booking.check_out)

      if (!Number.isNaN(checkIn.getTime())) {
        dates.push(checkIn)
      }

      if (!Number.isNaN(checkOut.getTime())) {
        dates.push(checkOut)
      }
    })

    if (dates.length === 0) {
      const fallbackStart = getCutoffDate(dateRange)
      return {
        start: fallbackStart,
        end: new Date(),
      }
    }

    const sortedDates = dates.sort((a, b) => a.getTime() - b.getTime())

    return {
      start: sortedDates[0],
      end: sortedDates[sortedDates.length - 1],
    }
  }, [dateRange, filteredBookings, filteredExpenses])

  const roiCapitalBasis = useMemo(() => {
    return visibleVillas.reduce((sum, villa) => sum + getCapitalBasisForVilla(villa.id), 0)
  }, [visibleVillas])

  const annualizedRoi = useMemo(() => {
    const rangeDays = Math.max(1, (analysisRange.end.getTime() - analysisRange.start.getTime()) / 86400000)
    return getAnnualizedRoiPercent(netProfit / currencyRate, roiCapitalBasis, rangeDays)
  }, [analysisRange.end, analysisRange.start, currencyRate, netProfit, roiCapitalBasis])

  const burnRate = useMemo(() => {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    return filteredExpenses
      .filter((expense) => expense.date && new Date(expense.date) >= thirtyDaysAgo)
      .reduce((sum, expense) => sum + Number(expense.amount) * currencyRate, 0)
  }, [currencyRate, filteredExpenses])

  const monthlyData = useMemo<RevenueExpensePoint[]>(() => {
    const map: Record<string, RevenueExpensePoint> = {}

    filteredExpenses.forEach((expense) => {
      if (!expense.date) {
        return
      }

      const date = new Date(expense.date)
      if (Number.isNaN(date.getTime())) {
        return
      }

      const monthKey = expense.date.slice(0, 7)
      const monthLabel = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

      if (!map[monthKey]) {
        map[monthKey] = {
          month: monthLabel,
          monthKey,
          revenue: 0,
          expenses: 0,
          profit: 0,
          cleaning: 0,
          maintenance: 0,
          utilities: 0,
          staff: 0,
        }
      }

      const amount = Number(expense.amount) * currencyRate
      map[monthKey].expenses += amount

      if (expense.category === 'cleaning' || expense.category === 'maintenance' || expense.category === 'utilities' || expense.category === 'staff') {
        const categoryKey = expense.category
        map[monthKey][categoryKey] = Number(map[monthKey][categoryKey] || 0) + amount
      }
    })

    filteredBookings.forEach((booking) => {
      const monthKey = booking.check_in.slice(0, 7)
      const monthDate = new Date(booking.check_in)
      const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

      if (!map[monthKey]) {
        map[monthKey] = {
          month: monthLabel,
          monthKey,
          revenue: 0,
          expenses: 0,
          profit: 0,
          cleaning: 0,
          maintenance: 0,
          utilities: 0,
          staff: 0,
        }
      }

      map[monthKey].revenue += bookingNights(booking) * (Number(booking.price_per_night) || 0) * currencyRate
    })

    const base = Object.values(map).sort((a, b) => (a.monthKey || '').localeCompare(b.monthKey || ''))

    return base.map((item, index, collection) => {
      const window = collection.slice(Math.max(0, index - 2), index + 1)
      const smoothedExpenses =
        window.reduce((sum, value) => sum + value.expenses, 0) / window.length

      return {
        ...item,
        profit: item.revenue - item.expenses,
        smoothedExpenses,
      }
    })
  }, [currencyRate, filteredBookings, filteredExpenses])

  const categoryTrendSummary = useMemo(() => {
    return EXPENSE_CATEGORIES.map((categoryName) => {
      const total = monthlyData.reduce((sum, item) => sum + Number(item[categoryName] || 0), 0)
      return {
        name: categoryName,
        total,
        color: CATEGORY_COLORS[categoryName],
      }
    }).filter((item) => item.total > 0)
  }, [monthlyData])

  const categoryData = useMemo(() => {
    const totals: Record<string, number> = {}

    filteredExpenses.forEach((expense) => {
      const categoryName = expense.category || 'unknown'
      totals[categoryName] = (totals[categoryName] || 0) + Number(expense.amount) * currencyRate
    })

    return Object.entries(totals)
      .filter(([, value]) => value > 0)
      .map(([name, value]) => ({ name, value }))
  }, [currencyRate, filteredExpenses])

  const villaPerformance = useMemo<VillaPerformanceRow[]>(() => {
    const villaMap: Record<string, VillaPerformanceRow> = {}

    visibleVillas.forEach((villa) => {
      villaMap[villa.id] = createVillaPerformanceRow(villa)
    })

    filteredExpenses.forEach((expense) => {
      if (!expense.villa_id) {
        return
      }

      const existingVilla = villaById.get(expense.villa_id)
      const row =
        villaMap[expense.villa_id] ||
        createVillaPerformanceRow(
          existingVilla || { id: expense.villa_id, name: 'Unknown Villa' }
        )

      row.expenses += Number(expense.amount) * currencyRate
      villaMap[expense.villa_id] = row
    })

    filteredBookings.forEach((booking) => {
      if (!booking.villa_id) {
        return
      }

      const existingVilla = villaById.get(booking.villa_id)
      const row =
        villaMap[booking.villa_id] ||
        createVillaPerformanceRow(
          existingVilla || { id: booking.villa_id, name: 'Unknown Villa' }
        )

      const nights = bookingNights(booking)
      row.bookings += 1
      row.nights += nights
      row.revenue += nights * (Number(booking.price_per_night) || 0) * currencyRate
      villaMap[booking.villa_id] = row
    })

    const rows = Object.values(villaMap).map((row) => {
      const expensePerNight = row.nights > 0 ? row.expenses / row.nights : 0
      const expensePerBooking = row.bookings > 0 ? row.expenses / row.bookings : 0

      const expenseToRevenueRatio = row.revenue > 0 ? row.expenses / row.revenue : 0

      let status: VillaPerformanceRow['status'] = 'OK'
      if (expensePerNight > CRITICAL_EXPENSE_PER_NIGHT_IDR * currencyRate || expenseToRevenueRatio > 0.4) {
        status = 'Critical'
      } else if (expensePerNight > HIGH_EXPENSE_PER_NIGHT_IDR * currencyRate || expenseToRevenueRatio > 0.32) {
        status = 'High'
      }

      return {
        ...row,
        expensePerNight,
        expensePerBooking,
        status,
      }
    })

    return rows.sort((a, b) => {
      if (sortBy === 'night') {
        return b.expensePerNight - a.expensePerNight
      }

      if (sortBy === 'booking') {
        return b.expensePerBooking - a.expensePerBooking
      }

      return b.expenses - a.expenses
    })
  }, [currencyRate, filteredBookings, filteredExpenses, sortBy, villaById, visibleVillas])

  const alerts = useMemo<AlertItem[]>(() => {
    const alertList: AlertItem[] = []

    villaPerformance.forEach((villa) => {
      const villaExpenseRatio = villa.revenue > 0 ? villa.expenses / villa.revenue : 0

      if (villaExpenseRatio > 0.42) {
        alertList.push({
          type: 'warning',
          message: `${villa.name} operating costs are running at ${(villaExpenseRatio * 100).toFixed(0)}% of revenue.`,
          villa: villa.name,
        })
      }
    })

    EXPENSE_CATEGORIES.forEach((categoryName) => {
      const categoryExpenses = filteredExpenses.filter((expense) => expense.category === categoryName)
      if (categoryExpenses.length === 0) {
        return
      }

      const averageExpense =
        categoryExpenses.reduce((sum, expense) => sum + Number(expense.amount), 0) /
        categoryExpenses.length

      const weekAgo = new Date()
      weekAgo.setDate(weekAgo.getDate() - 7)

      const recentExpenses = categoryExpenses.filter((expense) => {
        if (!expense.date) {
          return false
        }

        return new Date(expense.date) >= weekAgo
      })

      if (recentExpenses.length === 0) {
        return
      }

      const recentAverage =
        recentExpenses.reduce((sum, expense) => sum + Number(expense.amount), 0) /
        recentExpenses.length

      if (recentAverage > averageExpense * 1.5) {
        alertList.push({
          type: 'warning',
          message: `${categoryName} costs are spiking this week.`,
          category: categoryName,
        })
      }
    })

    return alertList.slice(0, 5)
  }, [filteredExpenses, villaPerformance])

  const unitEconomics = useMemo(() => {
    const averageRevenuePerVilla = visibleVillas.length > 0 ? totalRevenue / visibleVillas.length : 0
    const contributionMargin = averageRevenuePerVilla - expensePerVilla
    const breakEvenOccupancy =
      averageRevenuePerVilla > 0 ? (expensePerVilla / averageRevenuePerVilla) * 100 : 0

    return {
      contributionMargin,
      breakEvenOccupancy: Math.min(100, breakEvenOccupancy),
      averageCostPerBooking: expensePerUnit,
    }
  }, [expensePerUnit, expensePerVilla, totalRevenue, visibleVillas.length])

  const averageNightlyRevenue = useMemo(() => {
    return occupiedNights > 0 ? totalRevenue / occupiedNights : 0
  }, [occupiedNights, totalRevenue])

  if (!canAccessExpenses(currentUser.role)) {
    return (
      <div style={styles.mainArea}>
        <div style={styles.guardCard}>
          <h1 style={styles.chartTitle}>Expenses Access Restricted</h1>
          <p style={styles.guardCopy}>Investors can use the villa pages and the simplified dashboard, but not the operations expenses view.</p>
          <Link href="/villas" style={styles.guardLink}>
            Go to Villas
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.mainArea}>
      <div style={styles.heroPanel}>
        <div style={styles.heroCopy}>
          <div style={styles.heroEyebrow}>Coralis Asset Intelligence</div>
          <h1 style={styles.heroTitle}>Expenses & Yield</h1>
          <p style={styles.heroDescription}>
            Premium operating view with revenue context, annualized ROI, and category-level cost structure across the portfolio.
          </p>
        </div>

        <div style={styles.heroStats}>
          <div style={styles.heroStatCard}>
            <div style={styles.heroStatLabel}>Revenue In Scope</div>
            <div style={styles.heroStatValue} title={formatCurrency(totalRevenue)}>{formatHeadlineCurrency(totalRevenue)}</div>
          </div>
          <div style={styles.heroStatCard}>
            <div style={styles.heroStatLabel}>Annualized ROI</div>
            <div style={styles.heroStatValue}>{annualizedRoi.toFixed(1)}%</div>
          </div>
          <div style={styles.heroStatCard}>
            <div style={styles.heroStatLabel}>Average ADR</div>
            <div style={styles.heroStatValue} title={formatCurrency(averageNightlyRevenue)}>{formatHeadlineCurrency(averageNightlyRevenue)}</div>
          </div>
        </div>
      </div>

      <div style={styles.filterBar}>
        <select value={dateRange} onChange={(e) => setDateRange(e.target.value as DateRange)} style={styles.filterSelect}>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="ytd">YTD</option>
          <option value="all">All time</option>
        </select>

        <select value={selectedVilla} onChange={(e) => setSelectedVilla(e.target.value)} style={styles.filterSelect}>
          <option value="all">All Villas</option>
          {villas.map((villa) => (
            <option key={villa.id} value={villa.id}>
              {villa.name}
            </option>
          ))}
        </select>

        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} style={styles.filterSelect}>
          <option value="all">All Categories</option>
          <option value="cleaning">Cleaning</option>
          <option value="maintenance">Maintenance</option>
          <option value="utilities">Utilities</option>
          <option value="staff">Staff</option>
        </select>

        <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} style={styles.filterSelect}>
          <option value="all">All Months</option>
          {months.map((month) => (
            <option key={month} value={month}>
              {month}
            </option>
          ))}
        </select>

        <div style={styles.currencyWrap}>
          <span style={styles.currencyHint}>Static rates (IDR-&gt;USD: ~$0.000064, EUR: ~$0.000059)</span>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as Currency)}
            style={styles.currencyDropdown}
          >
            <option value="IDR">IDR</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </div>
      </div>

      <div style={styles.kpiBar}>
        <div style={styles.kpiCard} onClick={() => setChartMode('revenue')}>
          <div style={styles.kpiValue} title={formatCurrency(totalRevenue)}>{formatHeadlineCurrency(totalRevenue)}</div>
          <div style={styles.kpiLabel}>Total Revenue</div>
          <div style={styles.kpiSubtext}>Average ADR: {formatCurrency(averageNightlyRevenue)}</div>
        </div>

        <div style={styles.kpiCard} onClick={() => setChartMode('expenses')}>
          <div style={styles.kpiValue} title={formatCurrency(totalExpenses)}>{formatHeadlineCurrency(totalExpenses)}</div>
          <div style={styles.kpiLabel}>Total Expenses</div>
          <div style={styles.kpiSubtext}>This month: {formatCurrency(mtdExpenses)}</div>
        </div>

        {canSeeProfit(currentUser.role) && (
          <div style={styles.kpiCard} onClick={() => setChartMode('profit')}>
            <div style={styles.kpiValue}>{expenseRatio.toFixed(1)}%</div>
            <div style={styles.kpiLabel}>Expense Ratio</div>
            <div style={styles.kpiSubtext}>Target: under 60%</div>
          </div>
        )}

        {canSeeProfit(currentUser.role) && (
          <div style={styles.kpiCard} onClick={() => setChartMode('profit')}>
            <div style={styles.kpiValue} title={formatCurrency(netProfit)}>{formatHeadlineCurrency(netProfit)}</div>
            <div style={styles.kpiLabel}>Net Profit</div>
            <div style={styles.kpiSubtext}>Annualized ROI: {annualizedRoi.toFixed(1)}%</div>
          </div>
        )}

        <div style={styles.kpiCard}>
          <div style={styles.kpiValue} title={formatCurrency(burnRate)}>{formatHeadlineCurrency(burnRate)}</div>
          <div style={styles.kpiLabel}>Burn Rate</div>
          <div style={styles.kpiSubtext}>Rolling 30-day spend</div>
        </div>
      </div>

      <div style={styles.chartSection}>
        <div style={styles.chartHeader}>
          <h2 style={styles.chartTitle}>
            {chartMode === 'revenue'
              ? 'Revenue Trend'
              : chartMode === 'expenses'
                ? 'Operating Cost Stack vs Revenue'
                : 'Profit Trend'}
          </h2>
          <div style={styles.chartToggles}>
            <button
              onClick={() => setChartMode('revenue')}
              style={chartMode === 'revenue' ? styles.activeToggle : styles.toggleButton}
            >
              Revenue
            </button>
            <button
              onClick={() => setChartMode('expenses')}
              style={chartMode === 'expenses' ? styles.activeToggle : styles.toggleButton}
            >
              Expenses
            </button>
            <button
              onClick={() => setChartMode('profit')}
              style={chartMode === 'profit' ? styles.activeToggle : styles.toggleButton}
            >
              Profit
            </button>
          </div>
        </div>

        {chartMode === 'expenses' && (
          <div style={styles.chartLegendRow}>
            <div style={styles.legendChip}>
              <span style={{ ...styles.legendDot, backgroundColor: '#a78bfa' }} />
              <span style={styles.legendLabel}>Revenue</span>
              <span style={styles.legendValue} title={formatCurrency(totalRevenue)}>{formatHeadlineCurrency(totalRevenue)}</span>
            </div>
            {categoryTrendSummary.map((item) => (
              <div key={item.name} style={styles.legendChip}>
                <span style={{ ...styles.legendDot, backgroundColor: item.color }} />
                <span style={styles.legendLabel}>{item.name}</span>
                <span style={styles.legendValue} title={formatCurrency(item.total)}>{formatHeadlineCurrency(item.total)}</span>
              </div>
            ))}
          </div>
        )}

        <div style={styles.chartContainer}>
          <ChartMain
            data={monthlyData}
            mode={chartMode}
            tooltipFormatter={formatCurrency}
            axisFormatter={formatAxisValue}
            onPointClick={(monthKey) => setFilterMonth(monthKey)}
          />
        </div>
      </div>

      <div style={styles.villaTable}>
        <div style={styles.tableHeader}>
          <h3 style={styles.tableTitle}>Villa Performance</h3>
          <div style={styles.sortButtons}>
            <button
              onClick={() => setSortBy('expenses')}
              style={sortBy === 'expenses' ? styles.activeSort : styles.sortButton}
            >
              Expenses
            </button>
            <button
              onClick={() => setSortBy('night')}
              style={sortBy === 'night' ? styles.activeSort : styles.sortButton}
            >
              /Night
            </button>
            <button
              onClick={() => setSortBy('booking')}
              style={sortBy === 'booking' ? styles.activeSort : styles.sortButton}
            >
              /Booking
            </button>
          </div>
        </div>

        <div style={styles.table}>
          <div style={styles.tableRow}>
            <div style={styles.tableHeaderCell}>Villa</div>
            <div style={styles.tableHeaderCell}>Expenses</div>
            <div style={styles.tableHeaderCell}>/Night</div>
            <div style={styles.tableHeaderCell}>/Booking</div>
            <div style={styles.tableHeaderCell}>Status</div>
          </div>

          {villaPerformance.map((villa) => (
            <div key={villa.id} style={styles.tableRow}>
              <div style={styles.tableCell}>{villa.name}</div>
              <div style={styles.tableCell}>{formatCurrency(villa.expenses)}</div>
              <div style={styles.tableCell}>{formatCurrency(villa.expensePerNight)}</div>
              <div style={styles.tableCell}>{formatCurrency(villa.expensePerBooking)}</div>
              <div style={styles.tableCell}>{villa.status}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={styles.bottomSection}>
        <div style={styles.breakdownCard}>
          <h4 style={styles.cardTitle}>Expense Categories</h4>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={categoryData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={70}
                label={({ name, percent }: { name?: string; percent?: number }) =>
                  `${name || 'Unknown'} ${((percent || 0) * 100).toFixed(0)}%`
                }
              >
                {categoryData.map((entry, index) => (
                  <Cell key={`cell-${entry.name}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => formatCurrency(Number(value))} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {canSeeAlerts(currentUser.role) && (
          <div style={styles.alertsCard}>
            <h4 style={styles.cardTitle}>Alerts & Anomalies</h4>
            <div style={styles.alertsList}>
              {alerts.length === 0 ? (
                <div style={styles.noAlerts}>No alerts right now.</div>
              ) : (
                alerts.map((alert, index) => (
                  <div key={`${alert.message}-${index}`} style={styles.alertItem}>
                    <span style={styles.alertIcon}>{alert.type === 'warning' ? '!' : '!!'}</span>
                    <span style={styles.alertText}>{alert.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {canSeeProfit(currentUser.role) && (
          <div style={styles.economicsCard}>
            <h4 style={styles.cardTitle}>Unit Economics</h4>
            <div style={styles.economicsGrid}>
              <div style={styles.economicItem}>
                <div style={styles.economicValue}>{formatCurrency(unitEconomics.contributionMargin)}</div>
                <div style={styles.economicLabel}>Contribution Margin / Villa</div>
              </div>
              <div style={styles.economicItem}>
                <div style={styles.economicValue}>{unitEconomics.breakEvenOccupancy.toFixed(0)}%</div>
                <div style={styles.economicLabel}>Break-even Occupancy</div>
              </div>
              <div style={styles.economicItem}>
                <div style={styles.economicValue}>{formatCurrency(unitEconomics.averageCostPerBooking)}</div>
                <div style={styles.economicLabel}>Avg Cost per Booking</div>
              </div>
              <div style={styles.economicItem}>
                <div style={styles.economicValue}>{occupiedNights.toFixed(0)}</div>
                <div style={styles.economicLabel}>Occupied Nights</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const styles = {
  mainArea: {
    flex: 1,
    padding: '28px',
    background:
      'radial-gradient(circle at top left, rgba(245, 158, 11, 0.10), transparent 24%), radial-gradient(circle at top right, rgba(96, 165, 250, 0.12), transparent 28%), linear-gradient(135deg, #081120 0%, #0f172a 48%, #162235 100%)',
  },

  heroPanel: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.5fr) minmax(320px, 1fr)',
    gap: '18px',
    padding: '24px',
    marginBottom: '22px',
    borderRadius: '28px',
    background:
      'linear-gradient(135deg, rgba(250, 204, 21, 0.08), rgba(59, 130, 246, 0.08) 42%, rgba(15, 23, 42, 0.92) 100%)',
    border: '1px solid rgba(250, 204, 21, 0.14)',
    boxShadow: '0 24px 70px rgba(2, 6, 23, 0.34), inset 0 1px 0 rgba(255,255,255,0.05)',
    alignItems: 'stretch',
  },

  heroCopy: {
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'center',
    gap: '10px',
  },

  heroEyebrow: {
    fontSize: '11px',
    letterSpacing: '0.24em',
    textTransform: 'uppercase' as const,
    color: '#fbbf24',
    fontWeight: 700,
  },

  heroTitle: {
    margin: 0,
    fontSize: '36px',
    lineHeight: 1,
    color: '#f8fafc',
    fontWeight: 700,
  },

  heroDescription: {
    margin: 0,
    maxWidth: '700px',
    color: '#cbd5e1',
    fontSize: '15px',
    lineHeight: 1.7,
  },

  heroStats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: '12px',
  },

  heroStatCard: {
    padding: '18px 16px',
    borderRadius: '22px',
    background: 'rgba(8, 17, 32, 0.7)',
    border: '1px solid rgba(148, 163, 184, 0.14)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
    overflow: 'hidden',
  },

  heroStatLabel: {
    fontSize: '11px',
    letterSpacing: '0.14em',
    textTransform: 'uppercase' as const,
    color: '#94a3b8',
    marginBottom: '10px',
  },

  heroStatValue: {
    fontSize: 'clamp(15px, 1.35vw, 20px)',
    fontWeight: 700,
    color: '#f8fafc',
    lineHeight: 1.15,
    whiteSpace: 'nowrap' as const,
    letterSpacing: '-0.03em',
  },

  guardCard: {
    maxWidth: 560,
    padding: '24px',
    borderRadius: '20px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
  },

  guardCopy: {
    color: '#c8d4e5',
    lineHeight: 1.6,
  },

  guardLink: {
    display: 'inline-block',
    marginTop: '8px',
    color: '#fff',
  },

  filterBar: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    marginBottom: '24px',
    padding: '18px',
    background: 'rgba(12, 20, 35, 0.82)',
    backdropFilter: 'blur(18px)',
    borderRadius: '22px',
    border: '1px solid rgba(148, 163, 184, 0.14)',
    boxShadow: '0 16px 40px rgba(2, 6, 23, 0.22), inset 0 1px 0 rgba(255,255,255,0.03)',
    flexWrap: 'wrap' as const,
  },

  filterSelect: {
    padding: '10px 14px',
    borderRadius: '12px',
    backgroundColor: 'rgba(30, 41, 59, 0.9)',
    color: 'white',
    border: '1px solid rgba(148, 163, 184, 0.16)',
    fontSize: '14px',
    minWidth: '120px',
  },

  currencyWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginLeft: 'auto',
  },

  currencyHint: {
    fontSize: '12px',
    color: '#94a3b8',
  },

  currencyDropdown: {
    padding: '10px 14px',
    borderRadius: '12px',
    backgroundColor: 'rgba(30, 41, 59, 0.9)',
    color: 'white',
    border: '1px solid rgba(148, 163, 184, 0.16)',
    fontSize: '14px',
  },

  kpiBar: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '18px',
    marginBottom: '34px',
  },

  kpiCard: {
    padding: '22px',
    background:
      'linear-gradient(180deg, rgba(15, 23, 42, 0.88), rgba(30, 41, 59, 0.72))',
    backdropFilter: 'blur(14px)',
    borderRadius: '22px',
    border: '1px solid rgba(148, 163, 184, 0.14)',
    boxShadow: '0 18px 45px rgba(2, 6, 23, 0.24), inset 0 1px 0 rgba(255,255,255,0.04)',
    cursor: 'pointer',
    transition: 'all 0.2s',
    textAlign: 'left' as const,
    overflow: 'hidden',
  },

  kpiValue: {
    fontSize: 'clamp(18px, 1.7vw, 24px)',
    fontWeight: 'bold',
    color: '#f8fafc',
    marginBottom: '6px',
    lineHeight: 1.12,
    whiteSpace: 'nowrap' as const,
    letterSpacing: '-0.035em',
  },

  kpiLabel: {
    fontSize: '14px',
    color: '#94a3b8',
    marginBottom: '4px',
  },

  kpiSubtext: {
    fontSize: '12px',
    color: '#7dd3fc',
  },

  chartSection: {
    background:
      'linear-gradient(180deg, rgba(15, 23, 42, 0.88), rgba(15, 23, 42, 0.72))',
    backdropFilter: 'blur(14px)',
    borderRadius: '28px',
    border: '1px solid rgba(148, 163, 184, 0.14)',
    boxShadow: '0 22px 60px rgba(2, 6, 23, 0.28)',
    padding: '24px',
    marginBottom: '32px',
  },

  chartHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
    gap: '12px',
    flexWrap: 'wrap' as const,
  },

  chartTitle: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#f8fafc',
    margin: 0,
  },

  chartToggles: {
    display: 'flex',
    gap: '8px',
  },

  toggleButton: {
    padding: '8px 14px',
    borderRadius: '999px',
    backgroundColor: 'rgba(30,41,59,0.84)',
    color: '#9ca3af',
    border: '1px solid rgba(148,163,184,0.16)',
    fontSize: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },

  activeToggle: {
    padding: '8px 14px',
    borderRadius: '999px',
    background: 'linear-gradient(135deg, #f59e0b, #f97316)',
    color: 'white',
    border: '1px solid rgba(251,191,36,0.35)',
    fontSize: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },

  chartContainer: {
    height: '340px',
  },

  chartLegendRow: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap' as const,
    marginBottom: '18px',
  },

  legendChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    borderRadius: '999px',
    background: 'rgba(15, 23, 42, 0.72)',
    border: '1px solid rgba(148, 163, 184, 0.14)',
    maxWidth: '100%',
  },

  legendDot: {
    width: '10px',
    height: '10px',
    borderRadius: '999px',
    display: 'inline-block',
    boxShadow: '0 0 12px rgba(255,255,255,0.12)',
  },

  legendLabel: {
    fontSize: '12px',
    color: '#cbd5e1',
    textTransform: 'capitalize' as const,
  },

  legendValue: {
    fontSize: '12px',
    color: '#f8fafc',
    fontWeight: 600,
    overflowWrap: 'anywhere' as const,
  },

  villaTable: {
    background:
      'linear-gradient(180deg, rgba(15, 23, 42, 0.88), rgba(30, 41, 59, 0.72))',
    backdropFilter: 'blur(14px)',
    borderRadius: '28px',
    border: '1px solid rgba(148, 163, 184, 0.14)',
    boxShadow: '0 22px 60px rgba(2, 6, 23, 0.28)',
    padding: '24px',
    marginBottom: '32px',
  },

  tableHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
    gap: '12px',
    flexWrap: 'wrap' as const,
  },

  tableTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#f8fafc',
    margin: 0,
  },

  sortButtons: {
    display: 'flex',
    gap: '8px',
  },

  sortButton: {
    padding: '6px 10px',
    borderRadius: '999px',
    backgroundColor: 'rgba(30,41,59,0.84)',
    color: '#9ca3af',
    border: '1px solid rgba(148,163,184,0.16)',
    fontSize: '11px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },

  activeSort: {
    padding: '6px 10px',
    borderRadius: '999px',
    background: 'linear-gradient(135deg, #0ea5e9, #3b82f6)',
    color: 'white',
    border: '1px solid rgba(96,165,250,0.35)',
    fontSize: '11px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },

  table: {
    display: 'grid',
    gap: '1px',
    backgroundColor: 'rgba(148, 163, 184, 0.12)',
    borderRadius: '18px',
    overflow: 'hidden',
  },

  tableRow: {
    display: 'grid',
    gridTemplateColumns: '2fr 1fr 1fr 1fr 0.8fr',
    backgroundColor: 'rgba(12, 20, 35, 0.92)',
  },

  tableHeaderCell: {
    padding: '12px 16px',
    fontSize: '12px',
    fontWeight: '600',
    color: '#94a3b8',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },

  tableCell: {
    padding: '12px 16px',
    fontSize: '14px',
    color: '#f8fafc',
  },

  bottomSection: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: '24px',
  },

  breakdownCard: {
    background:
      'linear-gradient(180deg, rgba(15, 23, 42, 0.88), rgba(30, 41, 59, 0.72))',
    backdropFilter: 'blur(14px)',
    borderRadius: '24px',
    border: '1px solid rgba(148, 163, 184, 0.14)',
    boxShadow: '0 18px 48px rgba(2, 6, 23, 0.24)',
    padding: '20px',
  },

  alertsCard: {
    background:
      'linear-gradient(180deg, rgba(15, 23, 42, 0.88), rgba(30, 41, 59, 0.72))',
    backdropFilter: 'blur(14px)',
    borderRadius: '24px',
    border: '1px solid rgba(148, 163, 184, 0.14)',
    boxShadow: '0 18px 48px rgba(2, 6, 23, 0.24)',
    padding: '20px',
  },

  economicsCard: {
    background:
      'linear-gradient(180deg, rgba(15, 23, 42, 0.88), rgba(30, 41, 59, 0.72))',
    backdropFilter: 'blur(14px)',
    borderRadius: '24px',
    border: '1px solid rgba(148, 163, 184, 0.14)',
    boxShadow: '0 18px 48px rgba(2, 6, 23, 0.24)',
    padding: '20px',
  },

  cardTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#f8fafc',
    margin: '0 0 16px 0',
  },

  alertsList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
  },

  alertItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 12px',
    backgroundColor: 'rgba(127, 29, 29, 0.18)',
    borderRadius: '14px',
    border: '1px solid rgba(248, 113, 113, 0.2)',
  },

  alertIcon: {
    fontSize: '16px',
  },

  alertText: {
    fontSize: '14px',
    color: '#fca5a5',
  },

  noAlerts: {
    textAlign: 'center' as const,
    color: '#10b981',
    fontSize: '14px',
    padding: '20px',
  },

  economicsGrid: {
    display: 'grid',
    gap: '16px',
  },

  economicItem: {
    textAlign: 'center' as const,
  },

  economicValue: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#f8fafc',
    marginBottom: '4px',
  },

  economicLabel: {
    fontSize: '12px',
    color: '#94a3b8',
  },
}
