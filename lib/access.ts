import type { AppRole, AppUser, BookingRecord, ExpenseRecord, VillaRecord } from '@/lib/types'

export const DEFAULT_VILLA_IDS = {
  serra: 'a5cff931-83e3-4ec3-8ad7-3b7e05e91ca8',
  mira: 'e428f31f-feff-4d70-9afe-4983f4a7a46c',
  azure: '2122f6de-1cf9-43e4-8efc-f180ca2b0ef6',
  coral: 'fe8c1a90-2bd8-47d6-bdde-165b5bad36bb',
} as const

export const DEFAULT_USERS: AppUser[] = [
  { id: 'admin-core', name: 'Core Admin', role: 'admin', assignedVillaIds: [] },
  { id: 'staff-ops', name: 'Operations Staff', role: 'staff', assignedVillaIds: [] },
  {
    id: 'investor-1',
    name: 'Investor',
    role: 'investor',
    assignedVillaIds: [DEFAULT_VILLA_IDS.serra, DEFAULT_VILLA_IDS.mira],
  },
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
  void role
  return true
}

export function canAccessInbox(role: AppRole) {
  return role !== 'investor'
}

export function canAccessInvoices(role: AppRole) {
  void role
  return true
}

export function canAccessManagementFees(role: AppRole) {
  return role !== 'staff'
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

export function normalizeUsers(users: AppUser[]) {
  return DEFAULT_USERS.map((defaultUser) => {
    const storedUser = users.find((user) => user.id === defaultUser.id)

    if (!storedUser) {
      return defaultUser
    }

    return {
      ...defaultUser,
      ...storedUser,
      assignedVillaIds:
        storedUser.assignedVillaIds.length > 0
          ? storedUser.assignedVillaIds
          : defaultUser.assignedVillaIds,
    }
  })
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
