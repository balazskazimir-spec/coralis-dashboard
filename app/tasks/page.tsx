'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { canAccessOperations, filterBookingsForUser, filterExpensesForUser, filterVillasForUser } from '@/lib/access'
import { useRole } from '@/components/auth/RoleProvider'
import { BOOKING_SELECT, EXPENSE_SELECT, MESSAGE_SELECT, MESSAGE_THREAD_SELECT, STAFF_TASK_SELECT, VILLA_SELECT } from '@/lib/dbSelects'
import { buildInboxThreads } from '@/lib/inbox'
import { attachVillaNamesToTasks, buildManualTaskInput, buildStaffTasks, mergeStaffTasks } from '@/lib/staff'
import { supabase } from '@/lib/supabase'
import type { BookingRecord, ExpenseRecord, MessageRecord, MessageThreadRecord, StaffSeverity, StaffTask, StaffTaskRecord, StaffTaskStatus, StaffTaskType, VillaRecord } from '@/lib/types'

type ManualTaskState = { villaId: string; type: StaffTaskType; description: string; dueAt: string; priority: StaffSeverity; status: StaffTaskStatus; assignee: string; note: string }
type CeoFilter = 'all' | 'open' | 'overdue' | 'blocked'

const sx = {
  page: { minHeight: '100vh', padding: 28, color: '#f7fbff', background: 'linear-gradient(180deg, #07101d 0%, #0d1729 100%)', display: 'flex', flexDirection: 'column' as const, gap: 18 },
  hero: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' as const, padding: 24, borderRadius: 24, background: 'linear-gradient(135deg, rgba(9,15,26,0.98), rgba(18,28,45,0.92))', border: '1px solid rgba(198,169,107,0.18)' },
  eyebrow: { color: '#82e4cc', textTransform: 'uppercase' as const, letterSpacing: '0.12em', fontSize: 12, marginBottom: 8 },
  title: { margin: 0, fontSize: 34, letterSpacing: '-0.04em' },
  copy: { margin: '8px 0 0', color: '#9fb0c6', lineHeight: 1.5, maxWidth: 720 },
  bar: { padding: '12px 14px', borderRadius: 16, border: '1px solid', fontSize: 14 },
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 },
  card: { padding: 18, borderRadius: 20, background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(8,13,22,0.94))', border: '1px solid rgba(255,255,255,0.08)' },
  small: { fontSize: 12, color: '#8fa3bd', textTransform: 'uppercase' as const, letterSpacing: '0.08em' },
  big: { marginTop: 12, fontSize: 30, fontWeight: 700, letterSpacing: '-0.04em' },
  note: { marginTop: 8, fontSize: 13, color: '#c8d4e5' },
  grid2: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 0.95fr)', gap: 18, alignItems: 'start' as const },
  panel: { padding: 22, borderRadius: 24, background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(8,13,22,0.95))', border: '1px solid rgba(255,255,255,0.08)' },
  header: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' as const, marginBottom: 14 },
  panelTitle: { margin: 0, fontSize: 22, letterSpacing: '-0.03em' },
  panelCopy: { margin: '6px 0 0', color: '#8fa3bd', fontSize: 14 },
  filters: { display: 'flex', gap: 10, flexWrap: 'wrap' as const },
  select: { minWidth: 150, padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: '#0f1a2b', color: '#fff' },
  input: { width: '100%', padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: '#0f1a2b', color: '#fff' },
  action: { display: 'inline-flex', alignItems: 'center', padding: '10px 14px', borderRadius: 999, border: '1px solid rgba(198,169,107,0.24)', color: '#f4e6c8', textDecoration: 'none', background: 'rgba(198,169,107,0.10)' },
  calendar: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 10 },
  day: { minHeight: 90, padding: 12, borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column' as const, justifyContent: 'space-between' as const },
  form: { display: 'grid', gap: 10 },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 },
  formFoot: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10 },
  button: { padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(24,194,156,0.24)', background: 'rgba(24,194,156,0.14)', color: '#fff', cursor: 'pointer' },
  table: { display: 'grid', gap: 8 },
  tableHead: { display: 'grid', gridTemplateColumns: '1.1fr 1.6fr 1fr 0.8fr 1fr 1fr 1.2fr', gap: 12, padding: '0 10px', color: '#8fa3bd', textTransform: 'uppercase' as const, fontSize: 11, letterSpacing: '0.08em' },
  row: { display: 'grid', gridTemplateColumns: '1.1fr 1.6fr 1fr 0.8fr 1fr 1fr 1.2fr', gap: 12, alignItems: 'center', padding: 14, borderRadius: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' },
  staffRow: { display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr) 160px', gap: 12, alignItems: 'center', padding: 14, borderRadius: 18, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' },
}

function isMissingTable(message?: string | null) { const value = message?.toLowerCase() || ''; return value.includes('staff_tasks') || value.includes('does not exist') }
function isOverdue(task: StaffTask, now: number) { return task.status !== 'Done' && new Date(task.dueAt).getTime() < now }
function fmt(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
function blankTask(name: string, villaId = ''): ManualTaskState { return { villaId, type: 'Follow-up', description: '', dueAt: '', priority: 'Normal', status: 'To do', assignee: name, note: '' } }

export default function TasksPage() {
  const { currentUser } = useRole()
  const [villas, setVillas] = useState<VillaRecord[]>([])
  const [bookings, setBookings] = useState<BookingRecord[]>([])
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([])
  const [threadRows, setThreadRows] = useState<MessageThreadRecord[]>([])
  const [messageRows, setMessageRows] = useState<MessageRecord[]>([])
  const [taskRows, setTaskRows] = useState<StaffTaskRecord[]>([])
  const [taskNoteDrafts, setTaskNoteDrafts] = useState<Record<string, string>>({})
  const [taskAssigneeDrafts, setTaskAssigneeDrafts] = useState<Record<string, string>>({})
  const [manualTask, setManualTask] = useState<ManualTaskState>(() => blankTask(currentUser.name))
  const [setupMessage, setSetupMessage] = useState('')
  const [error, setError] = useState('')

  async function load(syncOps = false) {
    setError('')
    if (syncOps) {
      await fetch('/api/sync-staff-ops', { method: 'POST' }).catch(() => null)
    }
    const [v, b, e, t, m, task] = await Promise.all([
      supabase.from('villas').select(VILLA_SELECT).order('name'),
      supabase.from('bookings').select(BOOKING_SELECT).order('check_in', { ascending: false }),
      supabase.from('expenses').select(EXPENSE_SELECT).order('date', { ascending: false }),
      supabase.from('message_threads').select(MESSAGE_THREAD_SELECT).order('last_message_at', { ascending: false }),
      supabase.from('messages').select(MESSAGE_SELECT).order('sent_at', { ascending: true }),
      supabase.from('staff_tasks').select(STAFF_TASK_SELECT).order('due_at', { ascending: true }),
    ])
    setVillas((v.data as VillaRecord[]) || [])
    setBookings((b.data as BookingRecord[]) || [])
    setExpenses((e.data as ExpenseRecord[]) || [])
    setThreadRows((t.data as MessageThreadRecord[]) || [])
    setMessageRows((m.data as MessageRecord[]) || [])
    setTaskRows((task.data as StaffTaskRecord[]) || [])
    const missing = isMissingTable(task.error?.message)
    setSetupMessage(missing ? 'Staff task tables are not available yet. Run the staff ops Supabase schema first.' : '')
    if (!missing) setError(v.error?.message || b.error?.message || e.error?.message || t.error?.message || m.error?.message || task.error?.message || '')
  }

  async function refreshTaskRows() {
    const task = await supabase.from('staff_tasks').select(STAFF_TASK_SELECT).order('due_at', { ascending: true })
    setTaskRows((task.data as StaffTaskRecord[]) || [])
    setError(task.error?.message || '')
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(true) }, 0)
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
        void refreshTaskRows()
      }, 150)
    }
    const channel = supabase.channel('tasks-page').on('postgres_changes', { event: '*', schema: 'public', table: 'staff_tasks' }, queueRefresh).subscribe()
    return () => {
      if (refreshTimer) {
        window.clearTimeout(refreshTimer)
      }
      void supabase.removeChannel(channel)
    }
  }, [setupMessage])

  const visibleVillas = useMemo(() => filterVillasForUser(villas, currentUser), [currentUser, villas])
  const visibleVillaIds = useMemo(() => new Set(visibleVillas.map((villa) => villa.id)), [visibleVillas])
  const visibleBookings = useMemo(() => filterBookingsForUser(bookings, currentUser).filter((booking) => booking.villa_id && visibleVillaIds.has(booking.villa_id)), [bookings, currentUser, visibleVillaIds])
  const visibleExpenses = useMemo(() => filterExpensesForUser(expenses, currentUser).filter((expense) => expense.villa_id && visibleVillaIds.has(expense.villa_id)), [currentUser, expenses, visibleVillaIds])
  const threads = useMemo(() => buildInboxThreads(threadRows.filter((thread) => thread.villa_id && visibleVillaIds.has(thread.villa_id)), messageRows, visibleBookings, visibleVillas), [messageRows, threadRows, visibleBookings, visibleVillaIds, visibleVillas])
  const tasks = useMemo(() => {
    const derived = attachVillaNamesToTasks(buildStaffTasks(visibleBookings, threads, visibleExpenses, currentUser.name, 'week', new Date()), visibleVillas)
    return mergeStaffTasks(derived, taskRows.filter((task) => task.villa_id && visibleVillaIds.has(task.villa_id)), visibleVillas)
  }, [currentUser.name, taskRows, threads, visibleBookings, visibleExpenses, visibleVillaIds, visibleVillas])

  async function updateTask(task: StaffTask, patch: Partial<Pick<StaffTaskRecord, 'status' | 'note' | 'assignee'>>) {
    if (!task.recordId) return
    const result = await supabase.from('staff_tasks').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', task.recordId).select('*').single()
    if (result.error || !result.data) { setError(result.error?.message || 'Failed to update task.'); return }
    const row = result.data as StaffTaskRecord
    setTaskRows((current) => current.map((item) => (item.id === row.id ? row : item)))
  }

  async function createManualTask() {
    if (!manualTask.villaId || !manualTask.description.trim() || !manualTask.dueAt) { setError('Villa, description, and due time are required for a manual task.'); return }
    const payload = buildManualTaskInput({ externalKey: `manual-task-${crypto.randomUUID()}`, villaId: manualTask.villaId, type: manualTask.type, description: manualTask.description.trim(), dueAt: new Date(manualTask.dueAt).toISOString(), priority: manualTask.priority, status: manualTask.status, assignee: manualTask.assignee.trim() || currentUser.name, note: manualTask.note.trim() })
    const result = await supabase.from('staff_tasks').insert(payload).select('*').single()
    if (result.error || !result.data) { setError(result.error?.message || 'Failed to create manual task.'); return }
    setTaskRows((current) => [result.data as StaffTaskRecord, ...current])
    setManualTask(blankTask(currentUser.name, manualTask.villaId))
  }

  if (!canAccessOperations(currentUser.role)) return <div style={sx.page}><div style={{ ...sx.bar, borderColor: 'rgba(198,169,107,0.28)', background: 'rgba(198,169,107,0.14)', color: '#f6e4bf' }}>Task management is only available for admin and staff roles.</div></div>

  return currentUser.role === 'admin'
    ? <CeoBoard currentUserName={currentUser.name} error={error} manualTask={manualTask} onCreateManualTask={createManualTask} onUpdateTask={updateTask} setManualTask={setManualTask} setTaskAssigneeDrafts={setTaskAssigneeDrafts} setTaskNoteDrafts={setTaskNoteDrafts} setupMessage={setupMessage} taskAssigneeDrafts={taskAssigneeDrafts} taskNoteDrafts={taskNoteDrafts} tasks={tasks} villas={visibleVillas} />
    : <StaffBoard error={error} manualTask={manualTask} onCreateManualTask={createManualTask} onUpdateTask={updateTask} setManualTask={setManualTask} setTaskNoteDrafts={setTaskNoteDrafts} setupMessage={setupMessage} taskNoteDrafts={taskNoteDrafts} tasks={tasks} villas={visibleVillas} />
}

function CeoBoard({ currentUserName, error, manualTask, onCreateManualTask, onUpdateTask, setManualTask, setTaskAssigneeDrafts, setTaskNoteDrafts, setupMessage, taskAssigneeDrafts, taskNoteDrafts, tasks, villas }: { currentUserName: string; error: string; manualTask: ManualTaskState; onCreateManualTask: () => void; onUpdateTask: (task: StaffTask, patch: Partial<Pick<StaffTaskRecord, 'status' | 'note' | 'assignee'>>) => Promise<void>; setManualTask: React.Dispatch<React.SetStateAction<ManualTaskState>>; setTaskAssigneeDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>; setTaskNoteDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>; setupMessage: string; taskAssigneeDrafts: Record<string, string>; taskNoteDrafts: Record<string, string>; tasks: StaffTask[]; villas: VillaRecord[] }) {
  const [now, setNow] = useState(() => Date.now())
  const [filter, setFilter] = useState<CeoFilter>('all')
  const [villaFilter, setVillaFilter] = useState('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const assignees = Array.from(new Set(tasks.map((task) => task.assignee || 'Unassigned'))).sort()
  const openTasks = tasks.filter((task) => task.status !== 'Done')
  const overdueTasks = openTasks.filter((task) => isOverdue(task, now))
  const blockedTasks = openTasks.filter((task) => task.status === 'Blocked')
  const criticalTasks = openTasks.filter((task) => task.priority === 'Critical')
  const filtered = tasks.filter((task) => (villaFilter === 'all' ? true : task.villaId === villaFilter)).filter((task) => (assigneeFilter === 'all' ? true : task.assignee === assigneeFilter)).filter((task) => filter === 'open' ? task.status !== 'Done' : filter === 'overdue' ? isOverdue(task, now) : filter === 'blocked' ? task.status === 'Blocked' : true).sort((a, b) => Number(isOverdue(b, now)) - Number(isOverdue(a, now)) || a.dueAt.localeCompare(b.dueAt))
  const byAssignee = assignees.map((assignee) => ({ assignee, overdue: overdueTasks.filter((task) => task.assignee === assignee).length, open: openTasks.filter((task) => task.assignee === assignee).length })).filter((row) => row.overdue > 0 || row.open > 0).sort((a, b) => b.overdue - a.overdue || b.open - a.open).slice(0, 6)
  const byVilla = villas.map((villa) => ({ villa: villa.name, open: openTasks.filter((task) => task.villaId === villa.id).length, overdue: openTasks.filter((task) => task.villaId === villa.id && isOverdue(task, now)).length })).filter((row) => row.open > 0).sort((a, b) => b.open - a.open).slice(0, 6)
  const days = Array.from({ length: 14 }, (_, index) => { const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() + index); const start = date.getTime(); const end = start + 86400000; const count = openTasks.filter((task) => { const due = new Date(task.dueAt).getTime(); return due >= start && due < end }).length; const carry = overdueTasks.filter((task) => new Date(task.dueAt).getTime() < start).length; return { key: date.toISOString(), label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), count, carry } })

  return (
    <div style={sx.page}>
      <header style={sx.hero}>
        <div><div style={sx.eyebrow}>Executive Task Command</div><h1 style={sx.title}>CEO Tasks</h1><p style={sx.copy}>An Asana-like management layer for overdue work, ownership pressure, delegation, and villa execution load.</p></div>
        <div style={sx.filters}><Link href="/issues" style={sx.action}>Open Issues</Link><Link href="/" style={sx.action}>Back to Dashboard</Link></div>
      </header>
      {error ? <div style={{ ...sx.bar, borderColor: 'rgba(239,68,68,0.28)', background: 'rgba(239,68,68,0.14)', color: '#fecdd3' }}>{error}</div> : null}
      {setupMessage ? <div style={{ ...sx.bar, borderColor: 'rgba(198,169,107,0.28)', background: 'rgba(198,169,107,0.14)', color: '#f6e4bf' }}>{setupMessage}</div> : null}

      <section style={sx.kpis}>
        <Metric title="Open Tasks" value={String(openTasks.length)} note="All active work items" />
        <Metric title="Overdue" value={String(overdueTasks.length)} note="Past due and not done" />
        <Metric title="Blocked" value={String(blockedTasks.length)} note="Waiting on unblock" />
        <Metric title="Critical" value={String(criticalTasks.length)} note="High-priority work" />
      </section>

      <section style={sx.grid2}>
        <div style={sx.panel}>
          <div style={sx.header}><div><h2 style={sx.panelTitle}>Overdue by Assignee</h2><p style={sx.panelCopy}>See who owns the late work and where pressure is accumulating.</p></div></div>
          <ResponsiveContainer width="100%" height={280}><BarChart data={byAssignee}><CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} /><XAxis dataKey="assignee" stroke="#8fa3bd" tickLine={false} axisLine={false} /><YAxis stroke="#8fa3bd" tickLine={false} axisLine={false} /><Tooltip /><Bar dataKey="open" fill="#60a5fa" radius={[6, 6, 0, 0]} /><Bar dataKey="overdue" fill="#ef4444" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer>
        </div>
        <div style={sx.panel}>
          <div style={sx.header}><div><h2 style={sx.panelTitle}>Load by Villa</h2><p style={sx.panelCopy}>Which villas are pulling the queue higher.</p></div></div>
          <ResponsiveContainer width="100%" height={280}><BarChart data={byVilla}><CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} /><XAxis dataKey="villa" stroke="#8fa3bd" tickLine={false} axisLine={false} /><YAxis stroke="#8fa3bd" tickLine={false} axisLine={false} /><Tooltip /><Bar dataKey="open" fill="#18c29c" radius={[6, 6, 0, 0]} /><Bar dataKey="overdue" fill="#f59e0b" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer>
        </div>
      </section>

      <section style={sx.grid2}>
        <div style={sx.panel}>
          <div style={sx.header}><div><h2 style={sx.panelTitle}>Task Calendar</h2><p style={sx.panelCopy}>Two-week view with overdue carry pressure in red.</p></div></div>
          <div style={sx.calendar}>{days.map((day) => <div key={day.key} style={{ ...sx.day, borderColor: day.carry > 0 ? 'rgba(239,68,68,0.35)' : 'rgba(255,255,255,0.08)', background: day.count === 0 ? 'rgba(255,255,255,0.03)' : day.carry > 0 ? 'linear-gradient(180deg, rgba(239,68,68,0.18), rgba(8,13,22,0.94))' : 'linear-gradient(180deg, rgba(24,194,156,0.16), rgba(8,13,22,0.94))' }}><div style={sx.small}>{day.label}</div><div style={sx.big}>{day.count}</div><div style={sx.note}>{day.carry > 0 ? `${day.carry} overdue carry` : 'On track'}</div></div>)}</div>
        </div>
        <div style={sx.panel}>
          <div style={sx.header}><div><h2 style={sx.panelTitle}>Create / Delegate Task</h2><p style={sx.panelCopy}>Manual assignment for management follow-up.</p></div></div>
          <div style={sx.form}>
            <div style={sx.formGrid}>
              <select value={manualTask.villaId} onChange={(event) => setManualTask((current) => ({ ...current, villaId: event.target.value }))} style={sx.select}><option value="">Select villa</option>{villas.map((villa) => <option key={villa.id} value={villa.id}>{villa.name}</option>)}</select>
              <select value={manualTask.type} onChange={(event) => setManualTask((current) => ({ ...current, type: event.target.value as StaffTaskType }))} style={sx.select}>{(['Check-in', 'Check-out', 'Cleaning', 'Maintenance', 'Guest request', 'Inspection', 'Follow-up'] as StaffTaskType[]).map((type) => <option key={type} value={type}>{type}</option>)}</select>
              <input value={manualTask.assignee} onChange={(event) => setManualTask((current) => ({ ...current, assignee: event.target.value }))} placeholder="Delegate to" style={sx.input} />
              <input value={manualTask.description} onChange={(event) => setManualTask((current) => ({ ...current, description: event.target.value }))} placeholder="Task description" style={sx.input} />
              <input type="datetime-local" value={manualTask.dueAt} onChange={(event) => setManualTask((current) => ({ ...current, dueAt: event.target.value }))} style={sx.input} />
              <select value={manualTask.priority} onChange={(event) => setManualTask((current) => ({ ...current, priority: event.target.value as StaffSeverity }))} style={sx.select}>{(['Normal', 'Warning', 'Critical'] as StaffSeverity[]).map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select>
            </div>
            <div style={sx.formFoot}><input value={manualTask.note} onChange={(event) => setManualTask((current) => ({ ...current, note: event.target.value }))} placeholder="Optional note" style={sx.input} /><button type="button" onClick={onCreateManualTask} style={sx.button}>Create Task</button></div>
          </div>
        </div>
      </section>

      <section style={sx.panel}>
        <div style={sx.header}><div><h2 style={sx.panelTitle}>Executive Task Board</h2><p style={sx.panelCopy}>Filter for overdue or blocked work, then delegate inline.</p></div><div style={sx.filters}><select value={filter} onChange={(event) => setFilter(event.target.value as CeoFilter)} style={sx.select}><option value="all">All Tasks</option><option value="open">Open</option><option value="overdue">Overdue</option><option value="blocked">Blocked</option></select><select value={villaFilter} onChange={(event) => setVillaFilter(event.target.value)} style={sx.select}><option value="all">All Villas</option>{villas.map((villa) => <option key={villa.id} value={villa.id}>{villa.name}</option>)}</select><select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)} style={sx.select}><option value="all">All Owners</option>{assignees.map((assignee) => <option key={assignee} value={assignee}>{assignee}</option>)}</select></div></div>
        <div style={sx.table}>
          <div style={sx.tableHead}><span>Due</span><span>Task</span><span>Villa</span><span>Priority</span><span>Status</span><span>Delegate</span><span>Note</span></div>
          {filtered.length === 0 ? <div style={{ ...sx.card, color: '#8fa3bd', textAlign: 'center' as const }}>No tasks in this filter set.</div> : filtered.map((task) => <div key={task.id} style={sx.row}><span style={{ color: isOverdue(task, now) ? '#fecdd3' : '#f4e6c8', fontWeight: 700 }}>{fmt(task.dueAt)}</span><span><strong style={{ display: 'block' }}>{task.type}</strong><small style={{ display: 'block', marginTop: 4, color: '#8fa3bd' }}>{task.description}</small></span><span>{task.villaName}</span><span>{task.priority}</span><span><select value={task.status} onChange={(event) => void onUpdateTask(task, { status: event.target.value as StaffTaskStatus })} style={sx.input}>{(['To do', 'In progress', 'Done', 'Blocked'] as StaffTaskStatus[]).map((status) => <option key={status} value={status}>{status}</option>)}</select></span><span><input value={taskAssigneeDrafts[task.id] ?? task.assignee} onChange={(event) => setTaskAssigneeDrafts((current) => ({ ...current, [task.id]: event.target.value }))} onBlur={() => void onUpdateTask(task, { assignee: taskAssigneeDrafts[task.id] ?? task.assignee })} placeholder={currentUserName} style={sx.input} /></span><span><input value={taskNoteDrafts[task.id] ?? task.note} onChange={(event) => setTaskNoteDrafts((current) => ({ ...current, [task.id]: event.target.value }))} onBlur={() => void onUpdateTask(task, { note: taskNoteDrafts[task.id] ?? task.note })} placeholder="Delegation note" style={sx.input} /></span></div>)}
        </div>
      </section>
    </div>
  )
}

function StaffBoard({ error, manualTask, onCreateManualTask, onUpdateTask, setManualTask, setTaskNoteDrafts, setupMessage, taskNoteDrafts, tasks, villas }: { error: string; manualTask: ManualTaskState; onCreateManualTask: () => void; onUpdateTask: (task: StaffTask, patch: Partial<Pick<StaffTaskRecord, 'status' | 'note' | 'assignee'>>) => Promise<void>; setManualTask: React.Dispatch<React.SetStateAction<ManualTaskState>>; setTaskNoteDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>; setupMessage: string; taskNoteDrafts: Record<string, string>; tasks: StaffTask[]; villas: VillaRecord[] }) {
  return (
    <div style={sx.page}>
      <div><div style={sx.eyebrow}>Staff Ops</div><h1 style={sx.title}>Tasks</h1><p style={sx.copy}>Persistent task queue synced from bookings, guest communication, and maintenance events.</p></div>
      {error ? <div style={{ ...sx.bar, borderColor: 'rgba(239,68,68,0.28)', background: 'rgba(239,68,68,0.14)', color: '#fecdd3' }}>{error}</div> : null}
      {setupMessage ? <div style={{ ...sx.bar, borderColor: 'rgba(198,169,107,0.28)', background: 'rgba(198,169,107,0.14)', color: '#f6e4bf' }}>{setupMessage}</div> : null}
      <div style={{ ...sx.card, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' as const }}><strong>Manual Task</strong><span style={{ color: '#8fa3bd', fontSize: 13 }}>Create one-off operational work outside the auto-generated flow.</span></div>
        <div style={sx.formGrid}>
          <select value={manualTask.villaId} onChange={(event) => setManualTask((current) => ({ ...current, villaId: event.target.value }))} style={sx.select}><option value="">Select villa</option>{villas.map((villa) => <option key={villa.id} value={villa.id}>{villa.name}</option>)}</select>
          <select value={manualTask.type} onChange={(event) => setManualTask((current) => ({ ...current, type: event.target.value as StaffTaskType }))} style={sx.select}>{(['Check-in', 'Check-out', 'Cleaning', 'Maintenance', 'Guest request', 'Inspection', 'Follow-up'] as StaffTaskType[]).map((type) => <option key={type} value={type}>{type}</option>)}</select>
          <input value={manualTask.description} onChange={(event) => setManualTask((current) => ({ ...current, description: event.target.value }))} placeholder="Task description" style={sx.input} />
          <input type="datetime-local" value={manualTask.dueAt} onChange={(event) => setManualTask((current) => ({ ...current, dueAt: event.target.value }))} style={sx.input} />
          <select value={manualTask.priority} onChange={(event) => setManualTask((current) => ({ ...current, priority: event.target.value as StaffSeverity }))} style={sx.select}>{(['Normal', 'Warning', 'Critical'] as StaffSeverity[]).map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select>
          <input value={manualTask.assignee} onChange={(event) => setManualTask((current) => ({ ...current, assignee: event.target.value }))} placeholder="Assignee" style={sx.input} />
        </div>
        <div style={sx.formFoot}><input value={manualTask.note} onChange={(event) => setManualTask((current) => ({ ...current, note: event.target.value }))} placeholder="Optional note" style={sx.input} /><button type="button" onClick={onCreateManualTask} style={sx.button}>Create Task</button></div>
      </div>
      <div style={{ display: 'grid', gap: 10 }}>{tasks.map((task) => <div key={task.id} style={sx.staffRow}><div><div style={{ color: '#c6a96b', fontWeight: 700 }}>{task.time}</div><div style={{ color: '#8fa3bd', fontSize: 12, marginTop: 4 }}>{task.villaName}</div></div><div><div style={{ fontWeight: 700 }}>{task.type}</div><div style={{ color: '#c8d4e5', marginTop: 4, marginBottom: 8 }}>{task.description}</div><input value={taskNoteDrafts[task.id] ?? task.note} onChange={(event) => setTaskNoteDrafts((current) => ({ ...current, [task.id]: event.target.value }))} onBlur={() => void onUpdateTask(task, { note: taskNoteDrafts[task.id] ?? task.note })} placeholder="Task note" style={sx.input} /></div><select value={task.status} onChange={(event) => void onUpdateTask(task, { status: event.target.value as StaffTaskStatus })} style={sx.select}>{(['To do', 'In progress', 'Done', 'Blocked'] as StaffTaskStatus[]).map((status) => <option key={status} value={status}>{status}</option>)}</select></div>)}</div>
    </div>
  )
}

function Metric({ title, value, note }: { title: string; value: string; note: string }) {
  return <div style={sx.card}><div style={sx.small}>{title}</div><div style={sx.big}>{value}</div><div style={sx.note}>{note}</div></div>
}

