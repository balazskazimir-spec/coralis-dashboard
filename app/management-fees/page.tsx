'use client'

import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { canAccessManagementFees, filterBookingsForUser, filterExpensesForUser, filterVillasForUser } from '@/lib/access'
import { useRole } from '@/components/auth/RoleProvider'
import { BOOKING_SELECT, EXPENSE_SELECT, MANAGEMENT_FEE_SELECT, VILLA_SELECT } from '@/lib/dbSelects'
import { calculateManagementFeeForRange, normalizeManagementFeeConfigs } from '@/lib/managementFees'
import { supabase } from '@/lib/supabase'
import type { BookingRecord, ExpenseRecord, ManagementFeeConfigRecord, ManagementFeeType, VillaRecord } from '@/lib/types'

type DateRange = '30d' | '90d' | 'ytd'
type DraftState = Record<string, { feeType: ManagementFeeType; percentageRate: string; fixedAmount: string }>

const DAY_MS = 86_400_000
const SERIES_COLORS = ['#c6a96b', '#18c29c', '#60a5fa', '#f97316', '#f472b6', '#a78bfa']

function getCutoff(range: DateRange) {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  if (range === '30d') {
    now.setDate(now.getDate() - 29)
    return now
  }
  if (range === '90d') {
    now.setDate(now.getDate() - 89)
    return now
  }
  if (range === 'ytd') {
    now.setMonth(0, 1)
    return now
  }
  return now
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function bookingRevenue(booking: BookingRecord) {
  const nights = Math.max(0, (new Date(booking.check_out).getTime() - new Date(booking.check_in).getTime()) / DAY_MS)
  return nights * (Number(booking.price_per_night) || 0)
}

function money(value: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value)
}

function isMissingTable(message?: string | null) {
  const value = message?.toLowerCase() || ''
  return value.includes('does not exist') || value.includes('management_fee_configs')
}

export default function ManagementFeesPage() {
  const { currentUser } = useRole()
  const [villas, setVillas] = useState<VillaRecord[]>([])
  const [bookings, setBookings] = useState<BookingRecord[]>([])
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([])
  const [configRows, setConfigRows] = useState<ManagementFeeConfigRecord[]>([])
  const [dateRange, setDateRange] = useState<DateRange>('ytd')
  const [loading, setLoading] = useState(true)
  const [busyVillaId, setBusyVillaId] = useState('')
  const [setupMessage, setSetupMessage] = useState('')
  const [drafts, setDrafts] = useState<DraftState>({})

  const isAdmin = currentUser.role === 'admin'
  const scopeStart = useMemo(() => startOfDay(getCutoff(dateRange)), [dateRange])
  const scopeEnd = useMemo(() => startOfDay(new Date()), [])

  async function loadData() {
    setLoading(true)
    const [villasResult, bookingsResult, expensesResult, configsResult] = await Promise.all([
      supabase.from('villas').select(VILLA_SELECT).order('name'),
      supabase.from('bookings').select(BOOKING_SELECT).order('check_in', { ascending: false }),
      supabase.from('expenses').select(EXPENSE_SELECT).order('date', { ascending: false }),
      supabase.from('management_fee_configs').select(MANAGEMENT_FEE_SELECT),
    ])

    setVillas((villasResult.data as VillaRecord[]) || [])
    setBookings((bookingsResult.data as BookingRecord[]) || [])
    setExpenses((expensesResult.data as ExpenseRecord[]) || [])
    const nextConfigRows = isMissingTable(configsResult.error?.message) ? [] : ((configsResult.data as ManagementFeeConfigRecord[]) || [])
    setConfigRows(nextConfigRows)
    setDrafts(
      Object.fromEntries(
        normalizeManagementFeeConfigs(nextConfigRows, (villasResult.data as VillaRecord[]) || []).map((config) => [
          config.villaId,
          {
            feeType: config.feeType,
            percentageRate: String(config.percentageRate || 0),
            fixedAmount: String(config.fixedAmount || 0),
          },
        ])
      )
    )
    setSetupMessage(
      isMissingTable(configsResult.error?.message)
        ? 'The management_fee_configs table is not available yet. Run supabase/management_fee_schema.sql in the Supabase SQL editor first.'
        : ''
    )
    setLoading(false)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [])

  const visibleVillas = useMemo(() => filterVillasForUser(villas, currentUser), [currentUser, villas])
  const visibleVillaIds = useMemo(() => new Set(visibleVillas.map((villa) => villa.id)), [visibleVillas])
  const visibleBookings = useMemo(
    () => filterBookingsForUser(bookings, currentUser).filter((booking) => booking.villa_id && visibleVillaIds.has(booking.villa_id)),
    [bookings, currentUser, visibleVillaIds]
  )
  const visibleExpenses = useMemo(
    () => filterExpensesForUser(expenses, currentUser).filter((expense) => expense.villa_id && visibleVillaIds.has(expense.villa_id)),
    [currentUser, expenses, visibleVillaIds]
  )
  const configs = useMemo(() => normalizeManagementFeeConfigs(configRows, visibleVillas), [configRows, visibleVillas])

  const villaRows = useMemo(() => {
    return configs.map((config) => {
      const villaBookings = visibleBookings.filter((booking) => booking.villa_id === config.villaId && new Date(booking.check_in) >= scopeStart)
      const villaExpenses = visibleExpenses.filter((expense) => expense.villa_id === config.villaId && expense.date && new Date(expense.date) >= scopeStart)
      const revenue = villaBookings.reduce((sum, booking) => sum + bookingRevenue(booking), 0)
      const cost = villaExpenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0)
      const grossProfit = revenue - cost
      const managementFee = calculateManagementFeeForRange({ revenue, config, scopeStart, scopeEnd })
      const netProfit = grossProfit - managementFee

      const monthStart = new Date(scopeEnd.getFullYear(), scopeEnd.getMonth(), 1)
      const monthBookings = visibleBookings.filter((booking) => booking.villa_id === config.villaId && new Date(booking.check_in) >= monthStart)
      const monthRevenue = monthBookings.reduce((sum, booking) => sum + bookingRevenue(booking), 0)
      const projectedMonthlyFee =
        config.feeType === 'percentage'
          ? monthRevenue * (config.percentageRate / 100)
          : config.feeType === 'fixed'
            ? config.fixedAmount
            : 0

      return { ...config, revenue, cost, grossProfit, managementFee, netProfit, projectedMonthlyFee }
    })
  }, [configs, scopeEnd, scopeStart, visibleBookings, visibleExpenses])

  const totalManagementFee = villaRows.reduce((sum, row) => sum + row.managementFee, 0)
  const projectedMonthlyFee = villaRows.reduce((sum, row) => sum + row.projectedMonthlyFee, 0)
  const totalNetProfit = villaRows.reduce((sum, row) => sum + row.netProfit, 0)

  const feeHistory = useMemo(() => {
    return Array.from({ length: 6 }).map((_, index) => {
      const monthDate = new Date(scopeEnd.getFullYear(), scopeEnd.getMonth() - (5 - index), 1)
      const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
      const monthEnd = endOfMonth(monthDate)
      const feeByVilla = Object.fromEntries(
        configs.map((config) => {
          const revenue = visibleBookings
            .filter((booking) => booking.villa_id === config.villaId && new Date(booking.check_in) >= monthStart && new Date(booking.check_in) <= monthEnd)
            .reduce((revenueSum, booking) => revenueSum + bookingRevenue(booking), 0)
          const fee = calculateManagementFeeForRange({ revenue, config, scopeStart: monthStart, scopeEnd: monthEnd })
          return [config.villaId, fee]
        })
      )
      const total = Object.values(feeByVilla).reduce((sum, value) => sum + Number(value), 0)

      return {
        label: monthDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        total,
        ...feeByVilla,
      }
    })
  }, [configs, scopeEnd, visibleBookings])

  async function saveVillaConfig(villaId: string) {
    const draft = drafts[villaId]
    if (!draft) {
      return
    }

    setBusyVillaId(villaId)
    await supabase.from('management_fee_configs').upsert({
      villa_id: villaId,
      fee_type: draft.feeType,
      percentage_rate: draft.feeType === 'percentage' ? Number(draft.percentageRate || 0) : 0,
      fixed_amount: draft.feeType === 'fixed' ? Number(draft.fixedAmount || 0) : 0,
      updated_by_user_id: currentUser.id,
      updated_by_name: currentUser.name,
      updated_at: new Date().toISOString(),
    })
    await loadData()
    setBusyVillaId('')
  }

  if (!canAccessManagementFees(currentUser.role)) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <h1 style={styles.title}>Management Fee</h1>
          <p style={styles.copy}>This workspace is available for CEO/admin and investors only.</p>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>{isAdmin ? 'CEO Control' : 'Investor Visibility'}</div>
          <h1 style={styles.title}>Management Fee</h1>
          <p style={styles.copy}>Per-villa monthly management fee settings, deducted from villa profit and visible to both CEO and investors.</p>
        </div>
        <div style={styles.controls}>
          {([
            { value: 'ytd', label: 'YTD' },
            { value: '30d', label: 'Monthly' },
            { value: '90d', label: '90 Days' },
          ] as const).map((range) => (
            <button key={range.value} type="button" onClick={() => setDateRange(range.value)} style={{ ...styles.rangeButton, ...(dateRange === range.value ? styles.rangeButtonActive : null) }}>
              {range.label}
            </button>
          ))}
        </div>
      </div>

      {setupMessage ? <div style={styles.setupBanner}>{setupMessage}</div> : null}

      <div style={styles.kpis}>
        <div style={styles.card}><div style={styles.label}>Mgmt Fee in Scope</div><div style={styles.value}>{money(totalManagementFee)}</div></div>
        <div style={styles.card}><div style={styles.label}>Projected Next Month</div><div style={styles.value}>{money(projectedMonthlyFee)}</div></div>
        <div style={styles.card}><div style={styles.label}>Net Profit After Fee</div><div style={styles.value}>{money(totalNetProfit)}</div></div>
      </div>

      <div style={styles.fullWidthCard}>
        <div style={styles.sectionHead}>
          <div>
            <h2 style={styles.sectionTitle}>Monthly Fee History</h2>
            <div style={styles.subtle}>Portfolio total plus per-villa management fee trend over recent months.</div>
          </div>
        </div>
        <div style={styles.chartLegend}>
          <div style={styles.legendItem}>
            <span style={{ ...styles.legendDot, background: '#ffffff' }} />
            <span>Total fee</span>
          </div>
          {configs.map((config, index) => (
            <div key={config.villaId} style={styles.legendItem}>
              <span style={{ ...styles.legendDot, background: SERIES_COLORS[index % SERIES_COLORS.length] }} />
              <span>{config.villaName}</span>
            </div>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={feeHistory}>
            <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
            <XAxis dataKey="label" stroke="#8fa3bd" tickLine={false} axisLine={false} />
            <YAxis stroke="#8fa3bd" tickLine={false} axisLine={false} tickFormatter={(value) => money(Number(value))} width={108} />
            <Tooltip formatter={(value) => money(Number(value))} />
            <Line type="monotone" dataKey="total" stroke="#ffffff" strokeWidth={3.4} dot={false} />
            {configs.map((config, index) => (
              <Line
                key={config.villaId}
                type="monotone"
                dataKey={config.villaId}
                stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                strokeWidth={2.2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={styles.layoutSingle}>
        <div style={styles.card}>
          <div style={styles.sectionHead}>
            <div>
              <h2 style={styles.sectionTitle}>Villa Fee Settings</h2>
              <div style={styles.subtle}>{isAdmin ? 'Edit per-villa monthly fee mode and amount.' : 'Read-only view of how each villa is charged.'}</div>
            </div>
          </div>
          <div style={styles.rows}>
            {loading ? <div style={styles.empty}>Loading management fee settings...</div> : villaRows.map((row) => {
              const draft = drafts[row.villaId]
              return (
                <div key={row.villaId} style={styles.villaCard}>
                  <div style={styles.villaTop}>
                    <div>
                      <strong style={styles.villaName}>{row.villaName}</strong>
                      <div style={styles.villaMeta}>Updated by {row.updatedByName}</div>
                    </div>
                    <span style={styles.villaBadge}>{row.feeType === 'percentage' ? `${row.percentageRate}% of revenue` : row.feeType === 'fixed' ? `${money(row.fixedAmount)} / month` : 'No fee'}</span>
                  </div>

                  <div style={styles.metricGrid}>
                    <Metric label="Revenue" value={money(row.revenue)} />
                    <Metric label="Gross Profit" value={money(row.grossProfit)} />
                    <Metric label="Mgmt Fee" value={money(row.managementFee)} />
                    <Metric label="Net After Fee" value={money(row.netProfit)} />
                  </div>

                  {isAdmin ? (
                    <div style={styles.editor}>
                      <select
                        value={draft?.feeType || 'none'}
                        onChange={(event) => setDrafts((current) => ({ ...current, [row.villaId]: { ...(current[row.villaId] || draft), feeType: event.target.value as ManagementFeeType } }))}
                        style={styles.select}
                      >
                        <option value="none">No fee</option>
                        <option value="percentage">% of revenue</option>
                        <option value="fixed">Fixed monthly amount</option>
                      </select>
                      <input
                        value={draft?.percentageRate || '0'}
                        onChange={(event) => setDrafts((current) => ({ ...current, [row.villaId]: { ...(current[row.villaId] || draft), percentageRate: event.target.value.replace(/[^\d.]/g, '') } }))}
                        style={styles.input}
                        placeholder="Percent"
                        disabled={(draft?.feeType || 'none') !== 'percentage'}
                      />
                      <input
                        value={draft?.fixedAmount || '0'}
                        onChange={(event) => setDrafts((current) => ({ ...current, [row.villaId]: { ...(current[row.villaId] || draft), fixedAmount: event.target.value.replace(/[^\d]/g, '') } }))}
                        style={styles.input}
                        placeholder="Fixed monthly IDR"
                        disabled={(draft?.feeType || 'none') !== 'fixed'}
                      />
                      <button type="button" onClick={() => void saveVillaConfig(row.villaId)} disabled={busyVillaId === row.villaId} style={styles.saveButton}>
                        {busyVillaId === row.villaId ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  ) : (
                    <div style={styles.readonlyNote}>Projected next month: {money(row.projectedMonthlyFee)}</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.metric}>
      <div style={styles.label}>{label}</div>
      <div style={styles.metricValue}>{value}</div>
    </div>
  )
}

const styles = {
  page: { flex: 1, minHeight: '100vh', padding: 24, color: '#f8fafc', background: 'linear-gradient(180deg, #081120 0%, #0f172a 56%, #132237 100%)', display: 'grid', gap: 18 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' as const },
  eyebrow: { marginBottom: 8, fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#fbbf24', fontWeight: 700 },
  title: { margin: 0, fontSize: 34, letterSpacing: '-0.04em' },
  copy: { margin: '6px 0 0 0', color: '#94a3b8', maxWidth: 780, lineHeight: 1.6 },
  controls: { display: 'flex', gap: 10, flexWrap: 'wrap' as const },
  rangeButton: { padding: '10px 14px', borderRadius: 999, border: '1px solid rgba(148,163,184,0.18)', background: 'rgba(15,23,42,0.88)', color: '#fff', cursor: 'pointer' },
  rangeButtonActive: { borderColor: 'rgba(198,169,107,0.4)', background: 'rgba(198,169,107,0.14)' },
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 },
  fullWidthCard: { padding: 22, borderRadius: 24, background: 'linear-gradient(180deg, rgba(15,23,42,0.92), rgba(30,41,59,0.78))', border: '1px solid rgba(148,163,184,0.12)', boxShadow: '0 20px 48px rgba(2,6,23,0.24)' },
  layoutSingle: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 18, alignItems: 'start' },
  card: { padding: 22, borderRadius: 24, background: 'linear-gradient(180deg, rgba(15,23,42,0.92), rgba(30,41,59,0.78))', border: '1px solid rgba(148,163,184,0.12)', boxShadow: '0 20px 48px rgba(2,6,23,0.24)' },
  label: { marginBottom: 8, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#94a3b8' },
  value: { fontSize: 28, fontWeight: 800, color: '#f8fafc' },
  sectionHead: { display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' as const, marginBottom: 14 },
  sectionTitle: { margin: 0, fontSize: 22 },
  subtle: { color: '#94a3b8', fontSize: 13, lineHeight: 1.5 },
  chartLegend: { display: 'flex', gap: 12, flexWrap: 'wrap' as const, marginBottom: 14 },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 999, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: '#e2e8f0', fontSize: 12 },
  legendDot: { width: 10, height: 10, borderRadius: 999, display: 'inline-block' },
  rows: { display: 'grid', gap: 12 },
  villaCard: { padding: 18, borderRadius: 20, background: 'rgba(15,23,42,0.68)', border: '1px solid rgba(148,163,184,0.1)', display: 'grid', gap: 14 },
  villaTop: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' as const, flexWrap: 'wrap' as const },
  villaName: { fontSize: 18 },
  villaMeta: { marginTop: 6, color: '#94a3b8', fontSize: 12 },
  villaBadge: { padding: '8px 12px', borderRadius: 999, background: 'rgba(198,169,107,0.14)', border: '1px solid rgba(198,169,107,0.26)', color: '#f7e3ba', fontSize: 12 },
  metricGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 },
  metric: { padding: 14, borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' },
  metricValue: { fontSize: 18, fontWeight: 700, lineHeight: 1.4, wordBreak: 'break-word' as const },
  editor: { display: 'grid', gridTemplateColumns: 'minmax(160px, 0.9fr) minmax(120px, 0.7fr) minmax(160px, 0.8fr) auto', gap: 10 },
  select: { padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(148,163,184,0.14)', background: '#0f1a2b', color: '#fff' },
  input: { padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(148,163,184,0.14)', background: '#0f1a2b', color: '#fff' },
  saveButton: { padding: '10px 14px', borderRadius: 12, border: '1px solid rgba(251,191,36,0.28)', background: 'linear-gradient(135deg, #f59e0b, #f97316)', color: '#fff', cursor: 'pointer' },
  readonlyNote: { color: '#cbd5e1', fontSize: 13 },
  empty: { padding: 18, borderRadius: 16, background: 'rgba(15,23,42,0.68)', color: '#94a3b8', border: '1px solid rgba(148,163,184,0.1)' },
  setupBanner: { marginBottom: 8, padding: 16, borderRadius: 18, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.24)', color: '#fde68a' },
}
