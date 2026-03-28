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
type ChartGranularity = 'day' | 'week' | 'month'

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

const EXPENSE_CATEGORIES = ['cleaning', 'maintenance', 'utilities', 'staff', 'supplies', 'transport', 'other'] as const
const CATEGORY_COLORS: Record<(typeof EXPENSE_CATEGORIES)[number], string> = {
  cleaning: '#34d399',
  maintenance: '#ef4444',
  utilities: '#38bdf8',
  staff: '#f59e0b',
  supplies: '#f472b6',
  transport: '#facc15',
  other: '#94a3b8',
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

function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00`)
}

function startOfWeek(date: Date) {
  const result = new Date(date)
  const day = (result.getDay() + 6) % 7
  result.setDate(result.getDate() - day)
  result.setHours(0, 0, 0, 0)
  return result
}

function getChartGranularity(range: DateRange): ChartGranularity {
  if (range === 'all') {
    return 'month'
  }

  if (range === 'ytd' || range === '90d') {
    return 'week'
  }

  return 'day'
}

function getBucketMeta(date: Date, granularity: ChartGranularity) {
  if (granularity === 'month') {
    return {
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      monthKey: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      label: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
    }
  }

  if (granularity === 'week') {
    const weekStart = startOfWeek(date)
    return {
      key: weekStart.toISOString().slice(0, 10),
      monthKey: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      label: weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    }
  }

  return {
    key: date.toISOString().slice(0, 10),
    monthKey: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
    label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }
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

function formatCategoryName(categoryName: string) {
  return categoryName
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function getVillaStatusTone(status: VillaPerformanceRow['status']) {
  if (status === 'Critical') {
    return {
      label: 'Critical',
      color: '#fca5a5',
      background: 'rgba(239, 68, 68, 0.14)',
      border: '1px solid rgba(239, 68, 68, 0.26)',
    }
  }

  if (status === 'High') {
    return {
      label: 'Watch',
      color: '#fcd34d',
      background: 'rgba(245, 158, 11, 0.14)',
      border: '1px solid rgba(245, 158, 11, 0.26)',
    }
  }

  return {
    label: 'Healthy',
    color: '#86efac',
    background: 'rgba(16, 185, 129, 0.14)',
    border: '1px solid rgba(16, 185, 129, 0.24)',
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
  const chartGranularity = useMemo(() => getChartGranularity(dateRange), [dateRange])

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

  const formatDonutCurrency = (value: number) => {
    const absolute = Math.abs(value)

    if (currency === 'IDR') {
      if (absolute >= 1_000_000_000) {
        return `Rp ${(value / 1_000_000_000).toFixed(1)}B`
      }

      if (absolute >= 1_000_000) {
        return `Rp ${(value / 1_000_000).toFixed(1)}M`
      }
    }

    const props = DISPLAY_RATES[currency]
    return new Intl.NumberFormat(props.locale, {
      style: 'currency',
      currency: props.code,
      notation: absolute >= 1000 ? 'compact' : 'standard',
      maximumFractionDigits: absolute >= 1000 ? 1 : 2,
      minimumFractionDigits: 0,
    }).format(value)
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

      const date = parseDateOnly(expense.date)
      if (Number.isNaN(date.getTime())) {
        return
      }

      const bucket = getBucketMeta(date, chartGranularity)

      if (!map[bucket.key]) {
        map[bucket.key] = {
          month: bucket.label,
          monthKey: bucket.monthKey,
          revenue: 0,
          expenses: 0,
          profit: 0,
          cleaning: 0,
          maintenance: 0,
          utilities: 0,
          staff: 0,
          supplies: 0,
          transport: 0,
          other: 0,
        }
      }

      const amount = Number(expense.amount) * currencyRate
      map[bucket.key].expenses += amount

      if (
        expense.category === 'cleaning' ||
        expense.category === 'maintenance' ||
        expense.category === 'utilities' ||
        expense.category === 'staff' ||
        expense.category === 'supplies' ||
        expense.category === 'transport' ||
        expense.category === 'other'
      ) {
        const categoryKey = expense.category
        map[bucket.key][categoryKey] = Number(map[bucket.key][categoryKey] || 0) + amount
      }
    })

    filteredBookings.forEach((booking) => {
      const nightlyRevenue = (Number(booking.price_per_night) || 0) * currencyRate
      const checkIn = parseDateOnly(booking.check_in)
      const checkOut = parseDateOnly(booking.check_out)

      for (const cursor = new Date(checkIn); cursor < checkOut; cursor.setDate(cursor.getDate() + 1)) {
        const bucket = getBucketMeta(cursor, chartGranularity)

        if (!map[bucket.key]) {
          map[bucket.key] = {
            month: bucket.label,
            monthKey: bucket.monthKey,
            revenue: 0,
            expenses: 0,
            profit: 0,
            cleaning: 0,
            maintenance: 0,
            utilities: 0,
            staff: 0,
            supplies: 0,
            transport: 0,
            other: 0,
          }
        }

        map[bucket.key].revenue += nightlyRevenue
      }
    })

    const base = Object.entries(map)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([, value]) => value)

    return base.map((item, index, collection) => {
      const smoothingWindow = chartGranularity === 'month' ? 3 : chartGranularity === 'week' ? 4 : 7
      const window = collection.slice(Math.max(0, index - (smoothingWindow - 1)), index + 1)
      const smoothedExpenses =
        window.reduce((sum, value) => sum + value.expenses, 0) / window.length

      return {
        ...item,
        profit: item.revenue - item.expenses,
        smoothedExpenses,
      }
    })
  }, [chartGranularity, currencyRate, filteredBookings, filteredExpenses])

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

  const comparisonExpenses = useMemo(() => {
    const rangeDays = Math.max(
      7,
      Math.ceil((analysisRange.end.getTime() - analysisRange.start.getTime()) / 86400000) + 1
    )
    const comparisonEnd = new Date(analysisRange.start)
    comparisonEnd.setDate(comparisonEnd.getDate() - 1)
    const comparisonStart = new Date(comparisonEnd)
    comparisonStart.setDate(comparisonStart.getDate() - rangeDays + 1)

    return visibleExpensesBase.filter((expense) => {
      if (!expense.date) {
        return false
      }

      if (selectedVilla !== 'all' && expense.villa_id !== selectedVilla) {
        return false
      }

      if (filterCategory !== 'all' && expense.category !== filterCategory) {
        return false
      }

      const expenseDate = parseDateOnly(expense.date)
      if (Number.isNaN(expenseDate.getTime())) {
        return false
      }

      return expenseDate >= comparisonStart && expenseDate <= comparisonEnd
    })
  }, [analysisRange.end, analysisRange.start, filterCategory, selectedVilla, visibleExpensesBase])

  const categoryData = useMemo(() => {
    const totals: Record<string, number> = {}
    const comparisonTotals: Record<string, number> = {}

    filteredExpenses.forEach((expense) => {
      const categoryName = expense.category || 'unknown'
      totals[categoryName] = (totals[categoryName] || 0) + Number(expense.amount) * currencyRate
    })

    comparisonExpenses.forEach((expense) => {
      const categoryName = expense.category || 'unknown'
      comparisonTotals[categoryName] = (comparisonTotals[categoryName] || 0) + Number(expense.amount) * currencyRate
    })

    return Object.entries(totals)
      .filter(([, value]) => value > 0)
      .map(([name, value]) => {
        const previousValue = comparisonTotals[name] || 0
        const trend = previousValue > 0 ? ((value - previousValue) / previousValue) * 100 : value > 0 ? 100 : 0

        return {
          name,
          label: formatCategoryName(name),
          value,
          percentage: totalExpenses > 0 ? (value / totalExpenses) * 100 : 0,
          color: CATEGORY_COLORS[name as keyof typeof CATEGORY_COLORS] || '#94a3b8',
          trend,
        }
      })
      .sort((left, right) => right.value - left.value)
  }, [comparisonExpenses, currencyRate, filteredExpenses, totalExpenses])

  const featuredCategoryData = useMemo(() => categoryData.slice(0, 4), [categoryData])

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

      if (villaExpenseRatio > 0.42 || villa.status === 'Critical') {
        alertList.push({
          type: villa.status === 'Critical' ? 'critical' : 'warning',
          message: `${villa.name} operating costs are running at ${(villaExpenseRatio * 100).toFixed(0)}% of revenue.`,
          villa: villa.name,
        })
      } else if (villaExpenseRatio > 0.34 || villa.status === 'High') {
        alertList.push({
          type: 'warning',
          message: `${villa.name} is trending high at ${(villaExpenseRatio * 100).toFixed(0)}% cost-to-revenue.`,
          villa: villa.name,
        })
      }
    })

    categoryData.slice(0, 4).forEach((category) => {
      if (category.percentage >= 34) {
        alertList.push({
          type: category.percentage >= 42 ? 'critical' : 'warning',
          message: `${category.label} is carrying ${category.percentage.toFixed(0)}% of total spend.`,
          category: category.name,
        })
      }

      if (category.trend >= 22) {
        alertList.push({
          type: category.trend >= 40 ? 'critical' : 'warning',
          message: `${category.label} spend is up ${category.trend.toFixed(0)}% versus the prior period.`,
          category: category.name,
        })
      }
    })

    const averageBucketSpend =
      monthlyData.length > 0
        ? monthlyData.reduce((sum, item) => sum + item.expenses, 0) / monthlyData.length
        : 0
    const latestBucket = monthlyData[monthlyData.length - 1]

    if (latestBucket && averageBucketSpend > 0 && latestBucket.expenses > averageBucketSpend * 1.2) {
      alertList.push({
        type: latestBucket.expenses > averageBucketSpend * 1.45 ? 'critical' : 'warning',
        message: `${latestBucket.month} spend is ${((latestBucket.expenses / averageBucketSpend) * 100 - 100).toFixed(0)}% above the period average.`,
      })
    }

    return alertList
      .filter((alert, index, collection) => collection.findIndex((item) => item.message === alert.message) === index)
      .slice(0, 6)
  }, [categoryData, monthlyData, villaPerformance])

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

  const villaSectionMetrics = useMemo(() => {
    const criticalCount = villaPerformance.filter((villa) => villa.status === 'Critical').length
    const watchCount = villaPerformance.filter((villa) => villa.status === 'High').length
    const leadingExpenseVilla = villaPerformance[0] || null
    const averageExpensePerNight =
      villaPerformance.length > 0
        ? villaPerformance.reduce((sum, villa) => sum + villa.expensePerNight, 0) / villaPerformance.length
        : 0

    return {
      criticalCount,
      watchCount,
      leadingExpenseVilla,
      averageExpensePerNight,
    }
  }, [villaPerformance])

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
          <div>
            <div style={styles.sectionEyebrow}>Executive ranking</div>
            <h3 style={styles.tableTitle}>Villa Performance</h3>
            <div style={styles.sectionSubtitle}>Read which villas are carrying the heaviest operating drag and where cost per stay needs intervention.</div>
          </div>
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

        <div style={styles.tableMetricRow}>
          <div style={styles.tableMetricChip}>
            <span style={styles.tableMetricLabel}>Highest spend</span>
            <strong style={styles.tableMetricValue}>{villaSectionMetrics.leadingExpenseVilla?.name || 'No villa in scope'}</strong>
          </div>
          <div style={styles.tableMetricChip}>
            <span style={styles.tableMetricLabel}>Average / Night</span>
            <strong style={styles.tableMetricValue}>{formatHeadlineCurrency(villaSectionMetrics.averageExpensePerNight)}</strong>
          </div>
          <div style={styles.tableMetricChip}>
            <span style={styles.tableMetricLabel}>Critical</span>
            <strong style={styles.tableMetricValue}>{villaSectionMetrics.criticalCount}</strong>
          </div>
          <div style={styles.tableMetricChip}>
            <span style={styles.tableMetricLabel}>Watch</span>
            <strong style={styles.tableMetricValue}>{villaSectionMetrics.watchCount}</strong>
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
            <div key={villa.id} style={styles.tableBodyRow}>
              <div style={styles.tableCellPrimary}>
                <div style={styles.tableVillaName}>{villa.name}</div>
                <div style={styles.tableVillaMeta}>{villa.bookings} bookings · {villa.nights.toFixed(0)} nights</div>
              </div>
              <div style={styles.tableCellStrong}>{formatCurrency(villa.expenses)}</div>
              <div style={styles.tableCell}>{formatCurrency(villa.expensePerNight)}</div>
              <div style={styles.tableCell}>{formatCurrency(villa.expensePerBooking)}</div>
              <div style={styles.tableCell}>
                <span style={{ ...styles.statusBadge, ...getVillaStatusTone(villa.status) }}>
                  {getVillaStatusTone(villa.status).label}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {canSeeProfit(currentUser.role) && (
        <div style={styles.economicsCard}>
          <div style={styles.breakdownHeader}>
            <div>
              <h4 style={styles.cardTitle}>Unit Economics</h4>
              <div style={styles.breakdownSubtitle}>Board-level operating efficiency across the current expense scope.</div>
            </div>
            <div style={styles.breakdownTotalChip}>
              <span style={styles.breakdownTotalLabel}>Occupied</span>
              <strong style={styles.breakdownTotalValue}>{occupiedNights.toFixed(0)}</strong>
            </div>
          </div>
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

      <div style={styles.bottomSection}>
        <div style={styles.breakdownCard}>
          <div style={styles.breakdownHeader}>
            <div>
              <h4 style={styles.cardTitle}>Expense Categories</h4>
              <div style={styles.breakdownSubtitle}>Portfolio cost mix and category pressure in the current scope.</div>
            </div>
            <div style={styles.breakdownTotalChip}>
              <span style={styles.breakdownTotalLabel}>Total</span>
              <strong style={styles.breakdownTotalValue}>{formatHeadlineCurrency(totalExpenses)}</strong>
            </div>
          </div>

          <div style={styles.breakdownLayout}>
            <div style={styles.breakdownDonutWrap}>
              <ResponsiveContainer width="100%" height={320}>
                <PieChart>
                  <Pie
                    data={categoryData}
                    dataKey="value"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    innerRadius={92}
                    outerRadius={132}
                    paddingAngle={2}
                    stroke="rgba(15,23,42,0.96)"
                    strokeWidth={5}
                  >
                    {categoryData.map((entry) => (
                      <Cell key={`cell-${entry.name}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                </PieChart>
              </ResponsiveContainer>
              <div style={styles.breakdownDonutCenter}>
                <div style={styles.breakdownCenterLabel}>In Scope</div>
                <div style={styles.breakdownCenterValue} title={formatCurrency(totalExpenses)}>{formatDonutCurrency(totalExpenses)}</div>
                <div style={styles.breakdownCenterSubtext}>{categoryData.length} active categories</div>
              </div>
              <div style={styles.breakdownDonutHalo} />
            </div>

            <div style={styles.breakdownHighlights}>
              {featuredCategoryData.map((entry) => (
                <div key={entry.name} style={styles.breakdownHighlightCard}>
                  <div style={styles.breakdownHighlightTop}>
                    <div style={styles.breakdownNameWrap}>
                      <span style={{ ...styles.legendDot, backgroundColor: entry.color }} />
                      <span style={styles.breakdownHighlightTitle}>{entry.label}</span>
                    </div>
                    <span style={styles.breakdownHighlightPercent}>{entry.percentage.toFixed(0)}%</span>
                  </div>
                  <div style={styles.breakdownHighlightValue}>{formatHeadlineCurrency(entry.value)}</div>
                  <div style={styles.breakdownHighlightCopy}>
                    {entry.trend >= 0 ? '+' : ''}
                    {entry.trend.toFixed(0)}% vs prior period
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={styles.breakdownRows}>
            {categoryData.map((entry) => (
              <div key={entry.name} style={styles.breakdownRow}>
                <div style={styles.breakdownRowTop}>
                  <div style={styles.breakdownNameWrap}>
                    <span style={{ ...styles.legendDot, backgroundColor: entry.color }} />
                    <span style={styles.breakdownName}>{entry.label}</span>
                  </div>
                  <div style={styles.breakdownNumbers}>
                    <span style={styles.breakdownValue}>{formatHeadlineCurrency(entry.value)}</span>
                    <span style={styles.breakdownPercent}>{entry.percentage.toFixed(0)}%</span>
                  </div>
                </div>
                <div style={styles.breakdownTrack}>
                  <div style={{ ...styles.breakdownFill, width: `${Math.max(8, entry.percentage)}%`, background: entry.color }} />
                </div>
                <div style={styles.breakdownTrendRow}>
                  <span style={styles.breakdownTrendLabel}>vs prior period</span>
                  <span
                    style={{
                      ...styles.breakdownTrendValue,
                      color: entry.trend >= 0 ? '#fbbf24' : '#86efac',
                    }}
                  >
                    {entry.trend >= 0 ? '+' : ''}
                    {entry.trend.toFixed(0)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {canSeeAlerts(currentUser.role) && (
          <div style={styles.alertsCard}>
            <div style={styles.breakdownHeader}>
              <div>
                <h4 style={styles.cardTitle}>Alerts & Anomalies</h4>
                <div style={styles.breakdownSubtitle}>Cost pressure, category drift, and villa-level operating drag.</div>
              </div>
              <div style={styles.breakdownTotalChip}>
                <span style={styles.breakdownTotalLabel}>Signals</span>
                <strong style={styles.breakdownTotalValue}>{alerts.length}</strong>
              </div>
            </div>
            <div style={styles.alertsList}>
              {alerts.length === 0 ? (
                <div style={styles.noAlerts}>No anomalies in the current scope. Cost mix and villa ratios are within range.</div>
              ) : (
                alerts.map((alert, index) => (
                  <div key={`${alert.message}-${index}`} style={styles.alertItem}>
                    <span style={{ ...styles.alertIcon, ...(alert.type === 'critical' ? styles.alertIconCritical : styles.alertIconWarning) }}>
                      {alert.type === 'warning' ? 'Warn' : 'Critical'}
                    </span>
                    <span style={styles.alertText}>{alert.message}</span>
                  </div>
                ))
              )}
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
      'radial-gradient(circle at top right, rgba(250, 204, 21, 0.08), transparent 28%), linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(17, 24, 39, 0.82))',
    backdropFilter: 'blur(14px)',
    borderRadius: '30px',
    border: '1px solid rgba(198, 169, 107, 0.18)',
    boxShadow: '0 28px 72px rgba(2, 6, 23, 0.34), inset 0 1px 0 rgba(255,255,255,0.04)',
    padding: '26px',
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
    fontSize: '22px',
    fontWeight: '700',
    color: '#f8fafc',
    margin: 0,
  },

  sectionEyebrow: {
    marginBottom: '8px',
    fontSize: '11px',
    letterSpacing: '0.18em',
    textTransform: 'uppercase' as const,
    color: '#fbbf24',
    fontWeight: 700,
  },

  sectionSubtitle: {
    marginTop: '8px',
    color: '#94a3b8',
    fontSize: '13px',
    lineHeight: 1.5,
    maxWidth: '720px',
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
    gap: '10px',
    backgroundColor: 'transparent',
    borderRadius: '22px',
    overflow: 'hidden',
  },

  tableRow: {
    display: 'grid',
    gridTemplateColumns: '2fr 1fr 1fr 1fr 0.8fr',
    backgroundColor: 'rgba(12, 20, 35, 0.62)',
    borderRadius: '16px',
    border: '1px solid rgba(148, 163, 184, 0.1)',
  },

  tableBodyRow: {
    display: 'grid',
    gridTemplateColumns: '2fr 1fr 1fr 1fr 0.8fr',
    background:
      'linear-gradient(180deg, rgba(9, 16, 29, 0.96), rgba(15, 23, 42, 0.82))',
    borderRadius: '18px',
    border: '1px solid rgba(148, 163, 184, 0.12)',
    boxShadow: '0 14px 34px rgba(2, 6, 23, 0.18)',
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
    padding: '16px',
    fontSize: '14px',
    color: '#f8fafc',
    display: 'flex',
    alignItems: 'center',
  },

  tableCellPrimary: {
    padding: '16px',
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'center',
    gap: '4px',
  },

  tableCellStrong: {
    padding: '16px',
    fontSize: '14px',
    color: '#f8fafc',
    display: 'flex',
    alignItems: 'center',
    fontWeight: 700,
  },

  tableVillaName: {
    color: '#f8fafc',
    fontSize: '15px',
    fontWeight: 700,
  },

  tableVillaMeta: {
    color: '#94a3b8',
    fontSize: '12px',
  },

  tableMetricRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: '12px',
    marginBottom: '18px',
  },

  tableMetricChip: {
    padding: '14px 16px',
    borderRadius: '18px',
    background: 'rgba(15, 23, 42, 0.68)',
    border: '1px solid rgba(148, 163, 184, 0.12)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
  },

  tableMetricLabel: {
    display: 'block',
    marginBottom: '6px',
    fontSize: '11px',
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    color: '#94a3b8',
  },

  tableMetricValue: {
    color: '#f8fafc',
    fontSize: '16px',
    fontWeight: 700,
  },

  statusBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '7px 11px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
  },

  bottomSection: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.12fr) minmax(0, 0.88fr)',
    gap: '24px',
    alignItems: 'start',
  },

  breakdownCard: {
    background:
      'radial-gradient(circle at top left, rgba(59, 130, 246, 0.1), transparent 28%), linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(17, 24, 39, 0.82))',
    backdropFilter: 'blur(14px)',
    borderRadius: '28px',
    border: '1px solid rgba(148, 163, 184, 0.16)',
    boxShadow: '0 24px 64px rgba(2, 6, 23, 0.3)',
    padding: '24px',
  },

  alertsCard: {
    background:
      'radial-gradient(circle at top right, rgba(239, 68, 68, 0.08), transparent 26%), linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(17, 24, 39, 0.82))',
    backdropFilter: 'blur(14px)',
    borderRadius: '28px',
    border: '1px solid rgba(148, 163, 184, 0.16)',
    boxShadow: '0 24px 64px rgba(2, 6, 23, 0.3)',
    padding: '24px',
  },

  economicsCard: {
    background:
      'radial-gradient(circle at top left, rgba(250, 204, 21, 0.08), transparent 30%), linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(17, 24, 39, 0.82))',
    backdropFilter: 'blur(14px)',
    borderRadius: '28px',
    border: '1px solid rgba(198, 169, 107, 0.16)',
    boxShadow: '0 24px 64px rgba(2, 6, 23, 0.3)',
    padding: '24px',
    marginBottom: '24px',
  },

  cardTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#f8fafc',
    margin: '0 0 16px 0',
  },

  breakdownHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '16px',
    marginBottom: '18px',
  },

  breakdownSubtitle: {
    color: '#94a3b8',
    fontSize: '13px',
    lineHeight: 1.5,
  },

  breakdownTotalChip: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'flex-end',
    gap: '4px',
    padding: '10px 12px',
    borderRadius: '16px',
    background: 'rgba(15, 23, 42, 0.82)',
    border: '1px solid rgba(148, 163, 184, 0.14)',
    minWidth: '112px',
  },

  breakdownTotalLabel: {
    fontSize: '11px',
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    color: '#94a3b8',
  },

  breakdownTotalValue: {
    fontSize: '18px',
    color: '#f8fafc',
    fontWeight: 700,
  },

  breakdownLayout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(300px, 0.95fr) minmax(260px, 1.05fr)',
    gap: '24px',
    alignItems: 'stretch',
    marginBottom: '18px',
  },

  breakdownHighlights: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '14px',
  },

  breakdownHighlightCard: {
    padding: '18px',
    borderRadius: '18px',
    background: 'rgba(15, 23, 42, 0.52)',
    border: '1px solid rgba(148, 163, 184, 0.12)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
  },

  breakdownHighlightTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '12px',
  },

  breakdownHighlightTitle: {
    color: '#f8fafc',
    fontSize: '15px',
    fontWeight: 700,
  },

  breakdownHighlightPercent: {
    color: '#cbd5e1',
    fontSize: '12px',
    fontWeight: 700,
  },

  breakdownHighlightValue: {
    color: '#f8fafc',
    fontSize: '18px',
    fontWeight: 800,
    marginBottom: '8px',
    whiteSpace: 'nowrap' as const,
  },

  breakdownHighlightCopy: {
    color: '#94a3b8',
    fontSize: '12px',
    lineHeight: 1.55,
  },

  breakdownRows: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '14px',
  },

  breakdownRow: {
    padding: '12px 14px',
    borderRadius: '16px',
    background: 'rgba(15, 23, 42, 0.55)',
    border: '1px solid rgba(148, 163, 184, 0.12)',
  },

  breakdownRowTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '10px',
  },

  breakdownNameWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },

  breakdownName: {
    color: '#f8fafc',
    fontSize: '14px',
    fontWeight: 600,
  },

  breakdownNumbers: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    flexWrap: 'wrap' as const,
    justifyContent: 'flex-end',
  },

  breakdownValue: {
    color: '#f8fafc',
    fontSize: '13px',
    fontWeight: 700,
  },

  breakdownPercent: {
    color: '#cbd5e1',
    fontSize: '12px',
  },

  breakdownTrack: {
    width: '100%',
    height: '8px',
    borderRadius: '999px',
    background: 'rgba(51, 65, 85, 0.65)',
    overflow: 'hidden',
  },

  breakdownFill: {
    height: '100%',
    borderRadius: '999px',
    boxShadow: '0 0 18px rgba(255,255,255,0.12)',
  },

  breakdownTrendRow: {
    marginTop: '10px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '10px',
  },

  breakdownTrendLabel: {
    color: '#94a3b8',
    fontSize: '12px',
  },

  breakdownTrendValue: {
    fontSize: '12px',
    fontWeight: 700,
  },

  breakdownDonutWrap: {
    position: 'relative' as const,
    minHeight: '340px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },

  breakdownDonutCenter: {
    position: 'absolute' as const,
    inset: '50% auto auto 50%',
    transform: 'translate(-50%, -50%)',
    textAlign: 'center' as const,
    width: '190px',
    pointerEvents: 'none' as const,
    zIndex: 2,
  },

  breakdownCenterLabel: {
    color: '#94a3b8',
    fontSize: '11px',
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
  },

  breakdownCenterValue: {
    marginTop: '8px',
    color: '#f8fafc',
    fontSize: 'clamp(20px, 1.5vw, 28px)',
    fontWeight: 800,
    lineHeight: 1.05,
    whiteSpace: 'nowrap' as const,
    letterSpacing: '-0.04em',
    textShadow: '0 10px 28px rgba(15, 23, 42, 0.45)',
  },

  breakdownCenterSubtext: {
    marginTop: '6px',
    color: '#94a3b8',
    fontSize: '12px',
  },

  breakdownDonutHalo: {
    position: 'absolute' as const,
    width: '250px',
    height: '250px',
    borderRadius: '999px',
    background: 'radial-gradient(circle, rgba(96,165,250,0.08), transparent 68%)',
    filter: 'blur(8px)',
    pointerEvents: 'none' as const,
    zIndex: 1,
  },

  alertsList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '10px',
  },

  alertItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    padding: '12px 14px',
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    borderRadius: '14px',
    border: '1px solid rgba(148, 163, 184, 0.14)',
  },

  alertIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '72px',
    padding: '6px 10px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
  },

  alertIconWarning: {
    color: '#fbbf24',
    background: 'rgba(245, 158, 11, 0.14)',
    border: '1px solid rgba(245, 158, 11, 0.24)',
  },

  alertIconCritical: {
    color: '#fca5a5',
    background: 'rgba(239, 68, 68, 0.14)',
    border: '1px solid rgba(239, 68, 68, 0.24)',
  },

  alertText: {
    fontSize: '14px',
    color: '#e2e8f0',
    lineHeight: 1.5,
  },

  noAlerts: {
    textAlign: 'left' as const,
    color: '#86efac',
    fontSize: '14px',
    padding: '18px',
    borderRadius: '16px',
    background: 'rgba(15, 23, 42, 0.62)',
    border: '1px solid rgba(16, 185, 129, 0.18)',
  },

  economicsGrid: {
    display: 'grid',
    gap: '16px',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  },

  economicItem: {
    textAlign: 'left' as const,
    padding: '16px 18px',
    borderRadius: '18px',
    background: 'rgba(15, 23, 42, 0.58)',
    border: '1px solid rgba(148, 163, 184, 0.12)',
  },

  economicValue: {
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#f8fafc',
    marginBottom: '6px',
  },

  economicLabel: {
    fontSize: '12px',
    color: '#94a3b8',
  },
}

