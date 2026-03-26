'use client'

import { useEffect, useMemo, useState } from 'react'
import { filterExpensesForUser, filterVillasForUser } from '@/lib/access'
import { useRole } from '@/components/auth/RoleProvider'
import { EXPENSE_SELECT, EXPENSE_SUBMISSION_SELECT, VILLA_SELECT } from '@/lib/dbSelects'
import { supabase } from '@/lib/supabase'
import type { ExpenseRecord, ExpenseSubmissionRecord, StaffExpenseCategory, StaffExpenseItem, StaffExpenseStatus, VillaRecord } from '@/lib/types'

const CATEGORIES: StaffExpenseCategory[] = ['Cleaning', 'Maintenance', 'Utilities', 'Supplies', 'Staff', 'Transport', 'Other']
const STATUSES: Array<'all' | StaffExpenseStatus> = ['all', 'Draft', 'Submitted', 'Needs Review', 'Approved', 'Rejected']
const DB_CATEGORY: Record<StaffExpenseCategory, string> = { Cleaning: 'cleaning', Maintenance: 'maintenance', Utilities: 'utilities', Supplies: 'supplies', Staff: 'staff', Transport: 'transport', Other: 'other' }
const UI_CATEGORY: Record<string, StaffExpenseCategory> = { cleaning: 'Cleaning', maintenance: 'Maintenance', utilities: 'Utilities', supplies: 'Supplies', staff: 'Staff', transport: 'Transport', other: 'Other' }
const LIMITS: Record<StaffExpenseCategory, number> = { Cleaning: 1_500_000, Maintenance: 5_000_000, Utilities: 3_500_000, Supplies: 1_250_000, Staff: 15_000_000, Transport: 1_000_000, Other: 2_000_000 }
type DateFilter = 'today' | '7d' | '30d' | 'all'
type FormState = { expenseId: string | null; villaId: string; expenseDate: string; category: StaffExpenseCategory; amount: string; vendor: string; note: string; receiptName: string | null; receiptDataUrl: string | null }

const EMPTY_FORM: FormState = { expenseId: null, villaId: '', expenseDate: new Date().toISOString().slice(0, 10), category: 'Cleaning', amount: '', vendor: '', note: '', receiptName: null, receiptDataUrl: null }

const money = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n)
const dateLabel = (v: string) => Number.isNaN(new Date(v).getTime()) ? v : new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const timeLabel = (v: string) => Number.isNaN(new Date(v).getTime()) ? 'Unknown' : new Date(v).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
const statusOf = (s?: string | null): StaffExpenseStatus => s === 'Draft' || s === 'Submitted' || s === 'Needs Review' || s === 'Approved' || s === 'Rejected' ? s : 'Approved'
const categoryOf = (c?: string | null): StaffExpenseCategory => UI_CATEGORY[(c || '').toLowerCase()] || 'Other'

function cutoffOf(filter: DateFilter) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  if (filter === 'today') return d
  if (filter === '7d') { d.setDate(d.getDate() - 7); return d }
  if (filter === '30d') { d.setDate(d.getDate() - 30); return d }
  return new Date(0)
}

function flaggedReason(item: { status: StaffExpenseStatus; amount: number; category: StaffExpenseCategory; receiptName: string | null; receiptDataUrl: string | null; flaggedReason?: string | null }) {
  if (item.flaggedReason) return item.flaggedReason
  if (item.status === 'Rejected') return 'Rejected by admin'
  if (!item.receiptName && !item.receiptDataUrl) return 'Missing receipt'
  if (item.amount >= LIMITS[item.category]) return 'Amount unusually high'
  if (item.status === 'Needs Review') return 'Needs review before approval'
  return null
}

function nextStatus(category: StaffExpenseCategory, amount: number, hasReceipt: boolean, requested: 'Draft' | 'Submitted'): StaffExpenseStatus {
  if (requested === 'Draft') return 'Draft'
  return !hasReceipt || amount >= LIMITS[category] ? 'Needs Review' : 'Submitted'
}

function searchText(item: StaffExpenseItem) {
  return [item.expenseDate, item.villaName, item.category, item.vendor, item.note, item.submittedBy, item.status, item.flaggedReason || ''].join(' ').toLowerCase()
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export default function StaffExpensesWorkspace() {
  const { currentUser } = useRole()
  const [villas, setVillas] = useState<VillaRecord[]>([])
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([])
  const [submissions, setSubmissions] = useState<ExpenseSubmissionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [schemaMissing, setSchemaMissing] = useState(false)
  const [dateFilter, setDateFilter] = useState<DateFilter>('30d')
  const [villaFilter, setVillaFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | StaffExpenseCategory>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | StaffExpenseStatus>('all')
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [v, e, s] = await Promise.all([
        supabase.from('villas').select(VILLA_SELECT).order('name'),
        supabase.from('expenses').select(EXPENSE_SELECT).order('date', { ascending: false }),
        supabase.from('expense_submissions').select(EXPENSE_SUBMISSION_SELECT).order('expense_date', { ascending: false }),
      ])
      setVillas((v.data as VillaRecord[]) || [])
      setExpenses((e.data as ExpenseRecord[]) || [])
      const missing = (s.error?.message || '').toLowerCase().includes('expense_submissions')
      setSchemaMissing(missing)
      setSubmissions(missing ? [] : ((s.data as ExpenseSubmissionRecord[]) || []))
      setLoading(false)
    }
    void load()
  }, [])

  const visibleVillas = useMemo(() => filterVillasForUser(villas, currentUser), [currentUser, villas])
  const defaultVillaId = visibleVillas[0]?.id || ''

  const items = useMemo<StaffExpenseItem[]>(() => {
    const submissionMap = new Map(submissions.map((s) => [s.expense_id, s]))
    return filterExpensesForUser(expenses, currentUser).map((expense) => {
      const submission = submissionMap.get(expense.id)
      const category = submission ? categoryOf(submission.category) : categoryOf(expense.category)
      const status = submission ? statusOf(submission.status) : 'Approved'
      const amount = Number(submission?.amount ?? expense.amount ?? 0)
      const receiptName = submission?.receipt_name || null
      const receiptDataUrl = submission?.receipt_data_url || null
      return {
        id: submission?.id || expense.id,
        expenseId: expense.id,
        villaId: expense.villa_id,
        villaName: visibleVillas.find((villa) => villa.id === expense.villa_id)?.name || 'Unknown Villa',
        expenseDate: submission?.expense_date || expense.date || '',
        amount,
        category,
        vendor: submission?.vendor || expense.vendor || '',
        note: submission?.note || expense.note || '',
        submittedBy: submission?.submitted_by || 'System import',
        status,
        receiptName,
        receiptDataUrl,
        flaggedReason: flaggedReason({ status, amount, category, receiptName, receiptDataUrl, flaggedReason: submission?.flagged_reason }),
        createdAt: submission?.created_at || expense.date || '',
        updatedAt: submission?.updated_at || submission?.created_at || expense.date || '',
        isLegacy: !submission,
      }
    }).sort((a, b) => new Date(b.expenseDate).getTime() - new Date(a.expenseDate).getTime())
  }, [currentUser, expenses, submissions, visibleVillas])

  const filteredItems = useMemo(() => {
    const cutoff = cutoffOf(dateFilter)
    const query = search.trim().toLowerCase()
    return items.filter((item) => {
      const d = new Date(item.expenseDate)
      if (!Number.isNaN(d.getTime()) && d < cutoff) return false
      if (villaFilter !== 'all' && item.villaId !== villaFilter) return false
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false
      if (statusFilter !== 'all' && item.status !== statusFilter) return false
      if (query && !searchText(item).includes(query)) return false
      return true
    })
  }, [categoryFilter, dateFilter, items, search, statusFilter, villaFilter])

  const recentItems = filteredItems.slice(0, 6)
  const pendingItems = filteredItems.filter((item) => item.flaggedReason || item.status === 'Rejected' || item.status === 'Needs Review').slice(0, 6)

  function edit(item: StaffExpenseItem) {
    setForm({ expenseId: item.expenseId, villaId: item.villaId || defaultVillaId, expenseDate: item.expenseDate, category: item.category, amount: String(item.amount), vendor: item.vendor, note: item.note, receiptName: item.receiptName, receiptDataUrl: item.receiptDataUrl })
  }

  function clear() {
    setForm({ ...EMPTY_FORM, villaId: defaultVillaId, expenseDate: new Date().toISOString().slice(0, 10) })
  }

  async function reload() {
    const [e, s] = await Promise.all([
      supabase.from('expenses').select(EXPENSE_SELECT).order('date', { ascending: false }),
      supabase.from('expense_submissions').select(EXPENSE_SUBMISSION_SELECT).order('expense_date', { ascending: false }),
    ])
    setExpenses((e.data as ExpenseRecord[]) || [])
    setSubmissions((s.data as ExpenseSubmissionRecord[]) || [])
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const dataUrl = await readAsDataUrl(file)
    setForm((c) => ({ ...c, receiptName: file.name, receiptDataUrl: dataUrl }))
  }

  async function save(requested: 'Draft' | 'Submitted') {
    const activeVillaId = form.villaId || defaultVillaId
    if (schemaMissing || !activeVillaId || !form.expenseDate || !form.amount) return
    const amount = Number(form.amount)
    if (!Number.isFinite(amount) || amount <= 0) return
    setSaving(true)
    const status = nextStatus(form.category, amount, Boolean(form.receiptName || form.receiptDataUrl), requested)
    const flagged = flaggedReason({ status, amount, category: form.category, receiptName: form.receiptName, receiptDataUrl: form.receiptDataUrl })
    let expenseId = form.expenseId
    if (expenseId) {
      const updated = await supabase.from('expenses').update({ villa_id: activeVillaId, date: form.expenseDate, category: DB_CATEGORY[form.category], amount, note: form.note }).eq('id', expenseId)
      if (updated.error) { setSaving(false); return }
    } else {
      const inserted = await supabase.from('expenses').insert({ villa_id: activeVillaId, date: form.expenseDate, category: DB_CATEGORY[form.category], amount, note: form.note }).select('*').single()
      if (inserted.error || !inserted.data) { setSaving(false); return }
      expenseId = String((inserted.data as ExpenseRecord).id)
    }
    const existing = submissions.find((s) => s.expense_id === expenseId)
    const payload = { expense_id: expenseId, villa_id: activeVillaId, expense_date: form.expenseDate, category: form.category, amount, vendor: form.vendor.trim() || null, note: form.note.trim() || null, submitted_by: currentUser.name, status, receipt_name: form.receiptName, receipt_data_url: form.receiptDataUrl, flagged_reason: flagged, updated_at: new Date().toISOString() }
    const result = existing ? await supabase.from('expense_submissions').update(payload).eq('expense_id', expenseId) : await supabase.from('expense_submissions').insert({ ...payload, created_at: new Date().toISOString() })
    setSaving(false)
    if (result.error) return
    await reload()
    clear()
  }

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div><h1 style={s.title}>Expenses</h1><p style={s.subtitle}>Record and manage villa expenses</p></div>
        <div style={s.filters}>
          <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value as DateFilter)} style={s.select}><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="all">All time</option></select>
          <select value={villaFilter} onChange={(e) => setVillaFilter(e.target.value)} style={s.select}><option value="all">All Villas</option>{visibleVillas.map((villa) => <option key={villa.id} value={villa.id}>{villa.name}</option>)}</select>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as 'all' | StaffExpenseCategory)} style={s.select}><option value="all">All Categories</option>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | StaffExpenseStatus)} style={s.select}>{STATUSES.map((status) => <option key={status} value={status}>{status === 'all' ? 'All Statuses' : status}</option>)}</select>
        </div>
      </header>

      {schemaMissing ? <div style={s.warning}><strong>Expense workflow schema missing.</strong><div style={s.warningCopy}>Run the `supabase/staff_expenses_schema.sql` file in Supabase SQL Editor, then refresh this page.</div></div> : null}

      <section style={s.card}>
        <div style={s.cardHead}><div><h2 style={s.cardTitle}>{form.expenseId ? 'Edit Expense' : 'Quick Add Expense'}</h2><p style={s.cardCopy}>Structured categories, receipt capture, and review-friendly submission.</p></div>{form.expenseId ? <button type="button" onClick={clear} style={s.secondary}>Clear</button> : null}</div>
        <div style={s.formGrid}>
          <select value={form.villaId || defaultVillaId} onChange={(e) => setForm((c) => ({ ...c, villaId: e.target.value }))} style={s.input}>{visibleVillas.map((villa) => <option key={villa.id} value={villa.id}>{villa.name}</option>)}</select>
          <input type="date" value={form.expenseDate} onChange={(e) => setForm((c) => ({ ...c, expenseDate: e.target.value }))} style={s.input} />
          <select value={form.category} onChange={(e) => setForm((c) => ({ ...c, category: e.target.value as StaffExpenseCategory }))} style={s.input}>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <input type="number" value={form.amount} onChange={(e) => setForm((c) => ({ ...c, amount: e.target.value }))} placeholder="Amount" style={s.input} />
          <input value={form.vendor} onChange={(e) => setForm((c) => ({ ...c, vendor: e.target.value }))} placeholder="Vendor / place" style={s.input} />
          <input type="file" accept="image/*,application/pdf" onChange={(e) => void onFile(e)} style={s.input} />
        </div>
        <textarea value={form.note} onChange={(e) => setForm((c) => ({ ...c, note: e.target.value }))} placeholder="Short note..." rows={3} style={s.textarea} />
        <div style={s.formFoot}><div style={s.receipt}>{form.receiptName ? `Attached: ${form.receiptName}` : 'No receipt attached yet'}</div><div style={s.actions}><button type="button" onClick={() => void save('Draft')} style={s.secondary} disabled={saving || schemaMissing}>Save Draft</button><button type="button" onClick={() => void save('Submitted')} style={s.primary} disabled={saving || schemaMissing}>{saving ? 'Saving...' : (form.expenseId ? 'Update Expense' : 'Submit Expense')}</button></div></div>
      </section>

      <div style={s.grid}>
        <section style={s.card}>
          <div style={s.cardHead}><div><h2 style={s.cardTitle}>Today / Recent Expenses</h2><p style={s.cardCopy}>See what was already logged and avoid duplicate entries.</p></div></div>
          <div style={s.list}>{loading ? <div style={s.empty}>Loading recent expenses...</div> : recentItems.length === 0 ? <div style={s.empty}>No expenses in the current scope.</div> : recentItems.map((item) => <button key={item.expenseId} type="button" onClick={() => edit(item)} style={s.row}><div style={s.rowTime}>{timeLabel(item.expenseDate)}</div><div style={s.rowBody}><div style={s.rowTop}><strong>{item.villaName}</strong><span style={badge(item.status)}>{item.status}</span></div><div style={s.rowMeta}>{item.category} | {money(item.amount)} | {item.submittedBy}</div></div></button>)}</div>
        </section>

        <section style={s.card}>
          <div style={s.cardHead}><div><h2 style={s.cardTitle}>Pending / Needs Review</h2><p style={s.cardCopy}>Missing receipt, high amount, rejected, or still under review.</p></div></div>
          <div style={s.list}>{loading ? <div style={s.empty}>Loading review queue...</div> : pendingItems.length === 0 ? <div style={s.empty}>No flagged expenses right now.</div> : pendingItems.map((item) => <div key={item.expenseId} style={s.pending}><div><div style={s.rowTop}><strong>{item.villaName}</strong><span style={badge(item.status)}>{item.status}</span></div><div style={s.rowMeta}>{item.category} | {money(item.amount)}</div><div style={s.reason}>{item.flaggedReason || 'Needs action'}</div></div><button type="button" onClick={() => edit(item)} style={s.inline}>Open</button></div>)}</div>
        </section>
      </div>

      <section style={s.card}>
        <div style={s.cardHead}><div><h2 style={s.cardTitle}>Expense History</h2><p style={s.cardCopy}>Search, review, and reopen accessible expense records.</p></div><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search villa, category, vendor, note..." style={s.search} /></div>
        <div style={s.table}><div style={s.head}><span>Date</span><span>Villa</span><span>Category</span><span>Amount</span><span>Vendor</span><span>Submitted by</span><span>Status</span><span>Receipt</span><span>Notes</span></div>{loading ? <div style={s.empty}>Loading expense history...</div> : filteredItems.length === 0 ? <div style={s.empty}>No records in this scope.</div> : filteredItems.map((item) => <button key={item.expenseId} type="button" onClick={() => edit(item)} style={s.tr}><span>{dateLabel(item.expenseDate)}</span><span>{item.villaName}</span><span>{item.category}</span><span>{money(item.amount)}</span><span>{item.vendor || 'N/A'}</span><span>{item.submittedBy}</span><span><span style={badge(item.status)}>{item.status}</span></span><span>{item.receiptName || item.receiptDataUrl ? 'Attached' : 'Missing'}</span><span>{item.note || item.flaggedReason || 'N/A'}</span></button>)}</div>
      </section>
    </div>
  )
}

function badge(status: StaffExpenseStatus) {
  return { display: 'inline-flex', padding: '5px 10px', borderRadius: 999, fontSize: 11, background: status === 'Approved' ? 'rgba(22,163,74,0.18)' : status === 'Rejected' ? 'rgba(220,38,38,0.18)' : status === 'Needs Review' ? 'rgba(245,158,11,0.18)' : 'rgba(59,130,246,0.16)', color: status === 'Approved' ? '#86efac' : status === 'Rejected' ? '#fca5a5' : status === 'Needs Review' ? '#fcd34d' : '#93c5fd' }
}

const s = {
  page: { flex: 1, padding: 24, background: 'linear-gradient(180deg, #081120 0%, #0f172a 56%, #132237 100%)', color: '#f8fafc' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' as const, marginBottom: 20 },
  title: { margin: 0, fontSize: 34, letterSpacing: '-0.04em' }, subtitle: { margin: '6px 0 0 0', color: '#94a3b8', fontSize: 15 },
  filters: { display: 'flex', gap: 10, flexWrap: 'wrap' as const },
  select: { padding: '10px 14px', borderRadius: 14, border: '1px solid rgba(148,163,184,0.14)', background: 'rgba(15,23,42,0.9)', color: '#fff', minWidth: 132 },
  warning: { marginBottom: 18, padding: '16px 18px', borderRadius: 18, background: 'rgba(127,29,29,0.22)', border: '1px solid rgba(248,113,113,0.24)' }, warningCopy: { marginTop: 6, color: '#fecaca' },
  card: { padding: 22, borderRadius: 24, background: 'linear-gradient(180deg, rgba(15,23,42,0.92), rgba(30,41,59,0.78))', border: '1px solid rgba(148,163,184,0.12)', boxShadow: '0 20px 48px rgba(2,6,23,0.24)', marginBottom: 20 },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' as const, marginBottom: 16 },
  cardTitle: { margin: 0, fontSize: 22 }, cardCopy: { margin: '4px 0 0 0', color: '#94a3b8', fontSize: 14, lineHeight: 1.6 },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 14 },
  input: { padding: '13px 14px', borderRadius: 14, border: '1px solid rgba(148,163,184,0.12)', background: 'rgba(8,15,28,0.9)', color: '#fff', fontSize: 15 },
  textarea: { width: '100%', padding: '13px 14px', borderRadius: 14, border: '1px solid rgba(148,163,184,0.12)', background: 'rgba(8,15,28,0.9)', color: '#fff', fontSize: 15, resize: 'vertical' as const },
  formFoot: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' as const, marginTop: 16 },
  receipt: { color: '#94a3b8', fontSize: 13 }, actions: { display: 'flex', gap: 10, flexWrap: 'wrap' as const },
  primary: { padding: '12px 18px', borderRadius: 14, border: '1px solid rgba(34,197,94,0.35)', background: 'linear-gradient(135deg, #18c29c, #0ea5e9)', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  secondary: { padding: '12px 18px', borderRadius: 14, border: '1px solid rgba(148,163,184,0.16)', background: 'rgba(15,23,42,0.84)', color: '#fff', fontWeight: 600, cursor: 'pointer' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18, marginBottom: 20 },
  list: { display: 'grid', gap: 10 },
  row: { display: 'grid', gridTemplateColumns: '72px 1fr', gap: 12, alignItems: 'center', padding: '12px 14px', borderRadius: 16, background: 'rgba(8,15,28,0.84)', border: '1px solid rgba(148,163,184,0.10)', color: '#fff', textAlign: 'left' as const, cursor: 'pointer' },
  rowTime: { fontSize: 14, fontWeight: 700, color: '#7dd3fc' }, rowBody: { display: 'grid', gap: 6 },
  rowTop: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' as const }, rowMeta: { color: '#94a3b8', fontSize: 13 },
  pending: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: 14, borderRadius: 16, background: 'rgba(8,15,28,0.84)', border: '1px solid rgba(248,113,113,0.14)' },
  reason: { color: '#fda4af', fontSize: 13, marginTop: 6 }, inline: { padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(148,163,184,0.14)', background: 'rgba(15,23,42,0.88)', color: '#fff', cursor: 'pointer' },
  search: { minWidth: 260, padding: '12px 14px', borderRadius: 14, border: '1px solid rgba(148,163,184,0.12)', background: 'rgba(8,15,28,0.9)', color: '#fff' },
  table: { display: 'grid', gap: 1, borderRadius: 18, overflow: 'hidden', background: 'rgba(148,163,184,0.10)' },
  head: { display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr 1fr 1.1fr 1fr 1fr 0.8fr 1.3fr', gap: 12, padding: '14px 16px', background: 'rgba(15,23,42,0.96)', fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: '#94a3b8' },
  tr: { display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr 1fr 1.1fr 1fr 1fr 0.8fr 1.3fr', gap: 12, padding: '14px 16px', background: 'rgba(8,15,28,0.92)', color: '#fff', textAlign: 'left' as const, border: 'none', cursor: 'pointer' },
  empty: { padding: 20, borderRadius: 16, background: 'rgba(8,15,28,0.72)', color: '#94a3b8' },
}
