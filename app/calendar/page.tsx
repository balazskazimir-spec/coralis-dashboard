'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { filterBookingsForUser, filterVillasForUser } from '@/lib/access'
import { useRole } from '@/components/auth/RoleProvider'
import { BOOKING_SELECT, VILLA_SELECT } from '@/lib/dbSelects'
import { buildCalendarPreview, buildUpcomingBookings, getStaffWindow } from '@/lib/staff'
import { supabase } from '@/lib/supabase'
import type { BookingRecord, StaffDateFilter, VillaRecord } from '@/lib/types'

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function CalendarPage() {
  const { currentUser } = useRole()
  const [villas, setVillas] = useState<VillaRecord[]>([])
  const [bookings, setBookings] = useState<BookingRecord[]>([])
  const [dateFilter, setDateFilter] = useState<StaffDateFilter>('week')
  const [villaFilter, setVillaFilter] = useState('all')

  useEffect(() => {
    async function load() {
      const [villasResult, bookingsResult] = await Promise.all([
        supabase.from('villas').select(VILLA_SELECT).order('name'),
        supabase.from('bookings').select(BOOKING_SELECT).order('check_in', { ascending: true }),
      ])

      setVillas((villasResult.data as VillaRecord[]) || [])
      setBookings((bookingsResult.data as BookingRecord[]) || [])
    }

    void load()
  }, [])

  const visibleVillas = filterVillasForUser(villas, currentUser)
  const visibleVillaIds = new Set(visibleVillas.map((villa) => villa.id))
  const visibleBookings = filterBookingsForUser(bookings, currentUser).filter((booking) => booking.villa_id && visibleVillaIds.has(booking.villa_id))
  const { start, end } = getStaffWindow(dateFilter, new Date())
  const scopedVillas = visibleVillas.filter((villa) => (villaFilter === 'all' ? true : villa.id === villaFilter))
  const scopedBookings = visibleBookings.filter((booking) => (villaFilter === 'all' ? true : booking.villa_id === villaFilter))

  const previewDays = dateFilter === 'week' ? 7 : 4
  const previewRows = buildCalendarPreview(scopedVillas, scopedBookings, start, previewDays)
  const upcomingBookings = buildUpcomingBookings(scopedBookings, start, previewDays)
  const focusKey = startOfDay(start).toISOString().slice(0, 10)
  const checkIns = upcomingBookings.filter((booking) => booking.check_in === focusKey).length
  const checkOuts = scopedBookings.filter((booking) => booking.check_out === focusKey).length
  const turnovers = scopedVillas.filter((villa) => scopedBookings.some((booking) => booking.villa_id === villa.id && booking.check_in === focusKey) && scopedBookings.some((booking) => booking.villa_id === villa.id && booking.check_out === focusKey)).length

  return (
    <div style={styles.page}>
      <header style={styles.hero}>
        <div>
          <div style={styles.eyebrow}>Staff Ops</div>
          <h1 style={styles.title}>Calendar</h1>
          <p style={styles.copy}>Operational booking flow with turnover risk and near-term occupancy preview.</p>
        </div>
        <div style={styles.filters}>
          <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as StaffDateFilter)} style={styles.select}>
            <option value="today">Today</option>
            <option value="tomorrow">Tomorrow</option>
            <option value="week">This Week</option>
          </select>
          <select value={villaFilter} onChange={(event) => setVillaFilter(event.target.value)} style={styles.select}>
            <option value="all">All Assigned Villas</option>
            {visibleVillas.map((villa) => (
              <option key={villa.id} value={villa.id}>
                {villa.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      <section style={styles.summaryGrid}>
        <StatCard title="Check-ins" value={checkIns.toString()} note={formatDate(focusKey)} />
        <StatCard title="Check-outs" value={checkOuts.toString()} note={formatDate(focusKey)} />
        <StatCard title="Turnovers" value={turnovers.toString()} note="Same-day turns" />
        <StatCard title="Upcoming Bookings" value={upcomingBookings.length.toString()} note={`${previewDays} day window`} />
      </section>

      <section style={styles.mainGrid}>
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <div>
              <h2 style={styles.panelTitle}>Upcoming Bookings</h2>
              <p style={styles.panelCopy}>Use this as the forward-looking list for arrivals, departures, and special prep notes.</p>
            </div>
            <Link href="/tasks" style={styles.link}>
              Open Tasks
            </Link>
          </div>

          <div style={styles.list}>
            {upcomingBookings.length === 0 ? (
              <div style={styles.emptyState}>No bookings in the selected window.</div>
            ) : (
              upcomingBookings.map((booking) => (
                <div key={booking.id} style={styles.listRow}>
                  <div>
                    <strong>{booking.guest_name}</strong>
                    <div style={styles.meta}>
                      {formatDate(booking.check_in)} - {formatDate(booking.check_out)}
                    </div>
                  </div>
                  <div style={styles.metaRight}>
                    <div>{scopedVillas.find((villa) => villa.id === booking.villa_id)?.name || 'Villa'}</div>
                    <div>{booking.source || 'Direct'}</div>
                    <div>{booking.notes || 'No special notes'}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <div>
              <h2 style={styles.panelTitle}>Occupancy Preview</h2>
              <p style={styles.panelCopy}>Booked, empty, and turnover states are grouped by villa for quick scanning.</p>
            </div>
            <Link href="/villas" style={styles.link}>
              Open Villas
            </Link>
          </div>

          <div style={styles.previewBoard}>
            {previewRows.map((row) => (
              <div key={row.villaId} style={styles.previewRow}>
                <div style={styles.previewVilla}>{row.villaName}</div>
                <div style={styles.previewDays}>
                  {row.days.map((day) => (
                    <div
                      key={day.date}
                      style={{
                        ...styles.previewCell,
                        background:
                          day.state === 'booked'
                            ? 'rgba(24,194,156,0.26)'
                            : day.state === 'turnover'
                              ? 'rgba(198,169,107,0.26)'
                              : day.state === 'issue'
                                ? 'rgba(239,68,68,0.24)'
                                : 'rgba(255,255,255,0.05)',
                      }}
                    >
                      <span>{day.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={styles.panel}>
        <div style={styles.panelHeader}>
          <div>
            <h2 style={styles.panelTitle}>Coverage Window</h2>
            <p style={styles.panelCopy}>
              {formatDate(start.toISOString())} - {formatDate(end.toISOString())} across {scopedVillas.length} villas.
            </p>
          </div>
          <Link href="/inbox" style={styles.link}>
            Open Inbox
          </Link>
        </div>
        <div style={styles.legend}>
          <LegendChip tone="rgba(24,194,156,0.26)" label="Booked" />
          <LegendChip tone="rgba(198,169,107,0.26)" label="Turnover" />
          <LegendChip tone="rgba(255,255,255,0.05)" label="Empty" />
        </div>
      </section>
    </div>
  )
}

function StatCard({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statTitle}>{title}</div>
      <div style={styles.statValue}>{value}</div>
      <div style={styles.statNote}>{note}</div>
    </div>
  )
}

function LegendChip({ tone, label }: { tone: string; label: string }) {
  return (
    <div style={styles.legendChip}>
      <span style={{ ...styles.legendDot, background: tone }} />
      {label}
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    padding: 28,
    color: '#f7fbff',
    background: 'linear-gradient(180deg, #07101d 0%, #0d1729 100%)',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 18,
  },
  hero: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 18,
    flexWrap: 'wrap' as const,
    padding: 24,
    borderRadius: 28,
    background: 'linear-gradient(135deg, rgba(9,15,26,0.95), rgba(18,28,45,0.92))',
    border: '1px solid rgba(255,255,255,0.08)',
  },
  eyebrow: {
    color: '#82e4cc',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.12em',
    fontSize: 12,
    marginBottom: 8,
  },
  title: { margin: 0, fontSize: 34, letterSpacing: '-0.04em' },
  copy: { margin: '8px 0 0', color: '#9fb0c6', lineHeight: 1.5 },
  filters: { display: 'flex', gap: 10, flexWrap: 'wrap' as const },
  select: {
    minWidth: 150,
    padding: '10px 12px',
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.08)',
    background: '#0f1a2b',
    color: '#fff',
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 14,
  },
  statCard: {
    padding: 18,
    borderRadius: 20,
    background: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(10,15,25,0.9))',
    border: '1px solid rgba(255,255,255,0.08)',
  },
  statTitle: {
    color: '#8fa3bd',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    fontSize: 12,
  },
  statValue: { marginTop: 12, fontSize: 28, fontWeight: 700 },
  statNote: { marginTop: 8, color: '#c4d0df', fontSize: 13 },
  mainGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(360px, 1.1fr)',
    gap: 18,
    alignItems: 'start' as const,
  },
  panel: {
    padding: 20,
    borderRadius: 24,
    background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(8,13,22,0.95))',
    border: '1px solid rgba(255,255,255,0.08)',
  },
  panelHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 14,
    alignItems: 'flex-start',
    flexWrap: 'wrap' as const,
    marginBottom: 14,
  },
  panelTitle: { margin: 0, fontSize: 22, letterSpacing: '-0.03em' },
  panelCopy: { margin: '6px 0 0', color: '#8fa3bd', fontSize: 14 },
  link: { color: '#f4e6c8', textDecoration: 'none' },
  list: { display: 'grid', gap: 10 },
  listRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 14,
    padding: 14,
    borderRadius: 18,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    flexWrap: 'wrap' as const,
  },
  meta: { color: '#8fa3bd', fontSize: 13, marginTop: 4 },
  metaRight: { color: '#c8d4e5', fontSize: 13, textAlign: 'right' as const },
  previewBoard: { display: 'grid', gap: 10 },
  previewRow: { display: 'grid', gridTemplateColumns: '140px minmax(0, 1fr)', gap: 10, alignItems: 'center' },
  previewVilla: { color: '#dce7f2', fontSize: 13 },
  previewDays: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 8 },
  previewCell: {
    minHeight: 48,
    borderRadius: 12,
    display: 'grid',
    placeItems: 'center',
    fontSize: 12,
    border: '1px solid rgba(255,255,255,0.06)',
  },
  legend: { display: 'flex', gap: 12, flexWrap: 'wrap' as const },
  legendChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    borderRadius: 999,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
  },
  legendDot: { width: 12, height: 12, borderRadius: 999 },
  emptyState: {
    padding: 16,
    borderRadius: 16,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    color: '#8fa3bd',
    textAlign: 'center' as const,
  },
}
