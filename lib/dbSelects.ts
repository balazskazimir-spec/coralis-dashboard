export const VILLA_SELECT = 'id, name'

export const BOOKING_SELECT =
  'id, guest_name, check_in, check_out, price_per_night, villa_id'

export const EXPENSE_SELECT =
  'id, villa_id, amount, date, category, note'

export const MESSAGE_THREAD_SELECT =
  'id, booking_id, villa_id, guest_name, platform, status, tag, notes, unread, guest_history, last_message_at, created_at, updated_at'

export const MESSAGE_SELECT =
  'id, thread_id, sender, body, sent_at, created_at'

export const STAFF_TASK_SELECT =
  'id, external_key, villa_id, booking_id, thread_id, expense_id, task_type, description, due_at, priority, status, assignee, note, source, auto_generated, created_at, updated_at'

export const STAFF_ISSUE_SELECT =
  'id, external_key, villa_id, booking_id, thread_id, expense_id, severity, title, summary, opened_at, assignee, status, source, note, auto_generated, created_at, updated_at'

export const EXPENSE_SUBMISSION_SELECT =
  'id, expense_id, villa_id, expense_date, category, amount, vendor, note, submitted_by, status, receipt_name, receipt_data_url, flagged_reason, created_at, updated_at'

export const INVOICE_CONFIG_SELECT =
  'id, minimum_amount, updated_by_user_id, updated_by_name, created_at, updated_at'

export const INVESTOR_INVOICE_SELECT =
  'id, invoice_number, villa_id, villa_name, period_key, period_label, covered_range_label, created_at, due_date, total_amount, ready_amount, review_amount, workflow_status, payment_status, paid_at, creation_mode, created_by_user_id, created_by_name, threshold_applied, forced'

export const INVESTOR_INVOICE_ITEM_SELECT =
  'id, invoice_id, line_item_key, expense_id, submission_id, villa_id, villa_name, expense_date, category, amount, vendor, note, submitted_by, expense_status, receipt_name, receipt_data_url, created_at'

export const MANAGEMENT_FEE_SELECT =
  'villa_id, fee_type, percentage_rate, fixed_amount, updated_by_user_id, updated_by_name, created_at, updated_at'
