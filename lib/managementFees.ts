import type { ManagementFeeConfigRecord, ManagementFeeType, VillaRecord } from '@/lib/types'

export type ManagementFeeConfig = {
  villaId: string
  villaName: string
  feeType: ManagementFeeType
  percentageRate: number
  fixedAmount: number
  updatedByName: string
  updatedAt: string | null
}

export function normalizeManagementFeeConfigs(configRows: ManagementFeeConfigRecord[], villas: VillaRecord[]) {
  const rowByVillaId = new Map(configRows.map((row) => [row.villa_id, row]))

  return villas.map((villa) => {
    const row = rowByVillaId.get(villa.id)
    return {
      villaId: villa.id,
      villaName: villa.name,
      feeType: (row?.fee_type as ManagementFeeType) || 'none',
      percentageRate: Number(row?.percentage_rate ?? 0),
      fixedAmount: Number(row?.fixed_amount ?? 0),
      updatedByName: row?.updated_by_name || 'Not configured',
      updatedAt: row?.updated_at || null,
    } satisfies ManagementFeeConfig
  })
}

function getMonthBounds(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1)
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  return { start, end }
}

function toDayStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function getInclusiveDayCount(start: Date, end: Date) {
  return Math.max(1, Math.round((toDayStart(end).getTime() - toDayStart(start).getTime()) / 86400000) + 1)
}

function getProratedFixedAmount(fixedAmount: number, scopeStart: Date, scopeEnd: Date) {
  if (fixedAmount <= 0 || scopeEnd < scopeStart) {
    return 0
  }

  let total = 0
  const cursor = new Date(scopeStart.getFullYear(), scopeStart.getMonth(), 1)

  while (cursor <= scopeEnd) {
    const { start, end } = getMonthBounds(cursor)
    const overlapStart = scopeStart > start ? scopeStart : start
    const overlapEnd = scopeEnd < end ? scopeEnd : end

    if (overlapEnd >= overlapStart) {
      const overlapDays = getInclusiveDayCount(overlapStart, overlapEnd)
      const monthDays = getInclusiveDayCount(start, end)
      total += fixedAmount * (overlapDays / monthDays)
    }

    cursor.setMonth(cursor.getMonth() + 1, 1)
  }

  return total
}

export function calculateManagementFeeForRange(params: {
  revenue: number
  config?: ManagementFeeConfig | null
  scopeStart: Date
  scopeEnd: Date
}) {
  const { revenue, config, scopeStart, scopeEnd } = params

  if (!config || config.feeType === 'none') {
    return 0
  }

  if (config.feeType === 'percentage') {
    return revenue * (config.percentageRate / 100)
  }

  return getProratedFixedAmount(config.fixedAmount, scopeStart, scopeEnd)
}
