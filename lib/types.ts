export type VillaRecord = {
  id: string
  name: string
}

export type AppRole = 'admin' | 'staff' | 'investor'

export type AppUser = {
  id: string
  name: string
  role: AppRole
  assignedVillaIds: string[]
}

export type BookingRecord = {
  id: string
  guest_name: string
  check_in: string
  check_out: string
  price_per_night: number | null
  villa_id: string | null
  source?: string | null
  status?: string | null
  notes?: string | null
}

export type ExpenseCategory = 'cleaning' | 'maintenance' | 'staff' | 'utilities' | string

export type StaffExpenseCategory =
  | 'Cleaning'
  | 'Maintenance'
  | 'Utilities'
  | 'Supplies'
  | 'Staff'
  | 'Transport'
  | 'Other'

export type StaffExpenseStatus = 'Draft' | 'Submitted' | 'Needs Review' | 'Approved' | 'Rejected'

export type ExpenseRecord = {
  id: string
  villa_id: string | null
  amount: number | string | null
  date: string | null
  category: ExpenseCategory | null
  note: string | null
  vendor?: string | null
}

export type ManagementFeeType = 'none' | 'percentage' | 'fixed'

export type ManagementFeeConfigRecord = {
  villa_id: string
  fee_type: string
  percentage_rate: number | string | null
  fixed_amount: number | string | null
  updated_by_user_id: string | null
  updated_by_name: string | null
  created_at?: string | null
  updated_at?: string | null
}

export type ExpenseSubmissionRecord = {
  id: string
  expense_id: string
  villa_id: string | null
  expense_date: string
  category: string
  amount: number | string
  vendor: string | null
  note: string | null
  submitted_by: string
  status: string
  receipt_name: string | null
  receipt_data_url: string | null
  flagged_reason: string | null
  created_at?: string | null
  updated_at?: string | null
}

export type InvestorInvoiceStatus = 'Ready' | 'Pending Review' | 'Draft'
export type InvestorInvoicePaymentStatus = 'Unpaid' | 'Paid'

export type InvestorInvoiceLineItem = {
  lineItemKey: string
  expenseId: string
  submissionId: string | null
  villaId: string | null
  villaName: string
  date: string
  category: string
  amount: number
  vendor: string
  note: string
  submittedBy: string
  status: string
  receiptName: string | null
  receiptDataUrl: string | null
}

export type InvestorInvoice = {
  id: string
  invoiceNumber: string
  villaId: string | null
  villaName: string
  periodKey: string
  periodLabel: string
  createdAt: string
  dueDate: string
  totalAmount: number
  lineItems: InvestorInvoiceLineItem[]
  status: InvestorInvoiceStatus
  paymentStatus: InvestorInvoicePaymentStatus
  readyAmount: number
  reviewAmount: number
  creationMode: 'auto' | 'manual'
  createdByName: string
  thresholdApplied: number
  lineItemKeys: string[]
  coveredRangeLabel: string
}

export type InvoiceThresholdConfig = {
  minimumAmount: number
}

export type InvoiceConfigRecord = {
  id: string
  minimum_amount: number | string
  updated_by_user_id: string | null
  updated_by_name: string | null
  created_at?: string | null
  updated_at?: string | null
}

export type InvoiceCreationRecord = {
  id: string
  villaId: string | null
  lineItemKeys: string[]
  createdAt: string
  createdByUserId: string
  createdByName: string
  forced: boolean
  thresholdAtCreation: number
}

export type PendingInvoiceBucket = {
  id: string
  villaId: string | null
  villaName: string
  totalAmount: number
  readyAmount: number
  reviewAmount: number
  threshold: number
  amountToThreshold: number
  firstDate: string
  lastDate: string
  coveredRangeLabel: string
  lineItems: InvestorInvoiceLineItem[]
}

export type InvestorInvoiceRecord = {
  id: string
  invoice_number: string
  villa_id: string | null
  villa_name: string
  period_key: string
  period_label: string
  covered_range_label: string
  created_at: string
  due_date: string
  total_amount: number | string
  ready_amount: number | string
  review_amount: number | string
  workflow_status: string
  payment_status: string
  paid_at: string | null
  creation_mode: string
  created_by_user_id: string | null
  created_by_name: string
  threshold_applied: number | string
  forced: boolean | null
}

export type InvestorInvoiceItemRecord = {
  id: string
  invoice_id: string
  line_item_key: string
  expense_id: string
  submission_id: string | null
  villa_id: string | null
  villa_name: string
  expense_date: string
  category: string
  amount: number | string
  vendor: string | null
  note: string | null
  submitted_by: string
  expense_status: string
  receipt_name: string | null
  receipt_data_url: string | null
  created_at?: string | null
}

export type StaffExpenseItem = {
  id: string
  expenseId: string
  villaId: string | null
  villaName: string
  expenseDate: string
  amount: number
  category: StaffExpenseCategory
  vendor: string
  note: string
  submittedBy: string
  status: StaffExpenseStatus
  receiptName: string | null
  receiptDataUrl: string | null
  flaggedReason: string | null
  createdAt: string
  updatedAt: string
  isLegacy: boolean
}

export type RevenueExpensePoint = {
  month: string
  revenue: number
  expenses: number
  profit?: number
  cleaning?: number
  maintenance?: number
  utilities?: number
  staff?: number
  supplies?: number
  transport?: number
  other?: number
  smoothedExpenses?: number
  monthKey?: string
}

export type ChartSeriesKey = 'revenue' | 'expenses' | 'smoothedExpenses'

export type CalendarDay = {
  date: string
  bookings: BookingRecord[]
}

export type AlertItem = {
  type: 'warning' | 'critical'
  message: string
  villa?: string
  category?: string
}

export type VillaPerformanceRow = {
  id: string
  name: string
  expenses: number
  bookings: number
  nights: number
  revenue: number
  expensePerNight: number
  expensePerBooking: number
  status: 'Critical' | 'High' | 'OK'
}

export type InboxPlatform = 'Airbnb' | 'Booking.com' | 'Direct'
export type InboxThreadStatus = 'Needs reply' | 'Waiting' | 'Resolved'
export type InboxTag = 'check-in' | 'pricing' | 'complaint' | 'general'
export type InboxMessageSender = 'guest' | 'host'

export type MessageThreadRecord = {
  id: string
  booking_id: string | null
  villa_id: string | null
  guest_name: string
  platform: string | null
  status: string | null
  tag: string | null
  notes: string | null
  unread: boolean | null
  guest_history: number | null
  last_message_at: string | null
  created_at?: string | null
  updated_at?: string | null
}

export type MessageRecord = {
  id: string
  thread_id: string
  sender: string
  body: string
  sent_at: string
  created_at?: string | null
}

export type StaffDateFilter = 'today' | 'tomorrow' | 'week'
export type StaffStatusFilter = 'all' | 'urgent' | 'needs_action'
export type StaffTaskType =
  | 'Check-in'
  | 'Check-out'
  | 'Cleaning'
  | 'Maintenance'
  | 'Guest request'
  | 'Inspection'
  | 'Follow-up'
export type StaffTaskStatus = 'To do' | 'In progress' | 'Done' | 'Blocked'
export type StaffIssueStatus = 'Open' | 'Investigating' | 'Waiting' | 'Resolved'
export type StaffSeverity = 'Critical' | 'Warning' | 'Normal'
export type VillaOpsStatus =
  | 'Occupied'
  | 'Vacant'
  | 'Cleaning in progress'
  | 'Ready'
  | 'Maintenance'
  | 'Issue flagged'

export type StaffTask = {
  id: string
  recordId?: string
  externalKey?: string
  time: string
  dueAt: string
  type: StaffTaskType
  villaId: string
  villaName: string
  description: string
  priority: StaffSeverity
  status: StaffTaskStatus
  assignee: string
  note: string
  bookingId?: string | null
  threadId?: string | null
  expenseId?: string | null
  source?: 'booking' | 'thread' | 'expense' | 'manual'
}

export type StaffIssue = {
  id: string
  recordId?: string
  externalKey?: string
  severity: StaffSeverity
  villaId: string
  villaName: string
  title: string
  summary: string
  openedAt: string
  assignee: string
  status: StaffIssueStatus
  source: 'maintenance' | 'guest complaint' | 'delayed cleaning' | 'missing supply' | 'access problem' | 'urgent follow-up'
  note?: string
  bookingId?: string | null
  threadId?: string | null
  expenseId?: string | null
}

export type StaffVillaCard = {
  id: string
  name: string
  status: VillaOpsStatus
  todayEvents: number
  currentGuest: string
  nextGuest: string
  issueCount: number
  unreadMessages: number
  cleaningState: string
}

export type StaffCalendarPreviewRow = {
  villaId: string
  villaName: string
  days: Array<{
    date: string
    label: string
    state: 'booked' | 'empty' | 'turnover' | 'issue'
  }>
}

export type StaffTaskRecord = {
  id: string
  external_key: string
  villa_id: string | null
  booking_id: string | null
  thread_id: string | null
  expense_id: string | null
  task_type: string
  description: string
  due_at: string
  priority: string
  status: string
  assignee: string | null
  note: string | null
  source: string | null
  auto_generated: boolean | null
  created_at?: string | null
  updated_at?: string | null
}

export type StaffIssueRecord = {
  id: string
  external_key: string
  villa_id: string | null
  booking_id: string | null
  thread_id: string | null
  expense_id: string | null
  severity: string
  title: string
  summary: string
  opened_at: string
  assignee: string | null
  status: string
  source: string | null
  note: string | null
  auto_generated: boolean | null
  created_at?: string | null
  updated_at?: string | null
}
