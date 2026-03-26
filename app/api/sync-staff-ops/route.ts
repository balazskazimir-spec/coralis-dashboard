import { buildInboxThreads } from '@/lib/inbox'
import { attachVillaNamesToTasks, buildStaffIssues, buildStaffTasks, toStaffIssueUpserts, toStaffTaskUpserts } from '@/lib/staff'
import { BOOKING_SELECT, EXPENSE_SELECT, MESSAGE_SELECT, MESSAGE_THREAD_SELECT, VILLA_SELECT } from '@/lib/dbSelects'
import { supabase } from '@/lib/supabase'
import type {
  BookingRecord,
  ExpenseRecord,
  MessageRecord,
  MessageThreadRecord,
  StaffIssueRecord,
  StaffTaskRecord,
  VillaRecord,
} from '@/lib/types'

function isMissingTable(message?: string | null) {
  const value = message?.toLowerCase() || ''
  return value.includes('does not exist') || value.includes('staff_tasks') || value.includes('staff_issues')
}

export async function POST() {
  try {
    const [villasResult, bookingsResult, expensesResult, threadsResult, messagesResult, existingTasksResult, existingIssuesResult] = await Promise.all([
      supabase.from('villas').select(VILLA_SELECT).order('name'),
      supabase.from('bookings').select(BOOKING_SELECT).order('check_in', { ascending: false }),
      supabase.from('expenses').select(EXPENSE_SELECT).order('date', { ascending: false }),
      supabase.from('message_threads').select(MESSAGE_THREAD_SELECT).order('last_message_at', { ascending: false }),
      supabase.from('messages').select(MESSAGE_SELECT).order('sent_at', { ascending: true }),
      supabase.from('staff_tasks').select('id, external_key, auto_generated'),
      supabase.from('staff_issues').select('id, external_key, auto_generated'),
    ])

    const missingOpsSchema = isMissingTable(existingTasksResult.error?.message) || isMissingTable(existingIssuesResult.error?.message)
    if (missingOpsSchema) {
      return Response.json({ error: 'staff_ops_schema_missing' }, { status: 500 })
    }

    const error =
      villasResult.error?.message ||
      bookingsResult.error?.message ||
      expensesResult.error?.message ||
      threadsResult.error?.message ||
      messagesResult.error?.message ||
      existingTasksResult.error?.message ||
      existingIssuesResult.error?.message

    if (error) {
      return Response.json({ error }, { status: 500 })
    }

    const villas = (villasResult.data as VillaRecord[]) || []
    const bookings = (bookingsResult.data as BookingRecord[]) || []
    const expenses = (expensesResult.data as ExpenseRecord[]) || []
    const threadRows = (threadsResult.data as MessageThreadRecord[]) || []
    const messageRows = (messagesResult.data as MessageRecord[]) || []
    const existingTasks = (existingTasksResult.data as Pick<StaffTaskRecord, 'id' | 'external_key' | 'auto_generated'>[]) || []
    const existingIssues = (existingIssuesResult.data as Pick<StaffIssueRecord, 'id' | 'external_key' | 'auto_generated'>[]) || []

    const threads = buildInboxThreads(threadRows, messageRows, bookings, villas)
    const generatedTasks = attachVillaNamesToTasks(buildStaffTasks(bookings, threads, expenses, 'Ops Team', 'week', new Date()), villas)
    const generatedIssues = buildStaffIssues(threads, generatedTasks, expenses, villas, new Date())

    const taskUpserts = toStaffTaskUpserts(generatedTasks)
    const issueUpserts = toStaffIssueUpserts(generatedIssues)

    const taskResult = taskUpserts.length
      ? await supabase.from('staff_tasks').upsert(taskUpserts, { onConflict: 'external_key' }).select('id')
      : { error: null }
    const issueResult = issueUpserts.length
      ? await supabase.from('staff_issues').upsert(issueUpserts, { onConflict: 'external_key' }).select('id')
      : { error: null }

    if (taskResult.error || issueResult.error) {
      return Response.json({ error: taskResult.error?.message || issueResult.error?.message || 'Sync failed.' }, { status: 500 })
    }

    const taskKeys = new Set(taskUpserts.map((task) => task.external_key))
    const issueKeys = new Set(issueUpserts.map((issue) => issue.external_key))
    const staleTaskKeys = existingTasks.filter((task) => task.auto_generated && !taskKeys.has(task.external_key)).map((task) => task.external_key)
    const staleIssueKeys = existingIssues.filter((issue) => issue.auto_generated && !issueKeys.has(issue.external_key)).map((issue) => issue.external_key)

    if (staleTaskKeys.length) {
      await supabase.from('staff_tasks').delete().in('external_key', staleTaskKeys)
    }

    if (staleIssueKeys.length) {
      await supabase.from('staff_issues').delete().in('external_key', staleIssueKeys)
    }

    return Response.json({
      success: true,
      tasks: taskUpserts.length,
      issues: issueUpserts.length,
    })
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
