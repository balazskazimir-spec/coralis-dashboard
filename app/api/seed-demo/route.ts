import { supabase } from '@/lib/supabase'
import {
  MONTHLY_OCCUPANCY_MULTIPLIER,
  getNightlyRateForVilla,
  getTargetAnnualRoiForVilla,
  getTargetOccupancyForMonth,
  getVillaMarketModel,
} from '@/lib/marketModel'
import type { BookingRecord, ExpenseRecord } from '@/lib/types'

const VILLA_IDS = {
  villaSerra: 'a5cff931-83e3-4ec3-8ad7-3b7e05e91ca8',
  villaMira: 'e428f31f-feff-4d70-9afe-4983f4a7a46c',
  villaAzure: '2122f6de-1cf9-43e4-8efc-f180ca2b0ef6',
  villaCoral: 'fe8c1a90-2bd8-47d6-bdde-165b5bad36bb',
} as const

const GUEST_FIRST_NAMES = ['Ava', 'Milo', 'Sofia', 'Ethan', 'Luna', 'Noah', 'Chloe', 'Leo', 'Maya', 'Theo']
const GUEST_LAST_NAMES = ['Smith', 'Tan', 'Patel', 'Williams', 'Garcia', 'Nguyen', 'Brown', 'Davis', 'Lee', 'Walker']
const EXPENSE_DATES = { staff: '05', utilities: '11', cleaning: '18', maintenance: '25' } as const

type MonthlySnapshot = {
  villaId: string
  yearMonth: string
  revenue: number
  occupiedNights: number
  turnovers: number
}

type ExpenseComponent = {
  villaId: string
  yearMonth: string
  amount: number
  date: string
  category: ExpenseRecord['category']
  note: string
}

const DAY_MS = 86_400_000

function hashKey(key: string) {
  let hash = 0

  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0
  }

  return hash
}

function seededUnit(key: string) {
  return hashKey(key) / 4_294_967_295
}

function seededBetween(key: string, min: number, max: number) {
  return min + seededUnit(key) * (max - min)
}

function seededInt(key: string, min: number, max: number) {
  return Math.floor(seededBetween(key, min, max + 1))
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function addDays(date: Date, days: number) {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function daysBetween(start: Date, end: Date) {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / DAY_MS))
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function pickValue<T>(items: readonly T[], key: string) {
  return items[seededInt(key, 0, items.length - 1)]
}

function guestNameFor(key: string) {
  const firstName = pickValue(GUEST_FIRST_NAMES, `${key}-first`)
  const lastName = pickValue(GUEST_LAST_NAMES, `${key}-last`)
  return `${firstName} ${lastName}`
}

function buildMonthlySnapshots(startDate: Date, endDate: Date) {
  const snapshots = new Map<string, MonthlySnapshot>()
  const cursor = new Date(startDate)

  while (cursor <= endDate) {
    const key = monthKey(cursor)
    for (const villaId of Object.values(VILLA_IDS)) {
      snapshots.set(`${villaId}:${key}`, {
        villaId,
        yearMonth: key,
        revenue: 0,
        occupiedNights: 0,
        turnovers: 0,
      })
    }

    cursor.setMonth(cursor.getMonth() + 1, 1)
  }

  return snapshots
}

function pushExpense(components: ExpenseComponent[], component: ExpenseComponent) {
  components.push({
    ...component,
    amount: Math.max(50_000, Math.round(component.amount / 10_000) * 10_000),
  })
}

export async function POST() {
  try {
    const allVillaIds = Object.values(VILLA_IDS)

    await supabase.from('bookings').delete().in('villa_id', allVillaIds)
    await supabase.from('expenses').delete().in('villa_id', allVillaIds)

    const startDate = startOfMonth(new Date(new Date().getFullYear() - 2, new Date().getMonth(), 1))
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const bookingHorizon = new Date(today)
    bookingHorizon.setDate(bookingHorizon.getDate() + 45)

    const generatedBookings: Array<Omit<BookingRecord, 'id'>> = []
    const monthlySnapshots = buildMonthlySnapshots(startDate, today)

    for (const villaId of allVillaIds) {
      const cursor = new Date(startDate)

      while (cursor <= bookingHorizon) {
        const currentMonthKey = monthKey(cursor)
        const monthStart = startOfMonth(cursor)
        const monthEnd = endOfMonth(cursor)
        const lastBookableDate = monthEnd < bookingHorizon ? monthEnd : bookingHorizon
        const totalDaysInMonthWindow = daysBetween(monthStart, addDays(lastBookableDate, 1))
        const occupancyVariance = seededBetween(`${villaId}:${currentMonthKey}:occ`, -0.02, 0.02)
        const targetOccupancy = getTargetOccupancyForMonth(villaId, monthStart, occupancyVariance)
        const targetNights = clamp(
          Math.round(totalDaysInMonthWindow * targetOccupancy),
          Math.max(8, Math.round(totalDaysInMonthWindow * 0.42)),
          Math.max(10, Math.round(totalDaysInMonthWindow * 0.78))
        )

        let occupiedNights = 0
        let bookingIndex = 0
        let bookingCursor = addDays(monthStart, seededInt(`${villaId}:${currentMonthKey}:start-gap`, 0, 2))
        const seasonalMultiplier = MONTHLY_OCCUPANCY_MULTIPLIER[monthStart.getMonth()] || 1
        const maxStayLength = seasonalMultiplier > 1.05 ? 6 : 5

        while (bookingCursor <= lastBookableDate && occupiedNights < targetNights && bookingIndex < 20) {
          const maxAvailableNights = daysBetween(bookingCursor, addDays(lastBookableDate, 1))
          const remainingNights = targetNights - occupiedNights
          const plannedStay = seededInt(`${villaId}:${currentMonthKey}:stay:${bookingIndex}`, 2, maxStayLength)
          const stayLength = Math.min(plannedStay, maxAvailableNights, remainingNights)

          if (stayLength < 2) {
            bookingCursor = addDays(bookingCursor, 1)
            bookingIndex += 1
            continue
          }

          const checkIn = new Date(bookingCursor)
          const checkOut = addDays(checkIn, stayLength)
          const rateVariance = seededBetween(`${villaId}:${currentMonthKey}:rate:${bookingIndex}`, -0.92, 0.92)
          const pricePerNight = getNightlyRateForVilla(villaId, checkIn, rateVariance)

          generatedBookings.push({
            guest_name: guestNameFor(`${villaId}:${currentMonthKey}:guest:${bookingIndex}`),
            check_in: formatDate(checkIn),
            check_out: formatDate(checkOut),
            price_per_night: pricePerNight,
            villa_id: villaId,
          })

          const snapshot = monthlySnapshots.get(`${villaId}:${currentMonthKey}`)
          if (snapshot) {
            snapshot.revenue += stayLength * pricePerNight
            snapshot.occupiedNights += stayLength
            snapshot.turnovers += 1
          }

          occupiedNights += stayLength
          bookingCursor = addDays(checkOut, seededInt(`${villaId}:${currentMonthKey}:gap:${bookingIndex}`, 1, 3))
          bookingIndex += 1
        }

        cursor.setMonth(cursor.getMonth() + 1, 1)
      }
    }

    const { error: bookingError } = await supabase.from('bookings').insert(generatedBookings)

    const baselineExpenses: ExpenseComponent[] = []
    const baselineTotalsByVilla: Record<string, number> = {}
    const revenueTotalsByVilla: Record<string, number> = {}

    for (const villaId of allVillaIds) {
      baselineTotalsByVilla[villaId] = 0
      revenueTotalsByVilla[villaId] = 0
    }

    monthlySnapshots.forEach((snapshot) => {
      const model = getVillaMarketModel(snapshot.villaId)
      const currentMonthDate = new Date(`${snapshot.yearMonth}-01T00:00:00`)
      const seasonalMaintenance = (MONTHLY_OCCUPANCY_MULTIPLIER[currentMonthDate.getMonth()] || 1) > 1.05 ? 350_000 : 0
      const staff = model.monthlyStaff + seededBetween(`${snapshot.villaId}:${snapshot.yearMonth}:staff`, -750_000, 900_000)
      const utilities =
        model.utilityBase +
        snapshot.occupiedNights * model.utilityPerOccupiedNight +
        seededBetween(`${snapshot.villaId}:${snapshot.yearMonth}:utilities`, -220_000, 320_000)
      const cleaning =
        snapshot.turnovers * model.cleaningPerTurnover +
        snapshot.occupiedNights * 32_000 +
        seededBetween(`${snapshot.villaId}:${snapshot.yearMonth}:cleaning`, -180_000, 240_000)
      const maintenance =
        model.monthlyMaintenanceReserve +
        seasonalMaintenance +
        seededBetween(`${snapshot.villaId}:${snapshot.yearMonth}:maintenance`, -250_000, 420_000)

      pushExpense(baselineExpenses, {
        villaId: snapshot.villaId,
        yearMonth: snapshot.yearMonth,
        amount: staff,
        date: `${snapshot.yearMonth}-${EXPENSE_DATES.staff}`,
        category: 'staff',
        note: 'Villa team payroll and local operations management',
      })

      pushExpense(baselineExpenses, {
        villaId: snapshot.villaId,
        yearMonth: snapshot.yearMonth,
        amount: utilities,
        date: `${snapshot.yearMonth}-${EXPENSE_DATES.utilities}`,
        category: 'utilities',
        note: 'Electricity, water, Wi-Fi, drinking water, and LPG refills',
      })

      pushExpense(baselineExpenses, {
        villaId: snapshot.villaId,
        yearMonth: snapshot.yearMonth,
        amount: cleaning,
        date: `${snapshot.yearMonth}-${EXPENSE_DATES.cleaning}`,
        category: 'cleaning',
        note: 'Turnover cleaning, linen laundry, and amenities restock',
      })

      pushExpense(baselineExpenses, {
        villaId: snapshot.villaId,
        yearMonth: snapshot.yearMonth,
        amount: maintenance,
        date: `${snapshot.yearMonth}-${EXPENSE_DATES.maintenance}`,
        category: 'maintenance',
        note: 'Pool, garden, AC servicing, and preventive maintenance reserve',
      })

      if (currentMonthDate.getMonth() % 3 === 0) {
        pushExpense(baselineExpenses, {
          villaId: snapshot.villaId,
          yearMonth: snapshot.yearMonth,
          amount: seededBetween(`${snapshot.villaId}:${snapshot.yearMonth}:deep-clean`, 1_100_000, 1_950_000),
          date: `${snapshot.yearMonth}-22`,
          category: 'cleaning',
          note: 'Quarterly deep clean before peak guest turnover',
        })
      }

      if (currentMonthDate.getMonth() % 4 === 1) {
        pushExpense(baselineExpenses, {
          villaId: snapshot.villaId,
          yearMonth: snapshot.yearMonth,
          amount: seededBetween(`${snapshot.villaId}:${snapshot.yearMonth}:service`, 1_350_000, 2_600_000),
          date: `${snapshot.yearMonth}-28`,
          category: 'maintenance',
          note: 'Scheduled AC and pool equipment service visit',
        })
      }

      baselineTotalsByVilla[snapshot.villaId] += staff + utilities + cleaning + maintenance
      revenueTotalsByVilla[snapshot.villaId] += snapshot.revenue
    })

    const generatedExpenses: Array<Omit<ExpenseRecord, 'id'>> = baselineExpenses.map((expense) => {
      const totalRevenue = revenueTotalsByVilla[expense.villaId] || 0
      const targetTotalProfit = getVillaMarketModel(expense.villaId).capitalBasis * getTargetAnnualRoiForVilla(expense.villaId) * 2
      const rawTargetTotalExpenses = Math.max(0, totalRevenue - targetTotalProfit)
      const minimumRealisticExpenses = totalRevenue * 0.27
      const maximumRealisticExpenses = totalRevenue * 0.39
      const targetTotalExpenses = clamp(rawTargetTotalExpenses, minimumRealisticExpenses, maximumRealisticExpenses)
      const scalingFactor = targetTotalExpenses / Math.max(1, baselineTotalsByVilla[expense.villaId] || 1)

      return {
        villa_id: expense.villaId,
        amount: Math.round((expense.amount * scalingFactor) / 10_000) * 10_000,
        date: expense.date,
        category: expense.category,
        note: expense.note,
      }
    })

    const { error: expenseError } = await supabase.from('expenses').insert(generatedExpenses)

    const villaSummary = allVillaIds.map((villaId) => {
      const revenue = revenueTotalsByVilla[villaId] || 0
      const expenses = generatedExpenses
        .filter((expense) => expense.villa_id === villaId)
        .reduce((sum, expense) => sum + Number(expense.amount || 0), 0)
      const annualizedProfit = (revenue - expenses) / 2
      const roi = (annualizedProfit / getVillaMarketModel(villaId).capitalBasis) * 100

      return {
        villaId,
        annualRevenue: Math.round(revenue / 2),
        annualExpenses: Math.round(expenses / 2),
        annualNetProfit: Math.round(annualizedProfit),
        annualRoiPercent: Number(roi.toFixed(1)),
      }
    })

    return Response.json({
      success: true,
      message: 'Believable 24-month Lombok villa demo data seeded.',
      summary: {
        villas: allVillaIds.length,
        bookings: generatedBookings.length,
        expenses: generatedExpenses.length,
      },
      villaSummary,
      errors: { bookingError, expenseError },
    })
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
