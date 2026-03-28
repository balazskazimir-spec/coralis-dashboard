import { supabase } from '@/lib/supabase'

export async function GET() {
  try {
    // Get one booking to see the structure
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select('*')
      .limit(1)

    // Get one expense to see the structure
    const { data: expenses, error: expensesError } = await supabase
      .from('expenses')
      .select('*')
      .limit(1)

    const { data: messageThreads, error: messageThreadsError } = await supabase
      .from('message_threads')
      .select('*')
      .limit(1)

    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('*')
      .limit(1)

    const { data: staffTasks, error: staffTasksError } = await supabase
      .from('staff_tasks')
      .select('*')
      .limit(1)

    const { data: staffIssues, error: staffIssuesError } = await supabase
      .from('staff_issues')
      .select('*')
      .limit(1)

    const { data: expenseSubmissions, error: expenseSubmissionsError } = await supabase
      .from('expense_submissions')
      .select('*')
      .limit(1)

    const { data: invoiceConfigs, error: invoiceConfigsError } = await supabase
      .from('invoice_configs')
      .select('*')
      .limit(1)

    const { data: investorInvoices, error: investorInvoicesError } = await supabase
      .from('investor_invoices')
      .select('*')
      .limit(1)

    const { data: investorInvoiceItems, error: investorInvoiceItemsError } = await supabase
      .from('investor_invoice_items')
      .select('*')
      .limit(1)

    const { data: managementFeeConfigs, error: managementFeeConfigsError } = await supabase
      .from('management_fee_configs')
      .select('*')
      .limit(1)

    return Response.json({
      bookings: {
        sample: bookings?.[0] || null,
        error: bookingsError,
      },
      expenses: {
        sample: expenses?.[0] || null,
        error: expensesError,
      },
      message_threads: {
        sample: messageThreads?.[0] || null,
        error: messageThreadsError,
      },
      messages: {
        sample: messages?.[0] || null,
        error: messagesError,
      },
      staff_tasks: {
        sample: staffTasks?.[0] || null,
        error: staffTasksError,
      },
      staff_issues: {
        sample: staffIssues?.[0] || null,
        error: staffIssuesError,
      },
      expense_submissions: {
        sample: expenseSubmissions?.[0] || null,
        error: expenseSubmissionsError,
      },
      invoice_configs: {
        sample: invoiceConfigs?.[0] || null,
        error: invoiceConfigsError,
      },
      investor_invoices: {
        sample: investorInvoices?.[0] || null,
        error: investorInvoicesError,
      },
      investor_invoice_items: {
        sample: investorInvoiceItems?.[0] || null,
        error: investorInvoiceItemsError,
      },
      management_fee_configs: {
        sample: managementFeeConfigs?.[0] || null,
        error: managementFeeConfigsError,
      },
    })
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
