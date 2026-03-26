export type VillaMarketModel = {
  capitalBasis: number
  targetAnnualRoi: number
  nightlyLow: number
  nightlyHigh: number
  baseOccupancy: number
  monthlyStaff: number
  utilityBase: number
  utilityPerOccupiedNight: number
  cleaningPerTurnover: number
  monthlyMaintenanceReserve: number
}

const DEFAULT_MODEL: VillaMarketModel = {
  capitalBasis: 2_850_000_000,
  targetAnnualRoi: 0.165,
  nightlyLow: 2_300_000,
  nightlyHigh: 3_700_000,
  baseOccupancy: 0.58,
  monthlyStaff: 11_500_000,
  utilityBase: 2_100_000,
  utilityPerOccupiedNight: 75_000,
  cleaningPerTurnover: 650_000,
  monthlyMaintenanceReserve: 2_000_000,
}

export const MONTHLY_PRICE_MULTIPLIER = [1.06, 1.04, 0.99, 0.95, 0.94, 0.98, 1.08, 1.16, 1.18, 1.1, 1.02, 1.12] as const
export const MONTHLY_OCCUPANCY_MULTIPLIER = [1.02, 0.98, 0.94, 0.9, 0.88, 0.93, 1.02, 1.11, 1.15, 1.08, 0.99, 1.06] as const

export const VILLA_MARKET_MODELS: Record<string, VillaMarketModel> = {
  'a5cff931-83e3-4ec3-8ad7-3b7e05e91ca8': {
    capitalBasis: 2_650_000_000,
    targetAnnualRoi: 0.164,
    nightlyLow: 2_250_000,
    nightlyHigh: 3_450_000,
    baseOccupancy: 0.61,
    monthlyStaff: 10_800_000,
    utilityBase: 2_000_000,
    utilityPerOccupiedNight: 72_000,
    cleaningPerTurnover: 620_000,
    monthlyMaintenanceReserve: 1_850_000,
  },
  'e428f31f-feff-4d70-9afe-4983f4a7a46c': {
    capitalBasis: 2_800_000_000,
    targetAnnualRoi: 0.158,
    nightlyLow: 2_400_000,
    nightlyHigh: 3_650_000,
    baseOccupancy: 0.58,
    monthlyStaff: 11_300_000,
    utilityBase: 2_150_000,
    utilityPerOccupiedNight: 76_000,
    cleaningPerTurnover: 680_000,
    monthlyMaintenanceReserve: 2_050_000,
  },
  '2122f6de-1cf9-43e4-8efc-f180ca2b0ef6': {
    capitalBasis: 3_050_000_000,
    targetAnnualRoi: 0.171,
    nightlyLow: 2_850_000,
    nightlyHigh: 3_950_000,
    baseOccupancy: 0.56,
    monthlyStaff: 12_400_000,
    utilityBase: 2_450_000,
    utilityPerOccupiedNight: 84_000,
    cleaningPerTurnover: 760_000,
    monthlyMaintenanceReserve: 2_350_000,
  },
  'fe8c1a90-2bd8-47d6-bdde-165b5bad36bb': {
    capitalBasis: 2_900_000_000,
    targetAnnualRoi: 0.166,
    nightlyLow: 2_650_000,
    nightlyHigh: 3_850_000,
    baseOccupancy: 0.59,
    monthlyStaff: 11_900_000,
    utilityBase: 2_250_000,
    utilityPerOccupiedNight: 80_000,
    cleaningPerTurnover: 720_000,
    monthlyMaintenanceReserve: 2_200_000,
  },
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function getVillaMarketModel(villaId?: string | null) {
  if (!villaId) {
    return DEFAULT_MODEL
  }

  return VILLA_MARKET_MODELS[villaId] || DEFAULT_MODEL
}

export function getNightlyRateForVilla(villaId: string, checkIn: Date, variance = 0) {
  const model = getVillaMarketModel(villaId)
  const monthMultiplier = MONTHLY_PRICE_MULTIPLIER[checkIn.getMonth()] || 1
  const midpoint = (model.nightlyLow + model.nightlyHigh) / 2
  const spread = (model.nightlyHigh - model.nightlyLow) / 2
  const rate = midpoint + spread * variance

  return clamp(Math.round(rate * monthMultiplier), 2_000_000, 4_000_000)
}

export function getTargetOccupancyForMonth(villaId: string, date: Date, variance = 0) {
  const model = getVillaMarketModel(villaId)
  const monthMultiplier = MONTHLY_OCCUPANCY_MULTIPLIER[date.getMonth()] || 1

  return clamp(model.baseOccupancy * monthMultiplier + variance, 0.44, 0.76)
}

export function getCapitalBasisForVilla(villaId?: string | null) {
  return getVillaMarketModel(villaId).capitalBasis
}

export function getTargetAnnualRoiForVilla(villaId?: string | null) {
  return getVillaMarketModel(villaId).targetAnnualRoi
}

export function getAnnualizedRoiPercent(netProfit: number, capitalBasis: number, rangeDays: number) {
  if (capitalBasis <= 0 || rangeDays <= 0) {
    return 0
  }

  const annualizedProfit = (netProfit / rangeDays) * 365
  return (annualizedProfit / capitalBasis) * 100
}
