import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { RevenueExpensePoint } from '@/lib/types'
import type { CSSProperties } from 'react'

type ChartMode = 'revenue' | 'expenses' | 'profit'

type ChartMainProps = {
  data: RevenueExpensePoint[]
  mode: ChartMode
  tooltipFormatter?: (value: number) => string
  axisFormatter?: (value: number) => string
  onPointClick?: (monthKey: string) => void
}

const SERIES_LABELS: Record<string, string> = {
  revenue: 'Revenue',
  expenses: 'Total Expenses',
  profit: 'Profit',
  cleaning: 'Cleaning',
  maintenance: 'Maintenance',
  utilities: 'Utilities',
  staff: 'Staff',
  smoothedExpenses: 'Smoothed Spend',
}

const SERIES_COLORS: Record<string, string> = {
  revenue: '#a78bfa',
  expenses: '#f8fafc',
  profit: '#22c55e',
  cleaning: '#34d399',
  maintenance: '#ef4444',
  utilities: '#38bdf8',
  staff: '#f59e0b',
}

const EXPENSE_TOOLTIP_ORDER = ['profit', 'revenue', 'expenses', 'staff', 'maintenance', 'utilities', 'cleaning']

function getMonthKeyFromEvent(payload: unknown) {
  if (typeof payload !== 'object' || payload === null || !('activePayload' in payload)) {
    return null
  }

  const activePayload = (payload as { activePayload?: Array<{ payload?: { monthKey?: string } }> }).activePayload
  const monthKey = activePayload?.[0]?.payload?.monthKey
  return typeof monthKey === 'string' ? monthKey : null
}

function renderSeries(mode: ChartMode) {
  if (mode === 'expenses') {
    return (
      <>
        <Area type="monotone" dataKey="staff" stackId="expense" stroke="#f59e0b" fill="url(#staffFill)" strokeWidth={2} />
        <Area type="monotone" dataKey="maintenance" stackId="expense" stroke="#ef4444" fill="url(#maintenanceFill)" strokeWidth={2} />
        <Area type="monotone" dataKey="utilities" stackId="expense" stroke="#38bdf8" fill="url(#utilitiesFill)" strokeWidth={2} />
        <Area type="monotone" dataKey="cleaning" stackId="expense" stroke="#34d399" fill="url(#cleaningFill)" strokeWidth={2} />
        <Line type="monotone" dataKey="profit" stroke="#22c55e" strokeWidth={3} dot={false} activeDot={{ r: 5, strokeWidth: 0 }} />
        <Line type="monotone" dataKey="revenue" stroke="#a78bfa" strokeWidth={2.5} strokeDasharray="6 6" dot={false} />
        <Line type="monotone" dataKey="expenses" stroke="#f8fafc" strokeWidth={3} dot={false} activeDot={{ r: 5, strokeWidth: 0 }} />
      </>
    )
  }

  if (mode === 'profit') {
    return (
      <>
        <Area type="monotone" dataKey="profit" stroke="#10b981" fill="url(#profitFill)" strokeWidth={3} />
        <Line type="monotone" dataKey="revenue" stroke="#60a5fa" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="expenses" stroke="#fb7185" strokeWidth={2} dot={false} />
      </>
    )
  }

  return (
    <>
      <Area type="monotone" dataKey="revenue" stroke="#8b5cf6" fill="url(#revenueFill)" strokeWidth={3} />
      <Line type="monotone" dataKey="expenses" stroke="#f97316" strokeWidth={2.5} dot={false} />
      <Line type="monotone" dataKey="profit" stroke="#22c55e" strokeWidth={2.5} dot={false} />
    </>
  )
}

function ExpenseTooltip({
  active,
  payload,
  label,
  mode,
  tooltipFormatter,
}: {
  active?: boolean
  payload?: Array<{ dataKey?: string | number; value?: number | string | null }>
  label?: string
  mode: ChartMode
  tooltipFormatter?: (value: number) => string
}) {
  if (!active || !payload || payload.length === 0) {
    return null
  }

  const cleaned = payload
    .map((entry) => ({
      key: typeof entry.dataKey === 'string' ? entry.dataKey : String(entry.dataKey ?? ''),
      value: Number(entry.value ?? 0),
    }))
    .filter((entry) => entry.key && Number.isFinite(entry.value))

  const sorted =
    mode === 'expenses'
      ? cleaned.sort(
          (a, b) => EXPENSE_TOOLTIP_ORDER.indexOf(a.key) - EXPENSE_TOOLTIP_ORDER.indexOf(b.key)
        )
      : cleaned

  return (
    <div style={styles.tooltip}>
      <div style={styles.tooltipLabel}>{label}</div>
      <div style={styles.tooltipRows}>
        {sorted.map((entry) => {
          const isProfit = entry.key === 'profit'
          return (
            <div
              key={entry.key}
              style={{
                ...styles.tooltipRow,
                ...(isProfit ? styles.tooltipProfitRow : null),
              }}
            >
              <div style={styles.tooltipSeries}>
                <span
                  style={{
                    ...styles.tooltipDot,
                    backgroundColor: SERIES_COLORS[entry.key] || '#94a3b8',
                  }}
                />
                <span style={isProfit ? styles.tooltipProfitLabel : styles.tooltipSeriesLabel}>
                  {SERIES_LABELS[entry.key] || entry.key}
                </span>
              </div>
              <span style={isProfit ? styles.tooltipProfitValue : styles.tooltipValue}>
                {tooltipFormatter ? tooltipFormatter(entry.value) : String(entry.value)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function ChartMain({ data, mode, tooltipFormatter, axisFormatter, onPointClick }: ChartMainProps) {
  return (
    <div style={styles.wrap}>
      <ResponsiveContainer width="100%" height={340}>
        <ComposedChart
          data={data}
          margin={{ top: 12, right: 20, left: 8, bottom: 0 }}
          onClick={(payload) => {
            const monthKey = getMonthKeyFromEvent(payload)
            if (monthKey && onPointClick) {
              onPointClick(monthKey)
            }
          }}
        >
          <defs>
            <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.42} />
              <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.04} />
            </linearGradient>
            <linearGradient id="profitFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0.03} />
            </linearGradient>
            <linearGradient id="staffFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.45} />
              <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.08} />
            </linearGradient>
            <linearGradient id="maintenanceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.45} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0.08} />
            </linearGradient>
            <linearGradient id="utilitiesFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.45} />
              <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.08} />
            </linearGradient>
            <linearGradient id="cleaningFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#34d399" stopOpacity={0.45} />
              <stop offset="95%" stopColor="#34d399" stopOpacity={0.08} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
          <XAxis dataKey="month" stroke="#94a3b8" tickLine={false} axisLine={false} />
          <YAxis
            stroke="#94a3b8"
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => (axisFormatter ? axisFormatter(Number(value)) : String(value))}
            width={76}
          />
          <Tooltip
            content={<ExpenseTooltip mode={mode} tooltipFormatter={tooltipFormatter} />}
          />
          <Legend
            verticalAlign="top"
            align="right"
            wrapperStyle={styles.legend}
            formatter={(value) => SERIES_LABELS[value] || value}
          />

          {renderSeries(mode)}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

const styles = {
  wrap: {
    padding: 22,
    borderRadius: 28,
    background:
      'radial-gradient(circle at top left, rgba(59,130,246,0.16), transparent 32%), linear-gradient(180deg, rgba(15,23,42,0.92), rgba(15,23,42,0.72))',
    border: '1px solid rgba(148,163,184,0.14)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 20px 50px rgba(2,6,23,0.28)',
  },
  tooltip: {
    background: 'rgba(15,23,42,0.96)',
    border: '1px solid rgba(148,163,184,0.18)',
    borderRadius: 14,
    boxShadow: '0 18px 40px rgba(2,6,23,0.45)',
    padding: '12px 14px',
  },
  tooltipLabel: {
    color: '#e2e8f0',
    fontWeight: 600,
    marginBottom: 10,
  },
  tooltipRows: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
    minWidth: 200,
  },
  tooltipRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  } satisfies CSSProperties,
  tooltipProfitRow: {
    paddingBottom: 8,
    marginBottom: 4,
    borderBottom: '1px solid rgba(148,163,184,0.14)',
  } satisfies CSSProperties,
  tooltipSeries: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  } satisfies CSSProperties,
  tooltipDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    display: 'inline-block',
    flexShrink: 0,
  } satisfies CSSProperties,
  tooltipSeriesLabel: {
    color: '#cbd5e1',
    fontSize: 12,
  },
  tooltipProfitLabel: {
    color: '#dcfce7',
    fontSize: 12,
    fontWeight: 700,
  },
  tooltipValue: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: 600,
  },
  tooltipProfitValue: {
    color: '#86efac',
    fontSize: 13,
    fontWeight: 800,
  },
  legend: {
    paddingBottom: 10,
    fontSize: 12,
  },
}
