import type { AppRole, AppUser, BookingRecord, ExpenseRecord, VillaRecord } from '@/lib/types'

export const DEFAULT_USERS: AppUser[] = [
  { id: 'admin-core', name: 'Core Admin', role: 'admin', assignedVillaIds: [] },
  { id: 'staff-ops', name: 'Operations Staff', role: 'staff', assignedVillaIds: [] },
  { id: 'investor-1', name: 'Investor', role: 'investor', assignedVillaIds: [] },
]

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: 'Admin',
  staff: 'Staff',
  investor: 'Investor',
}

export function canManageUsers(role: AppRole) {
  return role === 'admin'
}

export function canAccessExpenses(role: AppRole) {
  return role !== 'investor'
}

export function canAccessInbox(role: AppRole) {
  return role !== 'investor'
}

export function canAccessOperations(role: AppRole) {
  return role !== 'investor'
}

export function canEditBookings(role: AppRole) {
  return role !== 'investor'
}

export function canEditExpenses(role: AppRole) {
  return role !== 'investor'
}

export function canSeePortfolio(role: AppRole) {
  return role === 'admin'
}

export function canSeeProfit(role: AppRole) {
  return role !== 'staff'
}

export function canSeeVendorDetails(role: AppRole) {
  return role === 'admin'
}

export function canSeeAlerts(role: AppRole) {
  return role !== 'investor'
}

export function canSeeExpenseBreakdown(role: AppRole) {
  return role !== 'investor'
}

export function resolveAccessibleVillaIds(user: AppUser) {
  if (user.role === 'admin') {
    return null
  }

  if (user.role === 'staff' && user.assignedVillaIds.length === 0) {
    return null
  }

  return user.assignedVillaIds
}

export function filterVillasForUser(villas: VillaRecord[], user: AppUser) {
  const accessibleVillaIds = resolveAccessibleVillaIds(user)

  if (accessibleVillaIds === null) {
    return villas
  }

  return villas.filter((villa) => accessibleVillaIds.includes(villa.id))
}

export function filterBookingsForUser(bookings: BookingRecord[], user: AppUser) {
  const accessibleVillaIds = resolveAccessibleVillaIds(user)

  if (accessibleVillaIds === null) {
    return bookings
  }

  return bookings.filter((booking) => booking.villa_id && accessibleVillaIds.includes(booking.villa_id))
}

export function filterExpensesForUser(expenses: ExpenseRecord[], user: AppUser) {
  const accessibleVillaIds = resolveAccessibleVillaIds(user)

  if (accessibleVillaIds === null) {
    return expenses
  }

  return expenses.filter((expense) => expense.villa_id && accessibleVillaIds.includes(expense.villa_id))
}

export function canAccessVilla(user: AppUser, villaId: string) {
  const accessibleVillaIds = resolveAccessibleVillaIds(user)

  if (accessibleVillaIds === null) {
    return true
  }

  return accessibleVillaIds.includes(villaId)
}
