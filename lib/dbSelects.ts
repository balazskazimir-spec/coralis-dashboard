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
