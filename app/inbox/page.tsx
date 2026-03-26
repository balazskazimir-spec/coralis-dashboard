'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { canAccessInbox, filterBookingsForUser, filterVillasForUser } from '@/lib/access'
import { useRole } from '@/components/auth/RoleProvider'
import { BOOKING_SELECT, MESSAGE_SELECT, MESSAGE_THREAD_SELECT, VILLA_SELECT } from '@/lib/dbSelects'
import {
  buildInboxThreads,
  formatMoney,
  formatTimeAgo,
} from '@/lib/inbox'
import { supabase } from '@/lib/supabase'
import type {
  BookingRecord,
  InboxPlatform,
  InboxThreadStatus,
  MessageRecord,
  MessageThreadRecord,
  VillaRecord,
} from '@/lib/types'

const QUICK_REPLIES = [
  { label: 'Check-in time', body: 'Check-in starts at 3 PM. We will share the arrival details before your stay.' },
  { label: 'Wifi password', body: 'The WiFi details are in the welcome guide. I can send them here if you need them now.' },
  { label: 'Directions', body: 'I am sending the directions now. Please follow the map link in your booking guide for the smoothest arrival.' },
]

const FILTER_STATUSES: Array<'all' | InboxThreadStatus> = ['all', 'Needs reply', 'Waiting', 'Resolved']
const FILTER_PLATFORMS: Array<'all' | InboxPlatform> = ['all', 'Airbnb', 'Booking.com', 'Direct']

function isMissingTable(message?: string | null) {
  const value = message?.toLowerCase() || ''
  return value.includes('message_threads') || value.includes('messages') || value.includes('does not exist')
}

export default function InboxPage() {
  const { currentUser } = useRole()
  const [villas, setVillas] = useState<VillaRecord[]>([])
  const [bookings, setBookings] = useState<BookingRecord[]>([])
  const [threadRows, setThreadRows] = useState<MessageThreadRecord[]>([])
  const [messageRows, setMessageRows] = useState<MessageRecord[]>([])
  const [selectedThreadId, setSelectedThreadId] = useState('')
  const [villaFilter, setVillaFilter] = useState('all')
  const [platformFilter, setPlatformFilter] = useState<'all' | InboxPlatform>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | InboxThreadStatus>('all')
  const [draft, setDraft] = useState('')
  const [currentTime, setCurrentTime] = useState(() => Date.now())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [setupMessage, setSetupMessage] = useState('')

  async function loadData(showLoading = true) {
    if (showLoading) {
      setLoading(true)
    }
    setError('')

    const [villasResult, bookingsResult, threadsResult, messagesResult] = await Promise.all([
      supabase.from('villas').select(VILLA_SELECT).order('name'),
      supabase.from('bookings').select(BOOKING_SELECT).order('check_in', { ascending: false }),
      supabase.from('message_threads').select(MESSAGE_THREAD_SELECT).order('last_message_at', { ascending: false }),
      supabase.from('messages').select(MESSAGE_SELECT).order('sent_at', { ascending: true }),
    ])

    setVillas((villasResult.data as VillaRecord[]) || [])
    setBookings((bookingsResult.data as BookingRecord[]) || [])
    setThreadRows((threadsResult.data as MessageThreadRecord[]) || [])
    setMessageRows((messagesResult.data as MessageRecord[]) || [])

    const missingSchema = isMissingTable(threadsResult.error?.message) || isMissingTable(messagesResult.error?.message)
    setSetupMessage(
      missingSchema
        ? 'The message_threads / messages tables are not available yet. Run supabase/message_inbox_schema.sql in the Supabase SQL editor, then seed demo threads.'
        : ''
    )

    if (!missingSchema) {
      setError(threadsResult.error?.message || messagesResult.error?.message || '')
    }

    setLoading(false)
  }

  async function refreshRealtimeData() {
    const [threadsResult, messagesResult] = await Promise.all([
      supabase.from('message_threads').select(MESSAGE_THREAD_SELECT).order('last_message_at', { ascending: false }),
      supabase.from('messages').select(MESSAGE_SELECT).order('sent_at', { ascending: true }),
    ])

    const missingSchema = isMissingTable(threadsResult.error?.message) || isMissingTable(messagesResult.error?.message)
    if (missingSchema) {
      setSetupMessage('The message_threads / messages tables are not available yet. Run supabase/message_inbox_schema.sql in the Supabase SQL editor, then seed demo threads.')
      return
    }

    setThreadRows((threadsResult.data as MessageThreadRecord[]) || [])
    setMessageRows((messagesResult.data as MessageRecord[]) || [])
    setError(threadsResult.error?.message || messagesResult.error?.message || '')
  }

  useEffect(() => {
    async function hydrateInbox() {
      await loadData()
    }

    void hydrateInbox()
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (setupMessage) {
      return
    }

    let refreshTimer: number | null = null
    const queueRefresh = () => {
      if (refreshTimer) {
        window.clearTimeout(refreshTimer)
      }
      refreshTimer = window.setTimeout(() => {
        void refreshRealtimeData()
      }, 150)
    }

    const channel = supabase
      .channel('inbox-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_threads' },
        queueRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        queueRefresh
      )
      .subscribe()

    return () => {
      if (refreshTimer) {
        window.clearTimeout(refreshTimer)
      }
      void supabase.removeChannel(channel)
    }
  }, [setupMessage])

  const visibleVillas = filterVillasForUser(villas, currentUser)
  const visibleVillaIds = new Set(visibleVillas.map((villa) => villa.id))
  const scopedBookings = filterBookingsForUser(bookings, currentUser).filter((booking) => booking.villa_id && visibleVillaIds.has(booking.villa_id))
  const scopedThreadRows = threadRows.filter((thread) => thread.villa_id && visibleVillaIds.has(thread.villa_id))
  const threads = buildInboxThreads(scopedThreadRows, messageRows, scopedBookings, visibleVillas)
  const filteredThreads = threads
    .filter((thread) => (villaFilter === 'all' ? true : thread.villaId === villaFilter))
    .filter((thread) => (platformFilter === 'all' ? true : thread.platform === platformFilter))
    .filter((thread) => (statusFilter === 'all' ? true : thread.status === statusFilter))
    .sort((left, right) => {
      if (left.unread !== right.unread) return left.unread ? -1 : 1
      return new Date(right.lastMessageAt).getTime() - new Date(left.lastMessageAt).getTime()
    })

  const activeThreadId = selectedThreadId && filteredThreads.some((thread) => thread.id === selectedThreadId) ? selectedThreadId : filteredThreads[0]?.id || ''
  const selectedThread = filteredThreads.find((thread) => thread.id === activeThreadId) || null
  const latestGuestMessage = selectedThread?.messages.filter((message) => message.sender === 'guest').slice(-1)[0] || null
  const slaHours = latestGuestMessage ? (currentTime - new Date(latestGuestMessage.sentAt).getTime()) / 3_600_000 : 0
  const slaBreached = Boolean(selectedThread && selectedThread.status === 'Needs reply' && slaHours > 2)

  async function updateStatus(status: InboxThreadStatus) {
    if (!selectedThread) return
    setSaving(true)
    setError('')

    const updateResult = await supabase
      .from('message_threads')
      .update({
        status,
        unread: status === 'Resolved' ? false : selectedThread.unread,
        updated_at: new Date().toISOString(),
      })
      .eq('id', selectedThread.id)
      .select('*')
      .single()

    if (updateResult.error) {
      setError(updateResult.error.message)
      setSaving(false)
      return
    }

    setThreadRows((current) => current.map((row) => (row.id === selectedThread.id ? (updateResult.data as MessageThreadRecord) : row)))
    setSaving(false)
  }

  async function sendReply(body: string) {
    if (!selectedThread || !body.trim()) return
    setSaving(true)
    setError('')
    const sentAt = new Date().toISOString()

    const messageResult = await supabase
      .from('messages')
      .insert({ thread_id: selectedThread.id, sender: 'host', body: body.trim(), sent_at: sentAt })
      .select('*')
      .single()

    if (messageResult.error) {
      setError(messageResult.error.message)
      setSaving(false)
      return
    }

    const threadResult = await supabase
      .from('message_threads')
      .update({ last_message_at: sentAt, status: 'Waiting', unread: false, updated_at: sentAt })
      .eq('id', selectedThread.id)
      .select('*')
      .single()

    if (threadResult.error) {
      setError(threadResult.error.message)
      setSaving(false)
      return
    }

    setMessageRows((current) => [...current, messageResult.data as MessageRecord])
    setThreadRows((current) => current.map((row) => (row.id === selectedThread.id ? (threadResult.data as MessageThreadRecord) : row)))
    setDraft('')
    setSaving(false)
  }

  async function seedInbox() {
    setSaving(true)
    setError('')
    const response = await fetch('/api/seed-inbox', { method: 'POST' })
    const payload = (await response.json()) as { error?: string }
    if (!response.ok) {
      setError(payload.error || 'Failed to seed inbox demo data.')
      setSaving(false)
      return
    }
    await loadData()
    setSaving(false)
  }

  if (!canAccessInbox(currentUser.role)) {
    return (
      <div style={styles.page}>
        <div style={styles.guard}>
          <h1 style={styles.guardTitle}>Inbox Access Restricted</h1>
          <p style={styles.guardCopy}>The shared inbox is an operations workspace for admin and staff roles.</p>
          <Link href="/villas" style={styles.guardLink}>Go to Villas</Link>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.eyebrow}>Operations</div>
          <h1 style={styles.title}>Shared Inbox</h1>
          <p style={styles.subtitle}>Persistent guest conversations from Supabase message threads.</p>
        </div>
        <div style={styles.filters}>
          <select value={villaFilter} onChange={(event) => setVillaFilter(event.target.value)} style={styles.select}>
            <option value="all">All Villas</option>
            {visibleVillas.map((villa) => <option key={villa.id} value={villa.id}>{villa.name}</option>)}
          </select>
          <select value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value as 'all' | InboxPlatform)} style={styles.select}>
            {FILTER_PLATFORMS.map((platform) => <option key={platform} value={platform}>{platform === 'all' ? 'All Platforms' : platform}</option>)}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | InboxThreadStatus)} style={styles.select}>
            {FILTER_STATUSES.map((status) => <option key={status} value={status}>{status === 'all' ? 'All Statuses' : status}</option>)}
          </select>
        </div>
      </header>

      {setupMessage ? (
        <section style={styles.setupCard}>
          <h2 style={styles.panelTitle}>Inbox Schema Setup</h2>
          <p style={styles.setupCopy}>{setupMessage}</p>
          <p style={styles.setupCopy}>SQL file: `supabase/message_inbox_schema.sql`</p>
          <div style={styles.filters}>
            <button type="button" onClick={() => void loadData()} style={styles.actionButton}>Retry</button>
          </div>
        </section>
      ) : null}

      {error ? <div style={styles.errorBar}>{error}</div> : null}

      <div style={styles.layout}>
        <aside style={styles.panel}>
          <div style={styles.panelHeader}>
            <h2 style={styles.panelTitle}>Threads</h2>
            <div style={styles.filters}>
              <span style={styles.panelMeta}>{filteredThreads.length} in scope</span>
              {!loading && threads.length === 0 && !setupMessage ? <button type="button" onClick={() => void seedInbox()} style={styles.seedButton}>Seed Demo</button> : null}
            </div>
          </div>
          <div style={styles.threadList}>
            {loading ? <div style={styles.emptyState}>Loading threads...</div> : filteredThreads.length === 0 ? <div style={styles.emptyState}>No inbox threads yet.</div> : filteredThreads.map((thread) => (
              <button key={thread.id} type="button" onClick={() => setSelectedThreadId(thread.id)} style={{ ...styles.threadCard, borderColor: activeThreadId === thread.id ? 'rgba(198,169,107,0.45)' : 'rgba(255,255,255,0.08)' }}>
                <div style={styles.threadTop}>
                  <span style={styles.villaChip}>{thread.villaName}</span>
                  {thread.unread ? <span style={styles.unreadDot} /> : null}
                </div>
                <strong style={styles.threadGuest}>{thread.guestName}</strong>
                <div style={styles.threadPreview}>{thread.messages[thread.messages.length - 1]?.body || 'No messages yet.'}</div>
                <div style={styles.threadMeta}>{thread.platform} | {formatTimeAgo(thread.lastMessageAt, currentTime)} | {thread.status}</div>
              </button>
            ))}
          </div>
        </aside>

        <section style={styles.panel}>
          {selectedThread ? (
            <>
              <div style={styles.panelHeader}>
                <div>
                  <h2 style={styles.panelTitle}>{selectedThread.guestName}</h2>
                  <div style={styles.panelMeta}>Booking {selectedThread.bookingLabel}</div>
                </div>
                <div style={styles.statusRow}>
                  {(['Needs reply', 'Waiting', 'Resolved'] as InboxThreadStatus[]).map((status) => (
                    <button key={status} type="button" onClick={() => void updateStatus(status)} disabled={saving} style={{ ...styles.statusButton, background: selectedThread.status === status ? 'rgba(198,169,107,0.18)' : 'rgba(255,255,255,0.03)', borderColor: selectedThread.status === status ? 'rgba(198,169,107,0.4)' : 'rgba(255,255,255,0.08)' }}>{status}</button>
                  ))}
                </div>
              </div>
              <div style={styles.chatBody}>
                {selectedThread.messages.map((message) => (
                  <div key={message.id} style={{ ...styles.messageBubble, alignSelf: message.sender === 'host' ? 'flex-end' : 'flex-start', background: message.sender === 'host' ? 'rgba(24,194,156,0.16)' : 'rgba(255,255,255,0.05)' }}>
                    <div style={styles.messageAuthor}>{message.sender === 'host' ? 'You' : 'Guest'}</div>
                    <div>{message.body}</div>
                    <div style={styles.messageTime}>{formatTimeAgo(message.sentAt, currentTime)}</div>
                  </div>
                ))}
              </div>
              <div style={styles.quickReplies}>
                {QUICK_REPLIES.map((reply) => <button key={reply.label} type="button" onClick={() => void sendReply(reply.body)} disabled={saving} style={styles.quickReply}>{reply.label}</button>)}
              </div>
              <div style={styles.replyBox}>
                <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write message..." style={styles.textarea} />
                <button type="button" onClick={() => void sendReply(draft)} disabled={saving} style={styles.sendButton}>{saving ? 'Saving...' : 'Send Reply'}</button>
              </div>
            </>
          ) : (
            <div style={styles.emptyState}>Select a thread to open the conversation.</div>
          )}
        </section>

        <aside style={styles.panel}>
          {selectedThread ? (
            <>
              <div style={styles.panelHeader}>
                <h2 style={styles.panelTitle}>Context</h2>
                <span style={styles.panelMeta}>{selectedThread.platform}</span>
              </div>
              <div style={styles.contextList}>
                <div style={styles.contextCard}><div style={styles.contextLabel}>Villa</div><strong>{selectedThread.villaName}</strong></div>
                <div style={styles.contextCard}><div style={styles.contextLabel}>Booking</div><strong>{selectedThread.bookingLabel}</strong></div>
                <div style={styles.contextCard}><div style={styles.contextLabel}>Revenue</div><strong>{formatMoney(selectedThread.revenue)}</strong></div>
                <div style={styles.contextCard}><div style={styles.contextLabel}>Guest history</div><strong>{selectedThread.guestHistory} previous stays</strong></div>
                <div style={styles.contextCard}><div style={styles.contextLabel}>Auto tag</div><strong>{selectedThread.tag}</strong></div>
                <div style={styles.contextCard}><div style={styles.contextLabel}>Notes</div><strong>{selectedThread.notes}</strong></div>
                <div style={styles.contextCard}><div style={styles.contextLabel}>Automation</div><strong>{selectedThread.unread ? 'Unread guest message' : 'No unread'}</strong><div style={styles.contextHint}>{slaBreached ? `SLA breached by ${Math.floor(slaHours - 2)}h` : 'SLA within target'}</div></div>
              </div>
            </>
          ) : (
            <div style={styles.emptyState}>Select a thread to see booking context.</div>
          )}
        </aside>
      </div>
    </div>
  )
}

const styles = {
  page: { height: '100vh', boxSizing: 'border-box' as const, padding: 20, color: '#f7fbff', background: 'linear-gradient(180deg, #08111f 0%, #0c1627 100%)', display: 'flex', flexDirection: 'column' as const, gap: 14, overflow: 'hidden' as const },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap' as const, padding: 18, borderRadius: 24, background: 'linear-gradient(135deg, rgba(10,16,28,0.94), rgba(17,26,43,0.9))', border: '1px solid rgba(198,169,107,0.2)', flexShrink: 0 },
  eyebrow: { fontSize: 12, color: '#c6a96b', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 6 },
  title: { margin: 0, fontSize: 30, letterSpacing: '-0.04em' },
  subtitle: { margin: '6px 0 0', color: '#9fb0c6', fontSize: 14 },
  setupCard: { padding: 18, borderRadius: 22, background: 'rgba(198,169,107,0.08)', border: '1px solid rgba(198,169,107,0.22)', flexShrink: 0 },
  setupCopy: { margin: '6px 0', color: '#d6dfeb' },
  errorBar: { padding: '12px 14px', borderRadius: 16, background: 'rgba(239,68,68,0.14)', border: '1px solid rgba(239,68,68,0.28)', color: '#fecdd3', flexShrink: 0 },
  filters: { display: 'flex', gap: 10, flexWrap: 'wrap' as const, alignItems: 'center' },
  select: { minWidth: 150, padding: '11px 14px', borderRadius: 14, background: '#101b2c', color: '#fff', border: '1px solid rgba(255,255,255,0.08)' },
  layout: { flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr) 320px', gap: 14, alignItems: 'stretch' as const },
  panel: { minHeight: 0, height: '100%', padding: 14, borderRadius: 22, background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(6,11,19,0.95))', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' as const },
  panelHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 12, flexWrap: 'wrap' as const },
  panelTitle: { margin: 0, fontSize: 20 },
  panelMeta: { color: '#8fa3bd', fontSize: 13 },
  seedButton: { padding: '8px 10px', borderRadius: 999, border: '1px solid rgba(198,169,107,0.28)', background: 'rgba(198,169,107,0.1)', color: '#fff', cursor: 'pointer' },
  actionButton: { padding: '9px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#fff', cursor: 'pointer' },
  threadList: { flex: 1, minHeight: 0, display: 'grid', alignContent: 'start' as const, gap: 8, overflowY: 'auto' as const, paddingRight: 4 },
  threadCard: { padding: 12, borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', color: '#fff', textAlign: 'left' as const, cursor: 'pointer' },
  threadTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8 },
  villaChip: { padding: '5px 9px', borderRadius: 999, background: 'rgba(198,169,107,0.14)', color: '#ecd6a6', fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.08em' },
  unreadDot: { width: 10, height: 10, borderRadius: 999, background: '#ef4444', flexShrink: 0 },
  threadGuest: { display: 'block', marginBottom: 6 },
  threadPreview: { color: '#c8d3e1', fontSize: 13, marginBottom: 6 },
  threadMeta: { color: '#8fa3bd', fontSize: 12 },
  statusRow: { display: 'flex', gap: 8, flexWrap: 'wrap' as const },
  statusButton: { padding: '7px 10px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.08)', color: '#fff', cursor: 'pointer' },
  chatBody: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' as const, gap: 10, overflowY: 'auto' as const, paddingRight: 6, marginBottom: 12 },
  messageBubble: { maxWidth: '78%', padding: 12, borderRadius: 16, border: '1px solid rgba(255,255,255,0.06)' },
  messageAuthor: { marginBottom: 6, color: '#c6a96b', fontSize: 12, textTransform: 'uppercase' as const, letterSpacing: '0.08em' },
  messageTime: { marginTop: 8, color: '#8fa3bd', fontSize: 12 },
  quickReplies: { display: 'flex', gap: 8, flexWrap: 'wrap' as const, marginBottom: 10, flexShrink: 0 },
  quickReply: { padding: '8px 10px', borderRadius: 999, border: '1px solid rgba(198,169,107,0.24)', background: 'rgba(198,169,107,0.08)', color: '#fff', cursor: 'pointer' },
  replyBox: { display: 'grid', gap: 8, flexShrink: 0 },
  textarea: { minHeight: 88, padding: 12, borderRadius: 16, background: '#0f1a2b', color: '#fff', border: '1px solid rgba(255,255,255,0.08)', resize: 'none' as const },
  sendButton: { padding: '11px 14px', borderRadius: 14, border: '1px solid rgba(24,194,156,0.28)', background: 'rgba(24,194,156,0.14)', color: '#fff', cursor: 'pointer' },
  contextList: { display: 'grid', gap: 8 },
  contextCard: { padding: 12, borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' },
  contextLabel: { color: '#8fa3bd', fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 4 },
  contextHint: { color: '#f6c27d', marginTop: 4, fontSize: 12 },
  emptyState: { display: 'grid', placeItems: 'center', flex: 1, color: '#8fa3bd', textAlign: 'center' as const },
  guard: { maxWidth: 560, padding: 24, borderRadius: 24, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' },
  guardTitle: { marginTop: 0, marginBottom: 8 },
  guardCopy: { color: '#c8d3e1', lineHeight: 1.6 },
  guardLink: { color: '#fff' },
}
