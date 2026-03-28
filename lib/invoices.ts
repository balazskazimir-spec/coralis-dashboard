import type {
  ExpenseRecord,
  ExpenseSubmissionRecord,
  InvestorInvoice,
  InvestorInvoiceItemRecord,
  InvestorInvoiceLineItem,
  InvestorInvoiceRecord,
  PendingInvoiceBucket,
  VillaRecord,
} from '@/lib/types'

function formatCategoryLabel(category: string) {
  return category
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function getPeriodMeta(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00`)
  const periodKey = dateValue.slice(0, 7)
  const periodLabel = Number.isNaN(date.getTime())
    ? periodKey
    : date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return { periodKey, periodLabel }
}

export function formatInvoiceRangeLabel(firstDate: string, lastDate: string) {
  const firstMeta = getPeriodMeta(firstDate)
  const lastMeta = getPeriodMeta(lastDate)
  return firstMeta.periodKey === lastMeta.periodKey ? firstMeta.periodLabel : `${firstMeta.periodLabel} - ${lastMeta.periodLabel}`
}

export function getInvoiceDueDate(referenceDate: string) {
  const date = new Date(`${referenceDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) {
    return referenceDate
  }

  const dueDate = new Date(date.getFullYear(), date.getMonth() + 1, 7)
  return dueDate.toISOString().slice(0, 10)
}

export function getInvoiceNumber(villaName: string, referenceDate: string, sequence: number) {
  const code = villaName.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase() || 'VILA'
  const stamp = referenceDate.replace(/-/g, '').slice(0, 6)
  return `CRL-${code}-${stamp}-${String(sequence).padStart(2, '0')}`
}

export function getInvoiceLineItemKey(expense: ExpenseRecord, submission?: ExpenseSubmissionRecord) {
  return submission?.id ? `submission:${submission.id}` : `expense:${expense.id}`
}

function summarizeInvoiceStatus(lineItems: InvestorInvoiceLineItem[]) {
  if (lineItems.some((item) => item.status === 'Draft')) {
    return 'Draft' as const
  }

  if (lineItems.every((item) => item.status === 'Approved')) {
    return 'Ready' as const
  }

  return 'Pending Review' as const
}

export function normalizeInvoiceLineItems(
  expenses: ExpenseRecord[],
  submissions: ExpenseSubmissionRecord[],
  villas: VillaRecord[]
) {
  const submissionByExpenseId = new Map(submissions.map((submission) => [submission.expense_id, submission]))
  const villaNameById = new Map(villas.map((villa) => [villa.id, villa.name]))

  return expenses
    .map((expense) => {
      const submission = submissionByExpenseId.get(expense.id)
      const date = submission?.expense_date || expense.date
      if (!date) {
        return null
      }

      const villaName = villaNameById.get(expense.villa_id || '') || 'Unknown Villa'

      return {
        lineItemKey: getInvoiceLineItemKey(expense, submission),
        expenseId: expense.id,
        submissionId: submission?.id || null,
        villaId: expense.villa_id,
        villaName,
        date,
        category: formatCategoryLabel(submission?.category || expense.category || 'other'),
        amount: Number(submission?.amount ?? expense.amount ?? 0),
        vendor: submission?.vendor || expense.vendor || 'Internal vendor',
        note: submission?.note || expense.note || '',
        submittedBy: submission?.submitted_by || 'System import',
        status: submission?.status || 'Approved',
        receiptName: submission?.receipt_name || null,
        receiptDataUrl: submission?.receipt_data_url || null,
      } satisfies InvestorInvoiceLineItem
    })
    .filter((item): item is InvestorInvoiceLineItem => Boolean(item))
    .sort((left, right) => {
      const villaOrder = (left.villaName || '').localeCompare(right.villaName || '')
      if (villaOrder !== 0) {
        return villaOrder
      }

      const dateOrder = left.date.localeCompare(right.date)
      if (dateOrder !== 0) {
        return dateOrder
      }

      return left.lineItemKey.localeCompare(right.lineItemKey)
    })
}

export function buildInvoiceBuckets(
  lineItems: InvestorInvoiceLineItem[],
  threshold: number,
  usedLineItemKeys: Set<string>
) {
  const grouped = new Map<string, InvestorInvoiceLineItem[]>()

  lineItems.forEach((item) => {
    if (usedLineItemKeys.has(item.lineItemKey)) {
      return
    }

    const key = item.villaId || 'unknown'
    const existing = grouped.get(key)
    if (existing) {
      existing.push(item)
    } else {
      grouped.set(key, [item])
    }
  })

  const readyBuckets: PendingInvoiceBucket[] = []
  const pendingBuckets: PendingInvoiceBucket[] = []

  grouped.forEach((villaLineItems, villaKey) => {
    let bucket: InvestorInvoiceLineItem[] = []
    let bucketTotal = 0

    villaLineItems.forEach((item) => {
      bucket.push(item)
      bucketTotal += item.amount

      if (threshold > 0 && bucketTotal < threshold) {
        return
      }

      const firstDate = bucket[0].date
      const lastDate = bucket[bucket.length - 1].date
      const readyAmount = bucket.reduce((sum, lineItem) => sum + (lineItem.status === 'Approved' ? lineItem.amount : 0), 0)

      readyBuckets.push({
        id: `READY-${villaKey}-${firstDate}-${lastDate}`,
        villaId: bucket[0].villaId,
        villaName: bucket[0].villaName,
        totalAmount: bucketTotal,
        readyAmount,
        reviewAmount: bucketTotal - readyAmount,
        threshold,
        amountToThreshold: Math.max(0, threshold - bucketTotal),
        firstDate,
        lastDate,
        coveredRangeLabel: formatInvoiceRangeLabel(firstDate, lastDate),
        lineItems: [...bucket],
      })

      bucket = []
      bucketTotal = 0
    })

    if (bucket.length > 0) {
      const firstDate = bucket[0].date
      const lastDate = bucket[bucket.length - 1].date
      const readyAmount = bucket.reduce((sum, lineItem) => sum + (lineItem.status === 'Approved' ? lineItem.amount : 0), 0)

      pendingBuckets.push({
        id: `PENDING-${villaKey}-${firstDate}-${lastDate}`,
        villaId: bucket[0].villaId,
        villaName: bucket[0].villaName,
        totalAmount: bucketTotal,
        readyAmount,
        reviewAmount: bucketTotal - readyAmount,
        threshold,
        amountToThreshold: Math.max(0, threshold - bucketTotal),
        firstDate,
        lastDate,
        coveredRangeLabel: formatInvoiceRangeLabel(firstDate, lastDate),
        lineItems: [...bucket],
      })
    }
  })

  return {
    readyBuckets: readyBuckets.sort((left, right) => left.firstDate.localeCompare(right.firstDate)),
    pendingBuckets: pendingBuckets.sort(
      (left, right) => right.lastDate.localeCompare(left.lastDate) || left.villaName.localeCompare(right.villaName)
    ),
  }
}

export function hydrateInvestorInvoices(
  invoiceRecords: InvestorInvoiceRecord[],
  itemRecords: InvestorInvoiceItemRecord[]
) {
  const itemsByInvoiceId = new Map<string, InvestorInvoiceLineItem[]>()

  itemRecords.forEach((item) => {
    const existing = itemsByInvoiceId.get(item.invoice_id)
    const normalizedItem: InvestorInvoiceLineItem = {
      lineItemKey: item.line_item_key,
      expenseId: item.expense_id,
      submissionId: item.submission_id,
      villaId: item.villa_id,
      villaName: item.villa_name,
      date: item.expense_date,
      category: item.category,
      amount: Number(item.amount ?? 0),
      vendor: item.vendor || 'Internal vendor',
      note: item.note || '',
      submittedBy: item.submitted_by,
      status: item.expense_status,
      receiptName: item.receipt_name,
      receiptDataUrl: item.receipt_data_url,
    }

    if (existing) {
      existing.push(normalizedItem)
    } else {
      itemsByInvoiceId.set(item.invoice_id, [normalizedItem])
    }
  })

  return invoiceRecords
    .map((record) => {
      const lineItems = (itemsByInvoiceId.get(record.id) || []).sort((left, right) => left.date.localeCompare(right.date))
      return {
        id: record.id,
        invoiceNumber: record.invoice_number,
        villaId: record.villa_id,
        villaName: record.villa_name,
        periodKey: record.period_key,
        periodLabel: record.period_label,
        createdAt: record.created_at.slice(0, 10),
        dueDate: record.due_date,
        totalAmount: Number(record.total_amount ?? 0),
        lineItems,
        status: summarizeInvoiceStatus(lineItems.length ? lineItems : []),
        paymentStatus: record.payment_status === 'Paid' ? 'Paid' : 'Unpaid',
        readyAmount: Number(record.ready_amount ?? 0),
        reviewAmount: Number(record.review_amount ?? 0),
        creationMode: record.creation_mode === 'manual' ? 'manual' : 'auto',
        createdByName: record.created_by_name || 'System threshold',
        thresholdApplied: Number(record.threshold_applied ?? 0),
        lineItemKeys: lineItems.map((item) => item.lineItemKey),
        coveredRangeLabel: record.covered_range_label,
      } satisfies InvestorInvoice
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.villaName.localeCompare(right.villaName))
}

export function buildInvoiceSummary(lineItems: InvestorInvoiceLineItem[]) {
  const sorted = [...lineItems].sort((left, right) => left.date.localeCompare(right.date))
  const firstDate = sorted[0]?.date || new Date().toISOString().slice(0, 10)
  const lastDate = sorted[sorted.length - 1]?.date || firstDate
  const totalAmount = sorted.reduce((sum, item) => sum + item.amount, 0)
  const readyAmount = sorted.reduce((sum, item) => sum + (item.status === 'Approved' ? item.amount : 0), 0)
  const periodMeta = getPeriodMeta(firstDate)

  return {
    firstDate,
    lastDate,
    coveredRangeLabel: formatInvoiceRangeLabel(firstDate, lastDate),
    periodKey: periodMeta.periodKey,
    periodLabel: periodMeta.periodLabel,
    totalAmount,
    readyAmount,
    reviewAmount: totalAmount - readyAmount,
    status: summarizeInvoiceStatus(sorted),
  }
}
