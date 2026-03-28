import { NextRequest } from 'next/server'
import {
  EXPENSE_SELECT,
  EXPENSE_SUBMISSION_SELECT,
  INVESTOR_INVOICE_SELECT,
  VILLA_SELECT,
} from '@/lib/dbSelects'
import {
  buildInvoiceBuckets,
  buildInvoiceSummary,
  getInvoiceDueDate,
  getInvoiceNumber,
  normalizeInvoiceLineItems,
} from '@/lib/invoices'
import { supabase } from '@/lib/supabase'
import type {
  ExpenseRecord,
  ExpenseSubmissionRecord,
  InvestorInvoiceRecord,
  VillaRecord,
} from '@/lib/types'

type SyncAction = 'sync' | 'create'

function isMissingTable(message?: string | null) {
  const value = message?.toLowerCase() || ''
  return (
    value.includes('does not exist')
    || value.includes('invoice_configs')
    || value.includes('investor_invoices')
    || value.includes('investor_invoice_items')
  )
}

async function createInvoiceRecord(params: {
  lineItems: ReturnType<typeof normalizeInvoiceLineItems>
  threshold: number
  creationMode: 'auto' | 'manual'
  createdByUserId: string | null
  createdByName: string
  forced: boolean
  existingInvoices: InvestorInvoiceRecord[]
}) {
  const { lineItems, threshold, creationMode, createdByName, createdByUserId, forced, existingInvoices } = params
  const summary = buildInvoiceSummary(lineItems)
  const villaName = lineItems[0]?.villaName || 'Unknown Villa'
  const villaId = lineItems[0]?.villaId || null
  const sequence =
    existingInvoices.filter((invoice) => invoice.villa_id === villaId).length + 1

  const invoicePayload = {
    invoice_number: getInvoiceNumber(villaName, summary.firstDate, sequence),
    villa_id: villaId,
    villa_name: villaName,
    period_key: summary.periodKey,
    period_label: summary.periodLabel,
    covered_range_label: summary.coveredRangeLabel,
    created_at: new Date().toISOString(),
    due_date: getInvoiceDueDate(summary.firstDate),
    total_amount: summary.totalAmount,
    ready_amount: summary.readyAmount,
    review_amount: summary.reviewAmount,
    workflow_status: summary.status,
    payment_status: 'Unpaid',
    creation_mode: creationMode,
    created_by_user_id: createdByUserId,
    created_by_name: createdByName,
    threshold_applied: threshold,
    forced,
  }

  const invoiceInsert = await supabase.from('investor_invoices').insert(invoicePayload).select(INVESTOR_INVOICE_SELECT).single()
  if (invoiceInsert.error) {
    return { error: invoiceInsert.error.message, invoice: null }
  }

  const invoiceId = (invoiceInsert.data as InvestorInvoiceRecord).id
  const itemPayloads = lineItems.map((item) => ({
    invoice_id: invoiceId,
    line_item_key: item.lineItemKey,
    expense_id: item.expenseId,
    submission_id: item.submissionId,
    villa_id: item.villaId,
    villa_name: item.villaName,
    expense_date: item.date,
    category: item.category,
    amount: item.amount,
    vendor: item.vendor,
    note: item.note,
    submitted_by: item.submittedBy,
    expense_status: item.status,
    receipt_name: item.receiptName,
    receipt_data_url: item.receiptDataUrl,
  }))

  const itemInsert = await supabase.from('investor_invoice_items').insert(itemPayloads).select('id')
  if (itemInsert.error) {
    return { error: itemInsert.error.message, invoice: null }
  }

  return { error: null, invoice: invoiceInsert.data as InvestorInvoiceRecord }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: SyncAction
      lineItemKeys?: string[]
      createdByUserId?: string | null
      createdByName?: string
    }

    const action = body.action || 'sync'
    const [
      configResult,
      expensesResult,
      submissionsResult,
      villasResult,
      invoiceItemsResult,
      invoicesResult,
    ] = await Promise.all([
      supabase.from('invoice_configs').select('id, minimum_amount').eq('id', 'default').maybeSingle(),
      supabase.from('expenses').select(EXPENSE_SELECT).order('date', { ascending: true }),
      supabase.from('expense_submissions').select(EXPENSE_SUBMISSION_SELECT).order('expense_date', { ascending: true }),
      supabase.from('villas').select(VILLA_SELECT).order('name'),
      supabase.from('investor_invoice_items').select('line_item_key'),
      supabase.from('investor_invoices').select(INVESTOR_INVOICE_SELECT).order('created_at', { ascending: true }),
    ])

    const setupError =
      configResult.error?.message
      || invoiceItemsResult.error?.message
      || invoicesResult.error?.message

    if (isMissingTable(setupError)) {
      return Response.json(
        {
          ok: false,
          missingSchema: true,
          message: 'The invoice tables are not available yet. Run supabase/invoices_schema.sql in the Supabase SQL editor first.',
        },
        { status: 400 }
      )
    }

    const threshold = Number(configResult.data?.minimum_amount ?? 10_000_000)
    const expenses = ((expensesResult.data as ExpenseRecord[]) || [])
    const submissions = ((submissionsResult.data as ExpenseSubmissionRecord[]) || [])
    const villas = ((villasResult.data as VillaRecord[]) || [])
    const existingInvoices = ((invoicesResult.data as InvestorInvoiceRecord[]) || [])
    const usedLineItemKeys = new Set(((invoiceItemsResult.data as Array<{ line_item_key: string }>) || []).map((item) => item.line_item_key))
    const lineItems = normalizeInvoiceLineItems(expenses, submissions, villas)

    if (action === 'create') {
      const selectedLineItems = lineItems.filter(
        (item) => body.lineItemKeys?.includes(item.lineItemKey) && !usedLineItemKeys.has(item.lineItemKey)
      )

      if (!selectedLineItems.length) {
        return Response.json({ ok: false, message: 'No eligible line items were found for manual invoice creation.' }, { status: 400 })
      }

      const created = await createInvoiceRecord({
        lineItems: selectedLineItems,
        threshold,
        creationMode: 'manual',
        createdByUserId: body.createdByUserId || null,
        createdByName: body.createdByName || 'Manual issue',
        forced: selectedLineItems.reduce((sum, item) => sum + item.amount, 0) < threshold,
        existingInvoices,
      })

      if (created.error) {
        return Response.json({ ok: false, message: created.error }, { status: 400 })
      }

      return Response.json({ ok: true, createdCount: 1, invoiceId: created.invoice?.id })
    }

    const { readyBuckets } = buildInvoiceBuckets(lineItems, threshold, usedLineItemKeys)
    let createdCount = 0
    let latestInvoices = [...existingInvoices]

    for (const bucket of readyBuckets) {
      const created = await createInvoiceRecord({
        lineItems: bucket.lineItems,
        threshold,
        creationMode: 'auto',
        createdByUserId: null,
        createdByName: 'System threshold',
        forced: false,
        existingInvoices: latestInvoices,
      })

      if (!created.error && created.invoice) {
        latestInvoices = [...latestInvoices, created.invoice]
        createdCount += 1
      }
    }

    return Response.json({ ok: true, createdCount })
  } catch (error) {
    return Response.json({ ok: false, message: String(error) }, { status: 500 })
  }
}
