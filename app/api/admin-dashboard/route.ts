import { BOOKING_SELECT, EXPENSE_SELECT, STAFF_ISSUE_SELECT, STAFF_TASK_SELECT, VILLA_SELECT } from '@/lib/dbSelects'
import { supabase } from '@/lib/supabase'

export async function GET() {
  try {
    const [bookingsResult, expensesResult, villasResult, tasksResult, issuesResult] = await Promise.all([
      supabase.from('bookings').select(BOOKING_SELECT),
      supabase.from('expenses').select(EXPENSE_SELECT),
      supabase.from('villas').select(VILLA_SELECT).order('name'),
      supabase.from('staff_tasks').select(STAFF_TASK_SELECT),
      supabase.from('staff_issues').select(STAFF_ISSUE_SELECT),
    ])

    const error =
      bookingsResult.error?.message ||
      expensesResult.error?.message ||
      villasResult.error?.message ||
      tasksResult.error?.message ||
      issuesResult.error?.message

    if (error) {
      return Response.json({ error }, { status: 500 })
    }

    return Response.json({
      bookings: bookingsResult.data || [],
      expenses: expensesResult.data || [],
      villas: villasResult.data || [],
      taskRows: tasksResult.data || [],
      issueRows: issuesResult.data || [],
    })
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
