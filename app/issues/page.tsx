'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { filterBookingsForUser, filterExpensesForUser, filterVillasForUser } from '@/lib/access'
import { useRole } from '@/components/auth/RoleProvider'
import { BOOKING_SELECT, EXPENSE_SELECT, MESSAGE_SELECT, MESSAGE_THREAD_SELECT, STAFF_ISSUE_SELECT, STAFF_TASK_SELECT, VILLA_SELECT } from '@/lib/dbSelects'
import { buildInboxThreads } from '@/lib/inbox'
import { attachVillaNamesToTasks, buildManualIssueInput, buildStaffIssues, buildStaffTasks, isUrgentTask, mergeStaffIssues, mergeStaffTasks } from '@/lib/staff'
import { supabase } from '@/lib/supabase'
import type {
  BookingRecord,
  ExpenseRecord,
  MessageRecord,
  MessageThreadRecord,
  StaffIssue,
  StaffIssueRecord,
  StaffIssueStatus,
  StaffSeverity,
  StaffTask,
  StaffTaskRecord,
  VillaRecord,
} from '@/lib/types'

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function isMissingTable(message?: string | null) {
  const value = message?.toLowerCase() || ''
  return value.includes('staff_issues') || value.includes('does not exist')
}

export default function IssuesPage() {
  const { currentUser } = useRole()
  const [villas, setVillas] = useState<VillaRecord[]>([])
  const [bookings, setBookings] = useState<BookingRecord[]>([])
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([])
  const [threadRows, setThreadRows] = useState<MessageThreadRecord[]>([])
  const [messageRows, setMessageRows] = useState<MessageRecord[]>([])
  const [taskRows, setTaskRows] = useState<StaffTaskRecord[]>([])
  const [issueRows, setIssueRows] = useState<StaffIssueRecord[]>([])
  const [villaFilter, setVillaFilter] = useState('all')
  const [severityFilter, setSeverityFilter] = useState<'all' | StaffSeverity>('all')
  const [issueDrafts, setIssueDrafts] = useState<Record<string, string>>({})
  const [manualIssue, setManualIssue] = useState({
    villaId: '',
    severity: 'Warning' as StaffSeverity,
    title: '',
    summary: '',
    assignee: currentUser.name,
    status: 'Open' as StaffIssueStatus,
    source: 'maintenance' as StaffIssue['source'],
    note: '',
  })
  const [setupMessage, setSetupMessage] = useState('')
  const [error, setError] = useState('')

  async function load(syncOps = false) {
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

    const missingSchema = isMissingTable(issuesResult.error?.message)
    setSetupMessage(missingSchema ? 'Staff issue tables are not available yet. Run the staff ops Supabase schema first.' : '')
    if (!missingSchema) {
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
  }

  async function refreshRealtimeData() {
    const [tasksResult, issuesResult] = await Promise.all([
      supabase.from('staff_tasks').select(STAFF_TASK_SELECT).order('due_at', { ascending: true }),
      supabase.from('staff_issues').select(STAFF_ISSUE_SELECT).order('opened_at', { ascending: false }),
    ])

    setTaskRows((tasksResult.data as StaffTaskRecord[]) || [])
    setIssueRows((issuesResult.data as StaffIssueRecord[]) || [])
    setError(tasksResult.error?.message || issuesResult.error?.message || '')
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load(true)
    }, 0)

    return () => window.clearTimeout(timer)
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
      .channel('staff-issues-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_issues' }, queueRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_tasks' }, queueRefresh)
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
  const visibleBookings = filterBookingsForUser(bookings, currentUser).filter((booking) => booking.villa_id && visibleVillaIds.has(booking.villa_id))
  const visibleExpenses = filterExpensesForUser(expenses, currentUser).filter((expense) => expense.villa_id && visibleVillaIds.has(expense.villa_id))
  const threads = buildInboxThreads(
    threadRows.filter((thread) => thread.villa_id && visibleVillaIds.has(thread.villa_id)),
    messageRows,
    visibleBookings,
    visibleVillas
  )
  const derivedTasks = attachVillaNamesToTasks(buildStaffTasks(visibleBookings, threads, visibleExpenses, currentUser.name, 'week', new Date()), visibleVillas)
  const mergedTasks = mergeStaffTasks(
    derivedTasks,
    taskRows.filter((task) => task.villa_id && visibleVillaIds.has(task.villa_id)),
    visibleVillas
  )
  const derivedIssues = buildStaffIssues(threads, mergedTasks, visibleExpenses, visibleVillas, new Date())
  const issues = mergeStaffIssues(
    derivedIssues,
    issueRows.filter((issue) => issue.villa_id && visibleVillaIds.has(issue.villa_id)),
    visibleVillas
  )
    .map((issue) => ({ ...issue, note: issueDrafts[issue.id] ?? issue.note ?? '' }))
    .filter((issue) => (villaFilter === 'all' ? true : issue.villaId === villaFilter))
    .filter((issue) => (severityFilter === 'all' ? true : issue.severity === severityFilter))

  const criticalCount = issues.filter((issue) => issue.severity === 'Critical' && issue.status !== 'Resolved').length
  const openCount = issues.filter((issue) => issue.status !== 'Resolved').length
  const blockedTasks = mergedTasks.filter((task) => isUrgentTask(task) && task.status !== 'Done').length

  async function updateIssue(issue: StaffIssue, patch: Partial<Pick<StaffIssueRecord, 'status' | 'note' | 'assignee'>>) {
    if (!issue.recordId) return
    const result = await supabase
      .from('staff_issues')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', issue.recordId)
      .select('*')
      .single()

    if (result.error || !result.data) {
      setError(result.error?.message || 'Failed to update issue.')
      return
    }

    const row = result.data as StaffIssueRecord
    setIssueRows((current) => current.map((item) => (item.id === row.id ? row : item)))
  }

  async function createManualIssue() {
    if (!manualIssue.villaId || !manualIssue.title.trim() || !manualIssue.summary.trim()) {
      setError('Villa, title, and summary are required for a manual issue.')
      return
    }

    const payload = buildManualIssueInput({
      externalKey: `manual-issue-${crypto.randomUUID()}`,
      villaId: manualIssue.villaId,
      severity: manualIssue.severity,
      title: manualIssue.title.trim(),
      summary: manualIssue.summary.trim(),
      openedAt: new Date().toISOString(),
      assignee: manualIssue.assignee.trim() || currentUser.name,
      status: manualIssue.status,
      source: manualIssue.source,
      note: manualIssue.note.trim(),
    })

    const result = await supabase.from('staff_issues').insert(payload).select('*').single()
    if (result.error || !result.data) {
      setError(result.error?.message || 'Failed to create manual issue.')
      return
    }

    setIssueRows((current) => [result.data as StaffIssueRecord, ...current])
    setManualIssue({
      villaId: manualIssue.villaId,
      severity: 'Warning',
      title: '',
      summary: '',
      assignee: currentUser.name,
      status: 'Open',
      source: 'maintenance',
      note: '',
    })
  }

  return (
    <div style={styles.page}>
      <header style={styles.hero}>
        <div>
          <div style={styles.eyebrow}>Staff Ops</div>
          <h1 style={styles.title}>Issues</h1>
          <p style={styles.copy}>Persistent issue board for complaints, maintenance follow-ups, access problems, and delayed turnovers.</p>
        </div>
        <div style={styles.filters}>
          <select value={villaFilter} onChange={(event) => setVillaFilter(event.target.value)} style={styles.select}>
            <option value="all">All Assigned Villas</option>
            {visibleVillas.map((villa) => (
              <option key={villa.id} value={villa.id}>
                {villa.name}
              </option>
            ))}
          </select>
          <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as 'all' | StaffSeverity)} style={styles.select}>
            <option value="all">All Severities</option>
            <option value="Critical">Critical</option>
            <option value="Warning">Warning</option>
            <option value="Normal">Normal</option>
          </select>
        </div>
      </header>

      {error ? <div style={styles.errorBar}>{error}</div> : null}
      {setupMessage ? <div style={styles.warningBar}>{setupMessage}</div> : null}

      <section style={styles.createCard}>
        <div style={styles.panelHeader}>
          <div>
            <h2 style={styles.panelTitle}>Manual Issue</h2>
            <p style={styles.panelCopy}>Log a new operational problem even when it did not come from booking, expense, or guest-message automation.</p>
          </div>
        </div>
        <div style={styles.formGrid}>
          <select value={manualIssue.villaId} onChange={(event) => setManualIssue((current) => ({ ...current, villaId: event.target.value }))} style={styles.select}>
            <option value="">Select villa</option>
            {visibleVillas.map((villa) => (
              <option key={villa.id} value={villa.id}>
                {villa.name}
              </option>
            ))}
          </select>
          <select value={manualIssue.severity} onChange={(event) => setManualIssue((current) => ({ ...current, severity: event.target.value as StaffSeverity }))} style={styles.select}>
            {(['Normal', 'Warning', 'Critical'] as StaffSeverity[]).map((severity) => (
              <option key={severity} value={severity}>
                {severity}
              </option>
            ))}
          </select>
          <select value={manualIssue.source} onChange={(event) => setManualIssue((current) => ({ ...current, source: event.target.value as StaffIssue['source'] }))} style={styles.select}>
            {(['maintenance', 'guest complaint', 'delayed cleaning', 'missing supply', 'access problem', 'urgent follow-up'] as StaffIssue['source'][]).map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
          <input value={manualIssue.title} onChange={(event) => setManualIssue((current) => ({ ...current, title: event.target.value }))} placeholder="Issue title" style={styles.textInput} />
          <input value={manualIssue.summary} onChange={(event) => setManualIssue((current) => ({ ...current, summary: event.target.value }))} placeholder="Short summary" style={styles.textInput} />
          <input value={manualIssue.assignee} onChange={(event) => setManualIssue((current) => ({ ...current, assignee: event.target.value }))} placeholder="Assignee" style={styles.textInput} />
        </div>
        <div style={styles.formFooter}>
          <input value={manualIssue.note} onChange={(event) => setManualIssue((current) => ({ ...current, note: event.target.value }))} placeholder="Optional note" style={styles.textInput} />
          <button type="button" onClick={() => void createManualIssue()} style={styles.createButton}>Create Issue</button>
        </div>
      </section>

      <section style={styles.kpiGrid}>
        <IssueKpi title="Critical Issues" value={criticalCount.toString()} accent="#ef4444" />
        <IssueKpi title="Open Issues" value={openCount.toString()} accent="#f59e0b" />
        <IssueKpi title="Urgent Tasks" value={blockedTasks.toString()} accent="#18c29c" />
      </section>

      <section style={styles.mainGrid}>
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <div>
              <h2 style={styles.panelTitle}>Open Issue Board</h2>
              <p style={styles.panelCopy}>This panel stays in sync with the shared dashboard and tracks investigation state persistently.</p>
            </div>
            <Link href="/tasks" style={styles.link}>
              Open Tasks
            </Link>
          </div>

          <div style={styles.issueList}>
            {issues.length === 0 ? (
              <div style={styles.emptyState}>No issues in the current filter set.</div>
            ) : (
              issues.map((issue) => (
                <div key={issue.id} style={styles.issueCard}>
                  <div style={styles.issueTop}>
                    <span
                      style={{
                        ...styles.severity,
                        ...(issue.severity === 'Critical' ? styles.critical : issue.severity === 'Warning' ? styles.warning : styles.normal),
                      }}
                    >
                      {issue.severity}
                    </span>
                    <strong>{issue.villaName}</strong>
                    <span style={styles.source}>{issue.source}</span>
                  </div>
                  <div style={styles.issueTitle}>{issue.title}</div>
                  <div style={styles.issueSummary}>{issue.summary}</div>
                  <div style={styles.issueMeta}>
                    {issue.assignee} | Opened {formatDate(issue.openedAt)}
                  </div>
                  <textarea
                    value={issueDrafts[issue.id] ?? issue.note ?? ''}
                    onChange={(event) => setIssueDrafts((current) => ({ ...current, [issue.id]: event.target.value }))}
                    onBlur={() => void updateIssue(issue, { note: issueDrafts[issue.id] ?? issue.note ?? '' })}
                    placeholder="Issue note"
                    style={styles.noteInput}
                  />
                  <div style={styles.controls}>
                    <select value={issue.status} onChange={(event) => void updateIssue(issue, { status: event.target.value as StaffIssueStatus })} style={styles.inlineSelect}>
                      {(['Open', 'Investigating', 'Waiting', 'Resolved'] as StaffIssueStatus[]).map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                    <Link href={`/villas/${issue.villaId}`} style={styles.smallLink}>
                      Open villa
                    </Link>
                    <Link href="/inbox" style={styles.smallLink}>
                      Open inbox
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <div>
              <h2 style={styles.panelTitle}>Needs Action Queue</h2>
              <p style={styles.panelCopy}>Critical cleaning risk, unread complaints, and maintenance follow-ups surface here instantly.</p>
            </div>
            <Link href="/" style={styles.link}>
              Back to Dashboard
            </Link>
          </div>

          <div style={styles.queueList}>
            {mergedTasks.filter((task) => isUrgentTask(task)).slice(0, 8).map((task: StaffTask) => (
              <div key={task.id} style={styles.queueRow}>
                <div>
                  <div style={styles.queueTitle}>
                    {task.type} | {task.villaName}
                  </div>
                  <div style={styles.queueMeta}>{task.description}</div>
                </div>
                <div style={styles.queueBadge}>{task.status}</div>
              </div>
            ))}
            {mergedTasks.filter((task) => isUrgentTask(task)).length === 0 ? (
              <div style={styles.emptyState}>No urgent tasks connected to current issues.</div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}

function IssueKpi({ title, value, accent }: { title: string; value: string; accent: string }) {
  return (
    <div style={{ ...styles.kpiCard, borderColor: accent }}>
      <div style={styles.kpiTitle}>{title}</div>
      <div style={styles.kpiValue}>{value}</div>
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
  copy: { margin: '8px 0 0', color: '#9fb0c6', lineHeight: 1.5, maxWidth: 620 },
  filters: { display: 'flex', gap: 10, flexWrap: 'wrap' as const },
  select: { minWidth: 150, padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: '#0f1a2b', color: '#fff' },
  errorBar: { padding: '12px 14px', borderRadius: 16, background: 'rgba(239,68,68,0.14)', border: '1px solid rgba(239,68,68,0.28)', color: '#fecdd3' },
  warningBar: { padding: '12px 14px', borderRadius: 16, background: 'rgba(198,169,107,0.14)', border: '1px solid rgba(198,169,107,0.28)', color: '#f6e4bf' },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 },
  kpiCard: { padding: 18, borderRadius: 20, background: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(10,15,25,0.9))', border: '1px solid rgba(255,255,255,0.08)' },
  kpiTitle: { color: '#8fa3bd', textTransform: 'uppercase' as const, letterSpacing: '0.08em', fontSize: 12 },
  kpiValue: { marginTop: 12, fontSize: 28, fontWeight: 700 },
  createCard: { padding: 20, borderRadius: 24, background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(8,13,22,0.95))', border: '1px solid rgba(255,255,255,0.08)', display: 'grid', gap: 12 },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 },
  formFooter: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10 },
  mainGrid: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(320px, 0.9fr)', gap: 18, alignItems: 'start' as const },
  panel: { padding: 20, borderRadius: 24, background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(8,13,22,0.95))', border: '1px solid rgba(255,255,255,0.08)' },
  panelHeader: { display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' as const, marginBottom: 14 },
  panelTitle: { margin: 0, fontSize: 22, letterSpacing: '-0.03em' },
  panelCopy: { margin: '6px 0 0', color: '#8fa3bd', fontSize: 14 },
  link: { color: '#f4e6c8', textDecoration: 'none' },
  issueList: { display: 'grid', gap: 10 },
  issueCard: { padding: 14, borderRadius: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', display: 'grid', gap: 8 },
  issueTop: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' as const },
  severity: { padding: '5px 9px', borderRadius: 999, fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.08em' },
  critical: { background: 'rgba(239,68,68,0.14)', color: '#fecdd3', border: '1px solid rgba(239,68,68,0.24)' },
  warning: { background: 'rgba(198,169,107,0.14)', color: '#f6e4bf', border: '1px solid rgba(198,169,107,0.24)' },
  normal: { background: 'rgba(24,194,156,0.12)', color: '#8ef0cf', border: '1px solid rgba(24,194,156,0.24)' },
  source: { marginLeft: 'auto', color: '#8fa3bd', fontSize: 12, textTransform: 'capitalize' as const },
  issueTitle: { fontWeight: 700 },
  issueSummary: { color: '#dbe5f1', fontSize: 14 },
  issueMeta: { color: '#8fa3bd', fontSize: 12 },
  textInput: { width: '100%', padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: '#0f1a2b', color: '#fff' },
  noteInput: { width: '100%', minHeight: 72, padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: '#0f1a2b', color: '#fff', resize: 'vertical' as const },
  createButton: { padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(24,194,156,0.24)', background: 'rgba(24,194,156,0.14)', color: '#fff', cursor: 'pointer' },
  controls: { display: 'flex', gap: 8, flexWrap: 'wrap' as const, alignItems: 'center' },
  inlineSelect: { padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: '#0f1a2b', color: '#fff' },
  smallLink: { color: '#9ddbf9', textDecoration: 'none', fontSize: 13 },
  queueList: { display: 'grid', gap: 10 },
  queueRow: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', padding: 14, borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' },
  queueTitle: { fontWeight: 700 },
  queueMeta: { color: '#8fa3bd', fontSize: 13, marginTop: 4 },
  queueBadge: { padding: '6px 10px', borderRadius: 999, background: 'rgba(198,169,107,0.14)', color: '#f6e4bf', fontSize: 12, whiteSpace: 'nowrap' as const },
  emptyState: { padding: 16, borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#8fa3bd', textAlign: 'center' as const },
}
