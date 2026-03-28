'use client'

import { useEffect, useMemo, useState } from 'react'
import { canAccessInvoices, filterExpensesForUser, filterVillasForUser } from '@/lib/access'
import { useRole } from '@/components/auth/RoleProvider'
import {
  EXPENSE_SELECT,
  EXPENSE_SUBMISSION_SELECT,
  INVOICE_CONFIG_SELECT,
  INVESTOR_INVOICE_ITEM_SELECT,
  INVESTOR_INVOICE_SELECT,
  VILLA_SELECT,
} from '@/lib/dbSelects'
import { buildInvoiceBuckets, hydrateInvestorInvoices, normalizeInvoiceLineItems } from '@/lib/invoices'
import { supabase } from '@/lib/supabase'
import type {
  ExpenseRecord,
  ExpenseSubmissionRecord,
  InvoiceConfigRecord,
  InvestorInvoice,
  InvestorInvoiceItemRecord,
  InvestorInvoicePaymentStatus,
  InvestorInvoiceRecord,
  InvestorInvoiceStatus,
  PendingInvoiceBucket,
  VillaRecord,
} from '@/lib/types'

type InvoiceFilter = 'all' | InvestorInvoiceStatus
type PaymentFilter = 'all' | InvestorInvoicePaymentStatus

const DEFAULT_THRESHOLD = 10_000_000

const money = (value: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value)

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function toneForWorkflow(status: InvestorInvoiceStatus) {
  if (status === 'Ready') return { color: '#86efac', bg: 'rgba(22,163,74,0.16)', border: '1px solid rgba(22,163,74,0.24)' }
  if (status === 'Pending Review') {
    return { color: '#fcd34d', bg: 'rgba(245,158,11,0.16)', border: '1px solid rgba(245,158,11,0.24)' }
  }
  return { color: '#cbd5e1', bg: 'rgba(148,163,184,0.14)', border: '1px solid rgba(148,163,184,0.22)' }
}

function toneForPayment(status: InvestorInvoicePaymentStatus) {
  if (status === 'Paid') return { color: '#86efac', bg: 'rgba(22,163,74,0.16)', border: '1px solid rgba(22,163,74,0.24)' }
  return { color: '#fcd34d', bg: 'rgba(245,158,11,0.16)', border: '1px solid rgba(245,158,11,0.24)' }
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function buildInvoiceHtml(invoice: InvestorInvoice, printable = false) {
  const rows = invoice.lineItems
    .map(
      (item) => `
      <tr>
        <td>${item.date}</td>
        <td>${item.category}</td>
        <td>${item.vendor}</td>
        <td>${item.submittedBy}</td>
        <td>${item.status}</td>
        <td>${item.receiptName || item.receiptDataUrl ? 'Attached' : 'Missing'}</td>
        <td style="text-align:right">${money(item.amount)}</td>
      </tr>`
    )
    .join('')

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>${invoice.invoiceNumber}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; color: #0f172a; background: #f8fafc; }
        .hero { display:flex; justify-content:space-between; gap:24px; margin-bottom:24px; border-bottom:1px solid #e2e8f0; padding-bottom:20px; }
        .brand { font-size: 12px; letter-spacing:.16em; text-transform:uppercase; color:#b45309; font-weight:700; margin-bottom:10px; }
        .summary { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin-bottom:24px; }
        .card { border:1px solid #cbd5e1; border-radius:14px; padding:16px; background:white; }
        .label { font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:#64748b; margin-bottom:8px; }
        .value { font-size:19px; font-weight:700; }
        table { width:100%; border-collapse:collapse; }
        th, td { border-bottom:1px solid #e2e8f0; padding:12px 10px; font-size:14px; text-align:left; }
        .print-note { margin-bottom: 18px; padding: 14px 16px; border-radius: 12px; background: #fff7ed; border: 1px solid #fdba74; color: #9a3412; }
        @media print {
          body { padding: 16px; background: white; }
          .print-note { display: none; }
        }
      </style>
      ${printable ? `<script>window.addEventListener('load', function () { setTimeout(function () { try { window.focus(); window.print(); } catch (error) {} }, 220); });</script>` : ''}
    </head>
    <body>
      ${printable ? '<div class="print-note">Use the browser print dialog and choose "Save as PDF" to download this invoice as a PDF.</div>' : ''}
      <div class="hero">
        <div>
          <div class="brand">Coralis Invoices</div>
          <h1>${invoice.invoiceNumber}</h1>
          <div>${invoice.villaName} | ${invoice.coveredRangeLabel}</div>
          <div>Created by ${invoice.createdByName}</div>
        </div>
        <div>
          <div>Invoice Date: ${formatDate(invoice.createdAt)}</div>
          <div>Due Date: ${formatDate(invoice.dueDate)}</div>
          <div>Payment: ${invoice.paymentStatus}</div>
        </div>
      </div>
      <div class="summary">
        <div class="card"><div class="label">Total</div><div class="value">${money(invoice.totalAmount)}</div></div>
        <div class="card"><div class="label">Approved</div><div class="value">${money(invoice.readyAmount)}</div></div>
        <div class="card"><div class="label">Needs Review</div><div class="value">${money(invoice.reviewAmount)}</div></div>
        <div class="card"><div class="label">Threshold</div><div class="value">${money(invoice.thresholdApplied)}</div></div>
      </div>
      <table>
        <thead>
          <tr><th>Date</th><th>Category</th><th>Vendor</th><th>Submitted By</th><th>Status</th><th>Receipt</th><th style="text-align:right">Amount</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </body>
  </html>`
}

function buildInvoiceCsv(invoice: InvestorInvoice) {
  const rows = [
    ['Invoice Number', invoice.invoiceNumber],
    ['Villa', invoice.villaName],
    ['Coverage', invoice.coveredRangeLabel],
    ['Payment', invoice.paymentStatus],
    ['Created By', invoice.createdByName],
    ['Threshold', String(invoice.thresholdApplied)],
    [],
    ['Date', 'Category', 'Vendor', 'Submitted By', 'Status', 'Receipt', 'Amount', 'Note'],
    ...invoice.lineItems.map((item) => [
      item.date,
      item.category,
      item.vendor,
      item.submittedBy,
      item.status,
      item.receiptName || item.receiptDataUrl ? 'Attached' : 'Missing',
      String(item.amount),
      item.note,
    ]),
  ]

  return rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
}

function buildSummaryCsv(invoices: InvestorInvoice[]) {
  const rows = [
    ['Invoice Number', 'Villa', 'Coverage', 'Workflow', 'Payment', 'Total', 'Mode', 'Created By'],
    ...invoices.map((invoice) => [
      invoice.invoiceNumber,
      invoice.villaName,
      invoice.coveredRangeLabel,
      invoice.status,
      invoice.paymentStatus,
      String(invoice.totalAmount),
      invoice.creationMode,
      invoice.createdByName,
    ]),
  ]

  return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
}

function printInvoiceHtml(html: string) {
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.setAttribute('aria-hidden', 'true')
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument || iframe.contentWindow?.document
  if (!doc) {
    iframe.remove()
    return false
  }

  doc.open()
  doc.write(html)
  doc.close()

  window.setTimeout(() => {
    try {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
    } catch {
      // ignore and let popup fallback handle it
    }

    window.setTimeout(() => iframe.remove(), 1500)
  }, 240)

  return true
}

function isMissingInvoiceSchema(message?: string | null) {
  const value = message?.toLowerCase() || ''
  return (
    value.includes('does not exist')
    || value.includes('invoice_configs')
    || value.includes('investor_invoices')
    || value.includes('investor_invoice_items')
  )
}

export default function InvoicesPage() {
  const { currentUser } = useRole()
  const [villas, setVillas] = useState<VillaRecord[]>([])
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([])
  const [submissions, setSubmissions] = useState<ExpenseSubmissionRecord[]>([])
  const [invoiceConfig, setInvoiceConfig] = useState<InvoiceConfigRecord | null>(null)
  const [invoiceRecords, setInvoiceRecords] = useState<InvestorInvoiceRecord[]>([])
  const [invoiceItemRecords, setInvoiceItemRecords] = useState<InvestorInvoiceItemRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [setupMessage, setSetupMessage] = useState('')
  const [villaFilter, setVillaFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<InvoiceFilter>('all')
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all')
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('')
  const [draftThreshold, setDraftThreshold] = useState(String(DEFAULT_THRESHOLD))

  const canCreateInvoices = currentUser.role === 'admin' || currentUser.role === 'staff'
  const canSetThreshold = currentUser.role === 'admin'
  const canManagePayments = currentUser.role !== 'investor'

  async function loadData(runSync = true) {
    setLoading(true)
    setSetupMessage('')

    if (runSync) {
      try {
        const syncResponse = await fetch('/api/sync-invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'sync' }),
        })
        const syncJson = (await syncResponse.json().catch(() => null)) as { missingSchema?: boolean; message?: string } | null
        if (!syncResponse.ok && syncJson?.missingSchema) {
          setSetupMessage(syncJson.message || 'Run supabase/invoices_schema.sql in the Supabase SQL editor first.')
        }
      } catch {
        // ignore sync errors here and let the page data calls show setup state if needed
      }
    }

    const [villasResult, expensesResult, submissionsResult, configResult, invoicesResult, invoiceItemsResult] = await Promise.all([
      supabase.from('villas').select(VILLA_SELECT).order('name'),
      supabase.from('expenses').select(EXPENSE_SELECT).order('date', { ascending: false }),
      supabase.from('expense_submissions').select(EXPENSE_SUBMISSION_SELECT).order('expense_date', { ascending: false }),
      supabase.from('invoice_configs').select(INVOICE_CONFIG_SELECT).eq('id', 'default').maybeSingle(),
      supabase.from('investor_invoices').select(INVESTOR_INVOICE_SELECT).order('created_at', { ascending: false }),
      supabase.from('investor_invoice_items').select(INVESTOR_INVOICE_ITEM_SELECT).order('expense_date', { ascending: false }),
    ])

    const setupError =
      configResult.error?.message
      || invoicesResult.error?.message
      || invoiceItemsResult.error?.message

    if (isMissingInvoiceSchema(setupError)) {
      setSetupMessage('The invoice tables are not available yet. Run supabase/invoices_schema.sql in the Supabase SQL editor first.')
      setInvoiceConfig(null)
      setInvoiceRecords([])
      setInvoiceItemRecords([])
    } else {
      setInvoiceConfig((configResult.data as InvoiceConfigRecord | null) || null)
      setInvoiceRecords((invoicesResult.data as InvestorInvoiceRecord[]) || [])
      setInvoiceItemRecords((invoiceItemsResult.data as InvestorInvoiceItemRecord[]) || [])
    }

    setVillas((villasResult.data as VillaRecord[]) || [])
    setExpenses((expensesResult.data as ExpenseRecord[]) || [])
    setSubmissions((submissionsResult.data as ExpenseSubmissionRecord[]) || [])
    setDraftThreshold(String(Number(configResult.data?.minimum_amount ?? DEFAULT_THRESHOLD)))
    setLoading(false)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [])

  const visibleVillas = useMemo(() => filterVillasForUser(villas, currentUser), [currentUser, villas])
  const visibleExpenses = useMemo(() => filterExpensesForUser(expenses, currentUser), [currentUser, expenses])
  const visibleVillaIds = useMemo(() => new Set(visibleVillas.map((villa) => villa.id)), [visibleVillas])
  const threshold = Number(invoiceConfig?.minimum_amount ?? DEFAULT_THRESHOLD)

  const invoices = useMemo(() => {
    const scopedRecords = invoiceRecords.filter((record) => !record.villa_id || visibleVillaIds.has(record.villa_id))
    const scopedItemRecords = invoiceItemRecords.filter((record) => !record.villa_id || visibleVillaIds.has(record.villa_id))
    return hydrateInvestorInvoices(scopedRecords, scopedItemRecords)
  }, [invoiceItemRecords, invoiceRecords, visibleVillaIds])

  const pendingBuckets = useMemo(() => {
    const lineItems = normalizeInvoiceLineItems(visibleExpenses, submissions, visibleVillas)
    const usedKeys = new Set(invoiceItemRecords.map((item) => item.line_item_key))
    return buildInvoiceBuckets(lineItems, threshold, usedKeys).pendingBuckets
  }, [invoiceItemRecords, submissions, threshold, visibleExpenses, visibleVillas])

  const filteredInvoices = useMemo(
    () =>
      invoices.filter((invoice) => {
        if (villaFilter !== 'all' && invoice.villaId !== villaFilter) return false
        if (statusFilter !== 'all' && invoice.status !== statusFilter) return false
        if (paymentFilter !== 'all' && invoice.paymentStatus !== paymentFilter) return false
        return true
      }),
    [invoices, paymentFilter, statusFilter, villaFilter]
  )

  const filteredPendingBuckets = useMemo(
    () => (villaFilter === 'all' ? pendingBuckets : pendingBuckets.filter((bucket) => bucket.villaId === villaFilter)),
    [pendingBuckets, villaFilter]
  )

  const selectedInvoice = filteredInvoices.find((invoice) => invoice.id === selectedInvoiceId) || filteredInvoices[0] || null
  const totalInvoiced = filteredInvoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0)
  const readyCount = filteredInvoices.filter((invoice) => invoice.status === 'Ready').length
  const pendingCount = filteredInvoices.filter((invoice) => invoice.status !== 'Ready').length
  const unpaidCount = filteredInvoices.filter((invoice) => invoice.paymentStatus === 'Unpaid').length
  const pendingAccumulation = filteredPendingBuckets.reduce((sum, bucket) => sum + bucket.totalAmount, 0)

  async function saveThreshold() {
    if (!canSetThreshold) {
      return
    }

    setBusy(true)
    const minimumAmount = Math.max(0, Number(draftThreshold) || 0)
    await supabase.from('invoice_configs').upsert({
      id: 'default',
      minimum_amount: minimumAmount,
      updated_by_user_id: currentUser.id,
      updated_by_name: currentUser.name,
      updated_at: new Date().toISOString(),
    })
    await loadData(true)
    setBusy(false)
  }

  async function markPayment(invoiceId: string, status: InvestorInvoicePaymentStatus) {
    setBusy(true)
    await supabase
      .from('investor_invoices')
      .update({
        payment_status: status,
        paid_at: status === 'Paid' ? new Date().toISOString() : null,
      })
      .eq('id', invoiceId)
    await loadData(false)
    setBusy(false)
  }

  async function createInvoice(bucket: PendingInvoiceBucket) {
    setBusy(true)
    await fetch('/api/sync-invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        lineItemKeys: bucket.lineItems.map((item) => item.lineItemKey),
        createdByUserId: currentUser.id,
        createdByName: currentUser.name,
      }),
    })
    await loadData(false)
    setBusy(false)
  }

  function openPdf(invoice: InvestorInvoice) {
    const printableHtml = buildInvoiceHtml(invoice, true)

    if (printInvoiceHtml(printableHtml)) {
      return
    }

    const popup = window.open('', '_blank', 'width=1100,height=900')
    if (!popup) {
      downloadFile(`${invoice.invoiceNumber}-print.html`, printableHtml, 'text/html;charset=utf-8')
      return
    }

    popup.document.open()
    popup.document.write(printableHtml)
    popup.document.close()
    popup.focus()
  }

  if (!canAccessInvoices(currentUser.role)) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <h1 style={styles.title}>Invoices</h1>
          <p style={styles.subtitle}>This workspace is not available for your current role.</p>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>{currentUser.role === 'investor' ? 'Investor Billing' : 'Invoice Workspace'}</div>
          <h1 style={styles.title}>Invoices</h1>
          <p style={styles.subtitle}>
            {currentUser.role === 'investor'
              ? 'View and download invoice statements generated from your villa expenses.'
              : 'Admin and staff can issue invoices. Investors can only review and download them.'}
          </p>
        </div>
        <div style={styles.filters}>
          <select value={villaFilter} onChange={(event) => setVillaFilter(event.target.value)} style={styles.select}>
            <option value="all">{currentUser.role === 'investor' ? 'My Villas' : 'All Villas'}</option>
            {visibleVillas.map((villa) => (
              <option key={villa.id} value={villa.id}>
                {villa.name}
              </option>
            ))}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as InvoiceFilter)} style={styles.select}>
            <option value="all">All Workflows</option>
            <option value="Ready">Ready</option>
            <option value="Pending Review">Pending Review</option>
            <option value="Draft">Draft</option>
          </select>
          <select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value as PaymentFilter)} style={styles.select}>
            <option value="all">All Payments</option>
            <option value="Unpaid">Unpaid</option>
            <option value="Paid">Paid</option>
          </select>
        </div>
      </div>

      {setupMessage ? <div style={styles.setupBanner}>{setupMessage}</div> : null}

      <div style={styles.kpis}>
        <div style={styles.card}><div style={styles.label}>Total Invoiced</div><div style={styles.value}>{money(totalInvoiced)}</div></div>
        <div style={styles.card}><div style={styles.label}>Ready</div><div style={styles.value}>{readyCount}</div></div>
        <div style={styles.card}><div style={styles.label}>Pending Review</div><div style={styles.value}>{pendingCount}</div></div>
        <div style={styles.card}><div style={styles.label}>Queued Below Threshold</div><div style={styles.value}>{money(pendingAccumulation)}</div></div>
      </div>

      {canCreateInvoices ? (
        <div style={styles.panel}>
          <div style={styles.panelTop}>
            <div>
              <h2 style={styles.panelTitle}>Issue Controls</h2>
              <p style={styles.panelCopy}>
                Small items stay queued until they cross the threshold. Admin can change the threshold, and staff or admin can manually issue any queued batch.
              </p>
            </div>
            <div style={styles.thresholdBox}>
              <div style={styles.label}>Minimum Threshold</div>
              {canSetThreshold ? (
                <div style={styles.inline}>
                  <input value={draftThreshold} onChange={(e) => setDraftThreshold(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" style={styles.input} />
                  <button type="button" disabled={busy} onClick={() => void saveThreshold()} style={styles.primaryButton}>Save</button>
                </div>
              ) : (
                <div style={styles.value}>{money(threshold)}</div>
              )}
            </div>
          </div>
          <div style={styles.bucketGrid}>
            {filteredPendingBuckets.length === 0 ? (
              <div style={styles.empty}>No queued invoice batches right now.</div>
            ) : (
              filteredPendingBuckets.map((bucket) => (
                <div key={bucket.id} style={styles.bucketCard}>
                  <div style={styles.bucketTop}>
                    <strong>{bucket.villaName}</strong>
                    <span style={{ ...styles.badge, ...(bucket.totalAmount >= threshold ? toneForWorkflow('Ready') : toneForWorkflow('Pending Review')) }}>
                      {bucket.totalAmount >= threshold ? 'Ready to issue' : 'Accumulating'}
                    </span>
                  </div>
                  <div style={styles.muted}>{bucket.coveredRangeLabel}</div>
                  <div style={styles.value}>{money(bucket.totalAmount)}</div>
                  <div style={styles.muted}>
                    {bucket.totalAmount >= threshold
                      ? `${bucket.lineItems.length} expense items are ready to be invoiced.`
                      : `${money(bucket.amountToThreshold)} more needed before auto-issue.`}
                  </div>
                  <button type="button" disabled={busy} onClick={() => void createInvoice(bucket)} style={styles.primaryButton}>Create Invoice Now</button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}

      <div style={styles.summaryBar}>
        <button type="button" onClick={() => downloadFile('coralis-invoice-summary.csv', buildSummaryCsv(filteredInvoices), 'text/csv;charset=utf-8')} style={styles.secondaryButton}>
          Download Summary CSV
        </button>
        <div style={styles.summaryText}>
          {canCreateInvoices ? `${filteredPendingBuckets.length} queued batches and ${unpaidCount} unpaid invoices in view.` : `${unpaidCount} unpaid invoices in your current scope.`}
        </div>
      </div>

      <div style={styles.layout}>
        <div style={styles.card}>
          <h2 style={styles.panelTitle}>Invoices</h2>
          <div style={styles.list}>
            {loading ? (
              <div style={styles.empty}>Loading invoices...</div>
            ) : filteredInvoices.length === 0 ? (
              <div style={styles.empty}>No invoices found for the current filters.</div>
            ) : (
              filteredInvoices.map((invoice) => (
                <button key={invoice.id} type="button" onClick={() => setSelectedInvoiceId(invoice.id)} style={{ ...styles.row, ...(selectedInvoice?.id === invoice.id ? styles.rowActive : {}) }}>
                  <div style={styles.bucketTop}>
                    <strong>{invoice.invoiceNumber}</strong>
                    <div style={styles.inline}>
                      <span style={{ ...styles.badge, ...toneForWorkflow(invoice.status) }}>{invoice.status}</span>
                      <span style={{ ...styles.badge, ...toneForPayment(invoice.paymentStatus) }}>{invoice.paymentStatus}</span>
                    </div>
                  </div>
                  <div style={styles.muted}>{invoice.villaName} | {invoice.coveredRangeLabel}</div>
                  <div style={styles.bucketTop}>
                    <span>{money(invoice.totalAmount)}</span>
                    <span style={styles.muted}>{invoice.creationMode === 'manual' ? `by ${invoice.createdByName}` : 'system issue'}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div style={styles.card}>
          <div style={styles.panelTop}>
            <div>
              <h2 style={styles.panelTitle}>{selectedInvoice?.invoiceNumber || 'Invoice Detail'}</h2>
              <div style={styles.muted}>{selectedInvoice ? `${selectedInvoice.villaName} | ${selectedInvoice.coveredRangeLabel}` : 'Select an invoice to inspect it.'}</div>
            </div>
            {selectedInvoice ? (
              <div style={styles.inline}>
                <button type="button" onClick={() => downloadFile(`${selectedInvoice.invoiceNumber}.html`, buildInvoiceHtml(selectedInvoice), 'text/html;charset=utf-8')} style={styles.secondaryButton}>HTML</button>
                <button type="button" onClick={() => downloadFile(`${selectedInvoice.invoiceNumber}.csv`, buildInvoiceCsv(selectedInvoice), 'text/csv;charset=utf-8')} style={styles.secondaryButton}>CSV</button>
                <button type="button" onClick={() => openPdf(selectedInvoice)} style={styles.primaryButton}>Save PDF</button>
              </div>
            ) : null}
          </div>

          {selectedInvoice ? (
            <>
              <div style={styles.detailGrid}>
                <div style={styles.metric}><div style={styles.label}>Total</div><div style={styles.metricValue}>{money(selectedInvoice.totalAmount)}</div></div>
                <div style={styles.metric}><div style={styles.label}>Invoice Date</div><div style={styles.metricValue}>{formatDate(selectedInvoice.createdAt)}</div></div>
                <div style={styles.metric}><div style={styles.label}>Due Date</div><div style={styles.metricValue}>{formatDate(selectedInvoice.dueDate)}</div></div>
                <div style={styles.metric}><div style={styles.label}>Created By</div><div style={styles.metricValue}>{selectedInvoice.createdByName}</div></div>
                <div style={styles.metric}><div style={styles.label}>Threshold</div><div style={styles.metricValue}>{money(selectedInvoice.thresholdApplied)}</div></div>
                <div style={styles.metric}><div style={styles.label}>Payment</div><div style={styles.metricValue}>{selectedInvoice.paymentStatus}</div></div>
              </div>

              <div style={styles.paymentBar}>
                <div style={styles.muted}>
                  {selectedInvoice.creationMode === 'manual'
                    ? `Issued manually by ${selectedInvoice.createdByName}.`
                    : `Issued automatically once queued expenses crossed the threshold.`}
                </div>
                {canManagePayments ? (
                  <div style={styles.inline}>
                    <button type="button" disabled={busy} onClick={() => void markPayment(selectedInvoice.id, 'Unpaid')} style={styles.secondaryButton}>Mark Unpaid</button>
                    <button type="button" disabled={busy} onClick={() => void markPayment(selectedInvoice.id, 'Paid')} style={styles.primaryButton}>Mark Paid</button>
                  </div>
                ) : null}
              </div>

              <div style={styles.table}>
                <div style={styles.tableHead}>
                  <span>Date</span><span>Category</span><span>Vendor</span><span>Submitted By</span><span>Status</span><span>Receipt</span><span>Amount</span>
                </div>
                {selectedInvoice.lineItems.map((item) => (
                  <div key={item.lineItemKey} style={styles.tableRow}>
                    <span>{item.date}</span>
                    <span>{item.category}</span>
                    <span>{item.vendor}</span>
                    <span>{item.submittedBy}</span>
                    <span>{item.status}</span>
                    <span>{item.receiptName || item.receiptDataUrl ? 'Attached' : 'Missing'}</span>
                    <span>{money(item.amount)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={styles.empty}>No invoice selected.</div>
          )}
        </div>
      </div>
    </div>
  )
}

const styles = {
  page: { flex: 1, padding: 24, background: 'linear-gradient(180deg, #081120 0%, #0f172a 56%, #132237 100%)', color: '#f8fafc' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' as const, marginBottom: 20 },
  eyebrow: { marginBottom: 8, fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#fbbf24', fontWeight: 700 },
  title: { margin: 0, fontSize: 34, letterSpacing: '-0.04em' },
  subtitle: { margin: '6px 0 0 0', color: '#94a3b8', fontSize: 15, lineHeight: 1.6, maxWidth: 760 },
  filters: { display: 'flex', gap: 10, flexWrap: 'wrap' as const },
  select: { padding: '10px 14px', borderRadius: 14, border: '1px solid rgba(148,163,184,0.14)', background: 'rgba(15,23,42,0.9)', color: '#fff', minWidth: 150 },
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16, marginBottom: 18 },
  layout: { display: 'grid', gridTemplateColumns: 'minmax(320px, 0.9fr) minmax(0, 1.1fr)', gap: 20, alignItems: 'start' },
  card: { padding: 22, borderRadius: 24, background: 'linear-gradient(180deg, rgba(15,23,42,0.92), rgba(30,41,59,0.78))', border: '1px solid rgba(148,163,184,0.12)', boxShadow: '0 20px 48px rgba(2,6,23,0.24)' },
  panel: { marginBottom: 18, padding: 22, borderRadius: 24, background: 'linear-gradient(180deg, rgba(12,20,34,0.98), rgba(19,33,53,0.92))', border: '1px solid rgba(198,169,107,0.16)', boxShadow: '0 24px 60px rgba(2,6,23,0.28)' },
  panelTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' as const, marginBottom: 16 },
  panelTitle: { margin: 0, fontSize: 22 },
  panelCopy: { margin: '6px 0 0 0', color: '#94a3b8', fontSize: 13, lineHeight: 1.5, maxWidth: 720 },
  label: { marginBottom: 8, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#94a3b8' },
  value: { fontSize: 28, fontWeight: 800, color: '#f8fafc' },
  metricValue: { fontSize: 17, fontWeight: 700, color: '#f8fafc', lineHeight: 1.45, wordBreak: 'break-word' as const },
  thresholdBox: { minWidth: 300, padding: 16, borderRadius: 18, background: 'rgba(15,23,42,0.74)', border: '1px solid rgba(148,163,184,0.12)' },
  input: { padding: '10px 14px', borderRadius: 12, border: '1px solid rgba(148,163,184,0.18)', background: 'rgba(2,6,23,0.84)', color: '#fff', minWidth: 180 },
  inline: { display: 'flex', gap: 10, flexWrap: 'wrap' as const, alignItems: 'center' },
  summaryBar: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' as const, marginBottom: 18 },
  summaryText: { color: '#94a3b8', fontSize: 13, marginLeft: 'auto' },
  bucketGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 },
  bucketCard: { padding: 18, borderRadius: 20, background: 'linear-gradient(180deg, rgba(15,23,42,0.88), rgba(15,23,42,0.7))', border: '1px solid rgba(148,163,184,0.12)', display: 'grid', gap: 10 },
  bucketTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  badge: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '6px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const },
  primaryButton: { padding: '10px 14px', borderRadius: 12, border: '1px solid rgba(251,191,36,0.28)', background: 'linear-gradient(135deg, #f59e0b, #f97316)', color: '#fff', cursor: 'pointer' },
  secondaryButton: { padding: '10px 14px', borderRadius: 12, border: '1px solid rgba(148,163,184,0.18)', background: 'rgba(15,23,42,0.88)', color: '#fff', cursor: 'pointer' },
  list: { display: 'grid', gap: 12 },
  row: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderStyle: 'solid' as const,
    borderColor: 'rgba(148,163,184,0.14)',
    background: 'rgba(15,23,42,0.72)',
    textAlign: 'left' as const,
    cursor: 'pointer',
    color: '#f8fafc',
  },
  rowActive: {
    borderColor: 'rgba(198,169,107,0.34)',
    background: 'linear-gradient(180deg, rgba(198,169,107,0.12), rgba(15,23,42,0.9))',
  },
  muted: { color: '#94a3b8', fontSize: 13, lineHeight: 1.5 },
  detailGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 18 },
  metric: { padding: 16, borderRadius: 18, background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(148,163,184,0.12)' },
  paymentBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' as const, marginBottom: 18, padding: 16, borderRadius: 18, background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(148,163,184,0.12)' },
  table: { display: 'grid', gap: 8 },
  tableHead: { display: 'grid', gridTemplateColumns: '0.9fr 0.9fr 1fr 0.9fr 0.8fr 0.8fr 0.8fr', gap: 10, padding: '0 12px', color: '#94a3b8', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' as const },
  tableRow: { display: 'grid', gridTemplateColumns: '0.9fr 0.9fr 1fr 0.9fr 0.8fr 0.8fr 0.8fr', gap: 10, padding: '14px 12px', borderRadius: 16, background: 'rgba(15,23,42,0.68)', border: '1px solid rgba(148,163,184,0.1)', fontSize: 13, alignItems: 'center' },
  empty: { padding: 18, borderRadius: 16, background: 'rgba(15,23,42,0.68)', color: '#94a3b8', border: '1px solid rgba(148,163,184,0.1)' },
  setupBanner: { marginBottom: 18, padding: 16, borderRadius: 18, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.24)', color: '#fde68a' },
}
