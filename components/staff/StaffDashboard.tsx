'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { canAccessInbox, filterBookingsForUser, filterExpensesForUser, filterVillasForUser } from '@/lib/access'
import { useRole } from '@/components/auth/RoleProvider'
import { BOOKING_SELECT, EXPENSE_SELECT, MESSAGE_SELECT, MESSAGE_THREAD_SELECT, STAFF_ISSUE_SELECT, STAFF_TASK_SELECT, VILLA_SELECT } from '@/lib/dbSelects'
import { buildInboxThreads, formatTimeAgo } from '@/lib/inbox'
import {
  attachVillaNamesToTasks,
  buildCalendarPreview,
  buildStaffIssues,
  buildStaffTasks,
  buildUpcomingBookings,
  buildVillaStatusCards,
  countOccupiedVillas,
  getStaffWindow,
  isNeedsActionIssue,
  isNeedsActionTask,
  isUrgentIssue,
  isUrgentTask,
  matchesStaffWindow,
  mergeStaffIssues,
  mergeStaffTasks,
} from '@/lib/staff'
import { supabase } from '@/lib/supabase'
import type {
  BookingRecord,
  ExpenseRecord,
  InboxThreadStatus,
  MessageRecord,
  MessageThreadRecord,
  StaffDateFilter,
  StaffIssue,
  StaffIssueRecord,
  StaffIssueStatus,
  StaffStatusFilter,
  StaffTask,
  StaffTaskRecord,
  StaffTaskStatus,
  VillaRecord,
} from '@/lib/types'

const QUICK_REPLIES = [
  { label: 'Check-in instructions', body: 'Check-in starts at 3 PM. I am sending the arrival instructions and access details now.' },
  { label: 'Wi-Fi info', body: 'I am sending the Wi-Fi name and password now together with the welcome guide.' },
  { label: 'Directions', body: 'I am sharing the map pin and directions now so arrival is smooth.' },
  { label: 'Late check-out', body: 'I am checking availability and housekeeping timing, then I will confirm the late check-out options.' },
  { label: 'Thanks / follow-up', body: 'Thanks for the note. We are on it and will update you shortly.' },
]

function formatOpsDate(value: string) {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function sameDate(left: string, right: Date) {
  return left === right.toISOString().slice(0, 10)
}

function isMissingTable(message?: string | null, tableName?: string) {
  const value = message?.toLowerCase() || ''
  return value.includes('does not exist') || (tableName ? value.includes(tableName) : false)
}

export default function StaffDashboard() {
  const { currentUser } = useRole()
  const [villas, setVillas] = useState<VillaRecord[]>([])
  const [bookings, setBookings] = useState<BookingRecord[]>([])
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([])
  const [threadRows, setThreadRows] = useState<MessageThreadRecord[]>([])
  const [messageRows, setMessageRows] = useState<MessageRecord[]>([])
  const [taskRows, setTaskRows] = useState<StaffTaskRecord[]>([])
  const [issueRows, setIssueRows] = useState<StaffIssueRecord[]>([])
  const [dateFilter, setDateFilter] = useState<StaffDateFilter>('week')
  const [villaFilter, setVillaFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<StaffStatusFilter>('all')
  const [selectedThreadId, setSelectedThreadId] = useState('')
  const [draft, setDraft] = useState('')
  const [currentTime, setCurrentTime] = useState(() => Date.now())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [setupMessage, setSetupMessage] = useState('')
  const [taskDrafts, setTaskDrafts] = useState<Record<string, string>>({})
  const [issueDrafts, setIssueDrafts] = useState<Record<string, string>>({})

  async function loadData(syncOps = false) {
    setLoading(true)
    setError('')
    if (syncOps) {
      await fetch('/api/sync-staff-ops', { method: 'POST' }).catch(() => null)
    }

    const [villasResult, bookingsResult, expensesResult, threadsResult, messagesResult, tasksResult, issuesResult] = await Promise.all([
      supabase.from('villas').select(VILLA_SELECT).order('name'),
      supabase.from('bookings').select(BOOKING_SELECT).order('check_in', { ascending: false }),
      supabase.from('expenses').select(EXPENSE_SELECT).order('date', { ascending: false }),
      supabase.from('message_threads').select(MESSAGE_THREAD_SELECT).order('last_message_at', { ascending: false }),
      supabase.from('messages').select(MESSAGE_SELECT).order('sent_at', { ascending: true }),
      supabase.from('staff_tasks').select(STAFF_TASK_SELECT).order('due_at', { ascending: true }),
      supabase.from('staff_issues').select(STAFF_ISSUE_SELECT).order('opened_at', { ascending: false }),
    ])

    setVillas((villasResult.data as VillaRecord[]) || [])
    setBookings((bookingsResult.data as BookingRecord[]) || [])
    setExpenses((expensesResult.data as ExpenseRecord[]) || [])
    setThreadRows((threadsResult.data as MessageThreadRecord[]) || [])
    setMessageRows((messagesResult.data as MessageRecord[]) || [])
    setTaskRows((tasksResult.data as StaffTaskRecord[]) || [])
    setIssueRows((issuesResult.data as StaffIssueRecord[]) || [])

    const messages: string[] = []
    if (isMissingTable(threadsResult.error?.message, 'message_threads') || isMissingTable(messagesResult.error?.message, 'messages')) {
      messages.push('Inbox tables are not available yet, so guest messaging is hidden until the Supabase inbox schema is ready.')
    }
    if (isMissingTable(tasksResult.error?.message, 'staff_tasks') || isMissingTable(issuesResult.error?.message, 'staff_issues')) {
      messages.push('Staff ops tables are not available yet, so task and issue persistence is hidden until the staff ops schema is ready.')
    }
    setSetupMessage(messages.join(' '))

    if (!messages.length) {
      setError(
        villasResult.error?.message ||
          bookingsResult.error?.message ||
          expensesResult.error?.message ||
          threadsResult.error?.message ||
          messagesResult.error?.message ||
          tasksResult.error?.message ||
          issuesResult.error?.message ||
          ''
      )
    }

    setLoading(false)
  }

  async function refreshRealtimeData() {
    const [threadsResult, messagesResult, tasksResult, issuesResult] = await Promise.all([
      supabase.from('message_threads').select(MESSAGE_THREAD_SELECT).order('last_message_at', { ascending: false }),
      supabase.from('messages').select(MESSAGE_SELECT).order('sent_at', { ascending: true }),
      supabase.from('staff_tasks').select(STAFF_TASK_SELECT).order('due_at', { ascending: true }),
      supabase.from('staff_issues').select(STAFF_ISSUE_SELECT).order('opened_at', { ascending: false }),
    ])

    setThreadRows((threadsResult.data as MessageThreadRecord[]) || [])
    setMessageRows((messagesResult.data as MessageRecord[]) || [])
    setTaskRows((tasksResult.data as StaffTaskRecord[]) || [])
    setIssueRows((issuesResult.data as StaffIssueRecord[]) || [])
    setError(
      threadsResult.error?.message ||
        messagesResult.error?.message ||
        tasksResult.error?.message ||
        issuesResult.error?.message ||
        ''
    )
  }

  useEffect(() => {
    async function hydrate() {
      await loadData(true)
    }

    void hydrate()
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (setupMessage) return

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
      .channel('staff-dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_threads' }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_tasks' }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_issues' }, queueRefresh)
      .subscribe()

    return () => {
      if (refreshTimer) {
        window.clearTimeout(refreshTimer)
      }
      void supabase.removeChannel(channel)
    }
  }, [setupMessage])

  const visibleVillas = filterVillasForUser(villas, currentUser)
  const scopedVillaIds = new Set(visibleVillas.map((villa) => villa.id))
  const scopedBookings = filterBookingsForUser(bookings, currentUser).filter((booking) => booking.villa_id && scopedVillaIds.has(booking.villa_id))
  const scopedExpenses = filterExpensesForUser(expenses, currentUser).filter((expense) => expense.villa_id && scopedVillaIds.has(expense.villa_id))
  const scopedThreadRows = threadRows.filter((thread) => thread.villa_id && scopedVillaIds.has(thread.villa_id))
  const scopedTaskRows = taskRows.filter((task) => task.villa_id && scopedVillaIds.has(task.villa_id))
  const scopedIssueRows = issueRows.filter((issue) => issue.villa_id && scopedVillaIds.has(issue.villa_id))
  const threads = buildInboxThreads(scopedThreadRows, messageRows, scopedBookings, visibleVillas)
  const now = new Date(currentTime)
  const focusDate = getStaffWindow(dateFilter, now).start
  const derivedTasks = attachVillaNamesToTasks(buildStaffTasks(scopedBookings, threads, scopedExpenses, currentUser.name, dateFilter, now), visibleVillas)
  const mergedTasks = mergeStaffTasks(derivedTasks, scopedTaskRows, visibleVillas)
  const tasks = mergedTasks
    .map((task) => ({ ...task, note: taskDrafts[task.id] ?? task.note }))
    .filter((task) => matchesStaffWindow(task.dueAt, dateFilter, now))
    .filter((task) => (villaFilter === 'all' ? true : task.villaId === villaFilter))
    .filter((task) => (statusFilter === 'urgent' ? isUrgentTask(task) : statusFilter === 'needs_action' ? isNeedsActionTask(task) : true))

  const derivedIssues = buildStaffIssues(threads, mergedTasks, scopedExpenses, visibleVillas, now)
  const mergedIssues = mergeStaffIssues(derivedIssues, scopedIssueRows, visibleVillas)
  const issues = mergedIssues
    .map((issue) => ({ ...issue, note: issueDrafts[issue.id] ?? issue.note ?? '' }))
    .filter((issue) => (villaFilter === 'all' ? true : issue.villaId === villaFilter))
    .filter((issue) => (statusFilter === 'urgent' ? isUrgentIssue(issue) : statusFilter === 'needs_action' ? isNeedsActionIssue(issue) : true))

  const inboxThreads = threads
    .filter((thread) => (villaFilter === 'all' ? true : thread.villaId === villaFilter))
    .filter((thread) => (statusFilter === 'urgent' ? thread.unread || thread.status === 'Needs reply' : statusFilter === 'needs_action' ? thread.status !== 'Resolved' : true))
    .sort((left, right) => {
      if (left.unread !== right.unread) return left.unread ? -1 : 1
      return new Date(right.lastMessageAt).getTime() - new Date(left.lastMessageAt).getTime()
    })

  const activeThreadId = selectedThreadId && inboxThreads.some((thread) => thread.id === selectedThreadId) ? selectedThreadId : inboxThreads[0]?.id || ''
  const selectedThread = inboxThreads.find((thread) => thread.id === activeThreadId) || null
  const latestGuestMessage = selectedThread?.messages.filter((message) => message.sender === 'guest').slice(-1)[0] || null
  const slaHours = latestGuestMessage ? (currentTime - new Date(latestGuestMessage.sentAt).getTime()) / 3_600_000 : 0

  const villaCards = buildVillaStatusCards(
    visibleVillas.filter((villa) => (villaFilter === 'all' ? true : villa.id === villaFilter)),
    scopedBookings,
    threads,
    tasks,
    issues,
    focusDate
  )

  const upcomingBookings = buildUpcomingBookings(
    scopedBookings.filter((booking) => (villaFilter === 'all' ? true : booking.villa_id === villaFilter)),
    focusDate,
    dateFilter === 'week' ? 7 : 3
  )

  const calendarRows = buildCalendarPreview(
    visibleVillas.filter((villa) => (villaFilter === 'all' ? true : villa.id === villaFilter)),
    scopedBookings,
    focusDate,
    dateFilter === 'week' ? 7 : 4
  )

  const todayCheckIns = scopedBookings.filter((booking) => sameDate(booking.check_in, focusDate)).length
  const todayCheckOuts = scopedBookings.filter((booking) => sameDate(booking.check_out, focusDate)).length
  const occupiedVillas = countOccupiedVillas(scopedBookings, visibleVillas, focusDate)
  const openTasksCount = tasks.filter((task) => task.status !== 'Done').length
  const unreadMessagesCount = inboxThreads.filter((thread) => thread.unread).length

  async function sendReply(body: string) {
    if (!selectedThread || !body.trim() || !canAccessInbox(currentUser.role)) return
    setSaving(true)
    const sentAt = new Date().toISOString()

    const messageResult = await supabase.from('messages').insert({ thread_id: selectedThread.id, sender: 'host', body: body.trim(), sent_at: sentAt }).select('*').single()
    const threadResult = await supabase.from('message_threads').update({ last_message_at: sentAt, status: 'Waiting', unread: false, updated_at: sentAt }).eq('id', selectedThread.id).select('*').single()

    if (messageResult.error || threadResult.error) {
      setError(messageResult.error?.message || threadResult.error?.message || 'Failed to send reply.')
      setSaving(false)
      return
    }

    setMessageRows((current) => [...current, messageResult.data as MessageRecord])
    setThreadRows((current) => current.map((row) => (row.id === selectedThread.id ? (threadResult.data as MessageThreadRecord) : row)))
    setDraft('')
    setSaving(false)
  }

  async function updateTask(task: StaffTask, patch: Partial<Pick<StaffTaskRecord, 'status' | 'note' | 'assignee'>>) {
    if (!task.recordId) return
    const result = await supabase.from('staff_tasks').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', task.recordId).select('*').single()
    if (result.error || !result.data) {
      setError(result.error?.message || 'Failed to update task.')
      return
    }
    const row = result.data as StaffTaskRecord
    setTaskRows((current) => current.map((item) => (item.id === row.id ? row : item)))
  }

  async function updateIssue(issue: StaffIssue, patch: Partial<Pick<StaffIssueRecord, 'status' | 'note' | 'assignee'>>) {
    if (!issue.recordId) return
    const result = await supabase.from('staff_issues').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', issue.recordId).select('*').single()
    if (result.error || !result.data) {
      setError(result.error?.message || 'Failed to update issue.')
      return
    }
    const row = result.data as StaffIssueRecord
    setIssueRows((current) => current.map((item) => (item.id === row.id ? row : item)))
  }

  return (
    <div style={styles.page}>
      <header style={styles.hero}>
        <div>
          <div style={styles.eyebrow}>Staff Dashboard</div>
          <h1 style={styles.title}>Today&apos;s Operations</h1>
          <p style={styles.subtitle}>Daily execution view for arrivals, tasks, inbox, and villa readiness.</p>
        </div>
        <div style={styles.filters}>
          <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as StaffDateFilter)} style={styles.select}><option value="today">Today</option><option value="tomorrow">Tomorrow</option><option value="week">This Week</option></select>
          <select value={villaFilter} onChange={(event) => setVillaFilter(event.target.value)} style={styles.select}><option value="all">All Assigned Villas</option>{visibleVillas.map((villa) => <option key={villa.id} value={villa.id}>{villa.name}</option>)}</select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StaffStatusFilter)} style={styles.select}><option value="all">All Statuses</option><option value="urgent">Urgent</option><option value="needs_action">Needs action</option></select>
        </div>
      </header>

      {error ? <div style={styles.errorBar}>{error}</div> : null}
      {setupMessage ? <div style={styles.warningBar}>{setupMessage}</div> : null}

      <section style={styles.kpiGrid}>
        <SummaryCard title="Today Check-ins" value={todayCheckIns.toString()} note="Arriving guests" accent="#c6a96b" />
        <SummaryCard title="Today Check-outs" value={todayCheckOuts.toString()} note="Departing stays" accent="#60a5fa" />
        <SummaryCard title="Occupied Villas" value={occupiedVillas.toString()} note="Current occupancy" accent="#18c29c" />
        <SummaryCard title="Open Tasks" value={openTasksCount.toString()} note="Operational queue" accent="#f97316" />
        <SummaryCard title="Unread Messages" value={unreadMessagesCount.toString()} note="Guest replies pending" accent="#ef4444" />
      </section>

      <section style={styles.topGrid}>
        <div style={styles.panel}>
          <div style={styles.panelHeader}><div><h2 style={styles.panelTitle}>Today Timeline / Tasks</h2><p style={styles.panelCopy}>The main work surface for the day. Mark progress as operations move.</p></div><Link href="/tasks" style={styles.panelLink}>Open Tasks</Link></div>
          <div style={styles.taskList}>{loading ? <div style={styles.emptyState}>Loading tasks...</div> : tasks.length === 0 ? <div style={styles.emptyState}>No tasks in this filter window.</div> : tasks.map((task) => <div key={task.id} style={styles.taskRow}><div style={styles.taskTime}>{task.time}</div><div style={styles.taskBody}><div style={styles.taskTopLine}><span style={styles.taskType}>{task.type}</span><span style={styles.taskVilla}>{task.villaName}</span><span style={{ ...styles.priorityBadge, ...(task.priority === 'Critical' ? styles.critical : task.priority === 'Warning' ? styles.warning : styles.normal) }}>{task.priority}</span></div><div style={styles.taskDescription}>{task.description}</div><div style={styles.taskMeta}>Assigned to {task.assignee}</div><div style={styles.taskControls}><select value={task.status} onChange={(event) => void updateTask(task, { status: event.target.value as StaffTaskStatus })} style={styles.inlineSelect}>{(['To do', 'In progress', 'Done', 'Blocked'] as StaffTaskStatus[]).map((status) => <option key={status} value={status}>{status}</option>)}</select><input value={taskDrafts[task.id] ?? task.note} onChange={(event) => setTaskDrafts((current) => ({ ...current, [task.id]: event.target.value }))} onBlur={() => void updateTask(task, { note: taskDrafts[task.id] ?? task.note })} placeholder="Quick note" style={styles.noteInput} /><button type="button" onClick={() => void updateTask(task, { status: 'Done', note: taskDrafts[task.id] ?? task.note })} style={styles.doneButton}>Mark done</button></div></div></div>)}</div>
        </div>

        <div style={styles.panel}>
          <div style={styles.panelHeader}><div><h2 style={styles.panelTitle}>Unified Inbox</h2><p style={styles.panelCopy}>Guest messages stay in the daily workflow, not in a separate app.</p></div><Link href="/inbox" style={styles.panelLink}>Open Inbox</Link></div>
          {!selectedThread ? <div style={styles.emptyState}>No threads in the current operational filter.</div> : <><div style={styles.inboxList}>{inboxThreads.slice(0, 5).map((thread) => <button key={thread.id} type="button" onClick={() => setSelectedThreadId(thread.id)} style={{ ...styles.inboxThread, borderColor: activeThreadId === thread.id ? 'rgba(198,169,107,0.4)' : 'rgba(255,255,255,0.08)' }}><div style={styles.inboxThreadTop}><strong>{thread.villaName}</strong>{thread.unread ? <span style={styles.unreadDot} /> : null}</div><div style={styles.inboxGuest}>{thread.guestName}</div><div style={styles.inboxPreview}>{thread.messages[thread.messages.length - 1]?.body || 'No message yet.'}</div><div style={styles.inboxMeta}>{thread.platform} | {formatTimeAgo(thread.lastMessageAt, currentTime)} | {thread.status}</div></button>)}</div><div style={styles.selectedThreadCard}><div style={styles.selectedThreadHeader}><div><div style={styles.panelMeta}>Guest</div><strong>{selectedThread.guestName}</strong></div><div style={styles.selectedStatus}>{selectedThread.status}</div></div><div style={styles.selectedMessage}>{selectedThread.messages[selectedThread.messages.length - 1]?.body}</div><div style={styles.panelMeta}>{selectedThread.bookingLabel} | SLA {slaHours > 2 ? 'late' : 'on target'}</div><div style={styles.quickReplyRow}>{QUICK_REPLIES.slice(0, 3).map((reply) => <button key={reply.label} type="button" onClick={() => void sendReply(reply.body)} style={styles.quickReply}>{reply.label}</button>)}</div><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Reply or add internal note..." style={styles.replyInput} /><div style={styles.replyActions}><select value={selectedThread.status} onChange={async (event) => { const status = event.target.value as InboxThreadStatus; const result = await supabase.from('message_threads').update({ status, unread: status === 'Resolved' ? false : selectedThread.unread, updated_at: new Date().toISOString() }).eq('id', selectedThread.id).select('*').single(); if (!result.error && result.data) { setThreadRows((current) => current.map((row) => (row.id === selectedThread.id ? (result.data as MessageThreadRecord) : row))) } }} style={styles.inlineSelect}>{(['Needs reply', 'Waiting', 'Resolved'] as InboxThreadStatus[]).map((status) => <option key={status} value={status}>{status}</option>)}</select><button type="button" onClick={() => void sendReply(draft)} disabled={saving} style={styles.sendButton}>{saving ? 'Saving...' : 'Reply'}</button></div></div></>}
        </div>
      </section>

      <section style={styles.bottomGrid}>
        <div style={styles.panel}>
          <div style={styles.panelHeader}><div><h2 style={styles.panelTitle}>Villa Status Board</h2><p style={styles.panelCopy}>Live operational posture for each assigned villa.</p></div><Link href="/villas" style={styles.panelLink}>Open Villas</Link></div>
          <div style={styles.villaBoard}>{villaCards.map((villa) => <div key={villa.id} style={styles.villaCard}><div style={styles.villaCardTop}><strong>{villa.name}</strong><span style={styles.villaStatus}>{villa.status}</span></div><div style={styles.villaCopy}>{villa.currentGuest}</div><div style={styles.villaMeta}>{villa.nextGuest}</div><div style={styles.villaStats}><span>{villa.todayEvents} events today</span><span>{villa.unreadMessages} unread</span></div><div style={styles.villaIssueRow}><span>{villa.cleaningState}</span><span>{villa.issueCount} issues</span></div><div style={styles.villaActions}><Link href={`/villas/${villa.id}`} style={styles.smallLink}>Open villa</Link><Link href="/tasks" style={styles.smallLink}>New task</Link></div></div>)}</div>
        </div>

        <div style={styles.panel}>
          <div style={styles.panelHeader}><div><h2 style={styles.panelTitle}>Open Issues</h2><p style={styles.panelCopy}>Problems, not just routine tasks.</p></div><Link href="/issues" style={styles.panelLink}>Open Issues</Link></div>
          <div style={styles.issueList}>{issues.length === 0 ? <div style={styles.emptyState}>No open issues right now.</div> : issues.slice(0, 8).map((issue) => <div key={issue.id} style={styles.issueRow}><div style={styles.issueTop}><span style={{ ...styles.priorityBadge, ...(issue.severity === 'Critical' ? styles.critical : issue.severity === 'Warning' ? styles.warning : styles.normal) }}>{issue.severity}</span><strong>{issue.villaName}</strong></div><div style={styles.issueTitle}>{issue.title}</div><div style={styles.issueSummary}>{issue.summary}</div><div style={styles.issueMeta}>{issue.assignee} | {formatOpsDate(issue.openedAt)}</div><div style={styles.taskControls}><select value={issue.status} onChange={(event) => void updateIssue(issue, { status: event.target.value as StaffIssueStatus })} style={styles.inlineSelect}>{(['Open', 'Investigating', 'Waiting', 'Resolved'] as StaffIssueStatus[]).map((status) => <option key={status} value={status}>{status}</option>)}</select><input value={issueDrafts[issue.id] ?? issue.note ?? ''} onChange={(event) => setIssueDrafts((current) => ({ ...current, [issue.id]: event.target.value }))} onBlur={() => void updateIssue(issue, { note: issueDrafts[issue.id] ?? issue.note ?? '' })} placeholder="Update" style={styles.noteInput} /><button type="button" onClick={() => void updateIssue(issue, { status: 'Resolved', note: issueDrafts[issue.id] ?? issue.note ?? '' })} style={styles.doneButton}>Close</button></div></div>)}</div>
        </div>
      </section>

      <section style={styles.panel}>
        <div style={styles.panelHeader}><div><h2 style={styles.panelTitle}>Upcoming Bookings / Calendar Preview</h2><p style={styles.panelCopy}>The next few days of arrivals, departures, and occupancy gaps.</p></div><Link href="/calendar" style={styles.panelLink}>Open Calendar</Link></div>
        <div style={styles.upcomingGrid}><div style={styles.upcomingList}>{upcomingBookings.length === 0 ? <div style={styles.emptyState}>No upcoming bookings in this range.</div> : upcomingBookings.map((booking) => <div key={booking.id} style={styles.bookingRow}><div><strong>{booking.guest_name}</strong><div style={styles.panelMeta}>{formatOpsDate(booking.check_in)} - {formatOpsDate(booking.check_out)}</div></div><div style={styles.bookingMeta}><div>{visibleVillas.find((villa) => villa.id === booking.villa_id)?.name || 'Villa'}</div><div>{booking.source || 'Direct'} | {booking.notes || 'No special note'}</div></div></div>)}</div><div style={styles.previewBoard}>{calendarRows.map((row) => <div key={row.villaId} style={styles.previewRow}><div style={styles.previewVilla}>{row.villaName}</div><div style={styles.previewDays}>{row.days.map((day) => <div key={day.date} style={{ ...styles.previewCell, background: day.state === 'booked' ? 'rgba(24,194,156,0.28)' : day.state === 'turnover' ? 'rgba(198,169,107,0.28)' : day.state === 'issue' ? 'rgba(239,68,68,0.28)' : 'rgba(255,255,255,0.06)' }}><span>{day.label}</span></div>)}</div></div>)}</div></div>
      </section>
    </div>
  )
}

function SummaryCard({ title, value, note, accent }: { title: string; value: string; note: string; accent: string }) {
  return <div style={{ ...styles.summaryCard, borderColor: accent }}><div style={styles.summaryLabel}>{title}</div><div style={styles.summaryValue}>{value}</div><div style={styles.summaryNote}>{note}</div></div>
}

const styles = {
  page: { minHeight: '100vh', padding: 28, color: '#f7fbff', background: 'radial-gradient(circle at top left, rgba(24,194,156,0.12), transparent 24%), linear-gradient(180deg, #07101d 0%, #0d1729 100%)', display: 'flex', flexDirection: 'column' as const, gap: 18 },
  hero: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 18, flexWrap: 'wrap' as const, padding: 24, borderRadius: 28, background: 'linear-gradient(135deg, rgba(9,15,26,0.95), rgba(18,28,45,0.92))', border: '1px solid rgba(255,255,255,0.08)' },
  eyebrow: { color: '#82e4cc', textTransform: 'uppercase' as const, letterSpacing: '0.12em', fontSize: 12, marginBottom: 8 },
  title: { margin: 0, fontSize: 34, letterSpacing: '-0.04em' },
  subtitle: { margin: '8px 0 0', color: '#9fb0c6', lineHeight: 1.5 },
  filters: { display: 'flex', gap: 10, flexWrap: 'wrap' as const, alignItems: 'center' },
  select: { minWidth: 150, padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: '#0f1a2b', color: '#fff' },
  errorBar: { padding: '12px 14px', borderRadius: 16, background: 'rgba(239,68,68,0.14)', border: '1px solid rgba(239,68,68,0.28)', color: '#fecdd3' },
  warningBar: { padding: '12px 14px', borderRadius: 16, background: 'rgba(198,169,107,0.14)', border: '1px solid rgba(198,169,107,0.28)', color: '#f6e4bf' },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 },
  summaryCard: { padding: 18, borderRadius: 20, background: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(10,15,25,0.9))', border: '1px solid rgba(255,255,255,0.08)' },
  summaryLabel: { color: '#8fa3bd', textTransform: 'uppercase' as const, letterSpacing: '0.08em', fontSize: 12 },
  summaryValue: { marginTop: 12, fontSize: 28, fontWeight: 700 },
  summaryNote: { marginTop: 8, color: '#c4d0df', fontSize: 13 },
  topGrid: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.35fr) minmax(360px, 0.95fr)', gap: 18, alignItems: 'start' as const },
  bottomGrid: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(340px, 0.9fr)', gap: 18, alignItems: 'start' as const },
  panel: { padding: 20, borderRadius: 24, background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(8,13,22,0.95))', border: '1px solid rgba(255,255,255,0.08)' },
  panelHeader: { display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' as const, marginBottom: 14 },
  panelTitle: { margin: 0, fontSize: 22, letterSpacing: '-0.03em' },
  panelCopy: { margin: '6px 0 0', color: '#8fa3bd', fontSize: 14 },
  panelLink: { color: '#f4e6c8', textDecoration: 'none' },
  panelMeta: { color: '#8fa3bd', fontSize: 12 },
  taskList: { display: 'grid', gap: 12 },
  taskRow: { display: 'grid', gridTemplateColumns: '72px minmax(0, 1fr)', gap: 12, padding: 14, borderRadius: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' },
  taskTime: { color: '#c6a96b', fontWeight: 700, fontSize: 14, paddingTop: 4 },
  taskBody: { display: 'grid', gap: 8 },
  taskTopLine: { display: 'flex', gap: 10, flexWrap: 'wrap' as const, alignItems: 'center' },
  taskType: { fontSize: 12, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: '#8ef0cf' },
  taskVilla: { color: '#fff', fontWeight: 600 },
  priorityBadge: { padding: '5px 9px', borderRadius: 999, fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.08em' },
  critical: { background: 'rgba(239,68,68,0.14)', color: '#fecdd3', border: '1px solid rgba(239,68,68,0.24)' },
  warning: { background: 'rgba(198,169,107,0.14)', color: '#f6e4bf', border: '1px solid rgba(198,169,107,0.24)' },
  normal: { background: 'rgba(24,194,156,0.12)', color: '#8ef0cf', border: '1px solid rgba(24,194,156,0.24)' },
  taskDescription: { color: '#d7e0ea' },
  taskMeta: { color: '#8fa3bd', fontSize: 12 },
  taskControls: { display: 'flex', gap: 8, flexWrap: 'wrap' as const },
  inlineSelect: { padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: '#0f1a2b', color: '#fff' },
  noteInput: { flex: '1 1 160px', minWidth: 140, padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: '#0f1a2b', color: '#fff' },
  doneButton: { padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(24,194,156,0.24)', background: 'rgba(24,194,156,0.14)', color: '#fff', cursor: 'pointer' },
  inboxList: { display: 'grid', gap: 10, marginBottom: 14 },
  inboxThread: { padding: 12, borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', textAlign: 'left' as const, cursor: 'pointer' },
  inboxThreadTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 },
  inboxGuest: { fontSize: 14, color: '#dbe5f1', marginBottom: 4 },
  inboxPreview: { color: '#aebed0', fontSize: 13, marginBottom: 6 },
  inboxMeta: { color: '#8fa3bd', fontSize: 12 },
  unreadDot: { width: 10, height: 10, borderRadius: 999, background: '#ef4444', flexShrink: 0 },
  selectedThreadCard: { padding: 14, borderRadius: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 10 },
  selectedThreadHeader: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  selectedStatus: { padding: '6px 10px', borderRadius: 999, background: 'rgba(198,169,107,0.14)', color: '#f6e4bf', fontSize: 12 },
  selectedMessage: { color: '#e3ecf5', lineHeight: 1.5 },
  quickReplyRow: { display: 'flex', gap: 8, flexWrap: 'wrap' as const },
  quickReply: { padding: '8px 10px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', color: '#fff', cursor: 'pointer' },
  replyInput: { minHeight: 88, padding: 12, borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', background: '#0f1a2b', color: '#fff', resize: 'vertical' as const },
  replyActions: { display: 'flex', gap: 8, flexWrap: 'wrap' as const },
  sendButton: { padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(24,194,156,0.24)', background: 'rgba(24,194,156,0.14)', color: '#fff', cursor: 'pointer' },
  villaBoard: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 },
  villaCard: { padding: 14, borderRadius: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', display: 'grid', gap: 8 },
  villaCardTop: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' },
  villaStatus: { color: '#f6e4bf', fontSize: 12 },
  villaCopy: { color: '#e8eef5', fontWeight: 600 },
  villaMeta: { color: '#8fa3bd', fontSize: 13 },
  villaStats: { display: 'flex', justifyContent: 'space-between', gap: 10, color: '#c5d1df', fontSize: 13 },
  villaIssueRow: { display: 'flex', justifyContent: 'space-between', gap: 10, color: '#f6c27d', fontSize: 12 },
  villaActions: { display: 'flex', gap: 12, flexWrap: 'wrap' as const },
  smallLink: { color: '#9ddbf9', textDecoration: 'none', fontSize: 13 },
  issueList: { display: 'grid', gap: 10 },
  issueRow: { padding: 14, borderRadius: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', display: 'grid', gap: 8 },
  issueTop: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' as const },
  issueTitle: { fontWeight: 700 },
  issueSummary: { color: '#dbe5f1', fontSize: 14 },
  issueMeta: { color: '#8fa3bd', fontSize: 12 },
  upcomingGrid: { display: 'grid', gridTemplateColumns: 'minmax(0, 0.9fr) minmax(0, 1.1fr)', gap: 18, alignItems: 'start' as const },
  upcomingList: { display: 'grid', gap: 10 },
  bookingRow: { padding: 14, borderRadius: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' as const },
  bookingMeta: { color: '#8fa3bd', fontSize: 13, textAlign: 'right' as const },
  previewBoard: { display: 'grid', gap: 10 },
  previewRow: { display: 'grid', gridTemplateColumns: '140px minmax(0, 1fr)', gap: 10, alignItems: 'center' },
  previewVilla: { color: '#dce7f2', fontSize: 13 },
  previewDays: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 8 },
  previewCell: { minHeight: 44, borderRadius: 12, display: 'grid', placeItems: 'center', fontSize: 12, border: '1px solid rgba(255,255,255,0.06)' },
  emptyState: { padding: 16, borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#8fa3bd', textAlign: 'center' as const },
}
