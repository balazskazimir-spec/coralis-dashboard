import type {
  BookingRecord,
  ExpenseRecord,
  StaffCalendarPreviewRow,
  StaffDateFilter,
  StaffIssue,
  StaffIssueRecord,
  StaffIssueStatus,
  StaffSeverity,
  StaffTask,
  StaffTaskRecord,
  StaffTaskStatus,
  StaffVillaCard,
  VillaRecord,
} from '@/lib/types'
import type { InboxUiThread } from '@/lib/inbox'

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

export function getStaffWindow(filter: StaffDateFilter, now: Date) {
  const start = startOfDay(now)
  if (filter === 'tomorrow') {
    const tomorrow = new Date(start)
    tomorrow.setDate(tomorrow.getDate() + 1)
    return { start: tomorrow, end: tomorrow }
  }
  if (filter === 'week') {
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    return { start, end }
  }
  return { start, end: start }
}

function withinWindow(date: string | Date, filter: StaffDateFilter, now: Date) {
  const value = startOfDay(typeof date === 'string' ? new Date(date) : date)
  const { start, end } = getStaffWindow(filter, now)
  return value >= start && value <= end
}

export function matchesStaffWindow(date: string | Date, filter: StaffDateFilter, now: Date) {
  return withinWindow(date, filter, now)
}

function withTime(dateString: string, hours: number, minutes: number) {
  const date = new Date(dateString)
  date.setHours(hours, minutes, 0, 0)
  return date
}

export function formatTaskTime(value: string) {
  return new Date(value).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function hasSameDayTurnover(villaId: string, checkOut: string, bookings: BookingRecord[]) {
  return bookings.some((booking) => booking.villa_id === villaId && booking.check_in === checkOut)
}

function normalizeTaskStatus(value?: string | null): StaffTaskStatus {
  if (value === 'In progress' || value === 'Done' || value === 'Blocked') return value
  return 'To do'
}

function normalizeTaskType(value?: string | null): StaffTask['type'] {
  if (
    value === 'Check-in' ||
    value === 'Check-out' ||
    value === 'Cleaning' ||
    value === 'Maintenance' ||
    value === 'Guest request' ||
    value === 'Inspection'
  ) {
    return value
  }
  return 'Follow-up'
}

function normalizeIssueStatus(value?: string | null): StaffIssueStatus {
  if (value === 'Investigating' || value === 'Waiting' || value === 'Resolved') return value
  return 'Open'
}

function normalizeSeverity(value?: string | null): StaffSeverity {
  if (value === 'Critical' || value === 'Warning') return value
  return 'Normal'
}

function normalizeIssueSource(value?: string | null): StaffIssue['source'] {
  if (
    value === 'maintenance' ||
    value === 'guest complaint' ||
    value === 'delayed cleaning' ||
    value === 'missing supply' ||
    value === 'access problem'
  ) {
    return value
  }
  return 'urgent follow-up'
}

function formatTaskLabel(type: StaffTask['type']) {
  return type
}

function expenseDateToIso(value: string) {
  const date = new Date(value)
  date.setHours(9, 0, 0, 0)
  return date.toISOString()
}

export function buildStaffTasks(
  bookings: BookingRecord[],
  threads: InboxUiThread[],
  expenses: ExpenseRecord[],
  currentUserName: string,
  filter: StaffDateFilter,
  now: Date
) {
  const tasks: StaffTask[] = []

  bookings.forEach((booking) => {
    if (!booking.villa_id) return

    if (withinWindow(booking.check_out, filter, now)) {
      const turnover = hasSameDayTurnover(booking.villa_id, booking.check_out, bookings)
      tasks.push({
        id: `checkout-${booking.id}`,
        externalKey: `checkout-${booking.id}`,
        time: formatTaskTime(withTime(booking.check_out, 10, 0).toISOString()),
        dueAt: withTime(booking.check_out, 10, 0).toISOString(),
        type: 'Check-out',
        villaId: booking.villa_id,
        villaName: '',
        description: `${booking.guest_name} departure`,
        priority: turnover ? 'Critical' : 'Normal',
        status: 'To do',
        assignee: currentUserName,
        note: '',
        bookingId: booking.id,
        source: 'booking',
      })
      tasks.push({
        id: `cleaning-${booking.id}`,
        externalKey: `cleaning-${booking.id}`,
        time: formatTaskTime(withTime(booking.check_out, 11, 30).toISOString()),
        dueAt: withTime(booking.check_out, 11, 30).toISOString(),
        type: 'Cleaning',
        villaId: booking.villa_id,
        villaName: '',
        description: turnover ? 'Turnover cleaning before next arrival' : 'Standard post stay cleaning',
        priority: turnover ? 'Critical' : 'Warning',
        status: 'To do',
        assignee: currentUserName,
        note: '',
        bookingId: booking.id,
        source: 'booking',
      })
      tasks.push({
        id: `inspection-${booking.id}`,
        externalKey: `inspection-${booking.id}`,
        time: formatTaskTime(withTime(booking.check_out, 13, 0).toISOString()),
        dueAt: withTime(booking.check_out, 13, 0).toISOString(),
        type: 'Inspection',
        villaId: booking.villa_id,
        villaName: '',
        description: 'Post-clean quality and stock check',
        priority: turnover ? 'Warning' : 'Normal',
        status: 'To do',
        assignee: currentUserName,
        note: '',
        bookingId: booking.id,
        source: 'booking',
      })
    }

    if (withinWindow(booking.check_in, filter, now)) {
      tasks.push({
        id: `prep-${booking.id}`,
        externalKey: `prep-${booking.id}`,
        time: formatTaskTime(withTime(booking.check_in, 14, 0).toISOString()),
        dueAt: withTime(booking.check_in, 14, 0).toISOString(),
        type: 'Check-in',
        villaId: booking.villa_id,
        villaName: '',
        description: `Prepare welcome setup for ${booking.guest_name}`,
        priority: 'Warning',
        status: 'To do',
        assignee: currentUserName,
        note: '',
        bookingId: booking.id,
        source: 'booking',
      })
      tasks.push({
        id: `arrival-${booking.id}`,
        externalKey: `arrival-${booking.id}`,
        time: formatTaskTime(withTime(booking.check_in, 15, 0).toISOString()),
        dueAt: withTime(booking.check_in, 15, 0).toISOString(),
        type: 'Follow-up',
        villaId: booking.villa_id,
        villaName: '',
        description: `Guest arrival window for ${booking.guest_name}`,
        priority: 'Normal',
        status: 'To do',
        assignee: currentUserName,
        note: '',
        bookingId: booking.id,
        source: 'booking',
      })
    }
  })

  threads.forEach((thread) => {
    const dueAt = new Date(thread.lastMessageAt)
    if (!withinWindow(dueAt, filter, now) && filter !== 'week') return
    if (thread.status === 'Resolved') return
    tasks.push({
      id: `thread-${thread.id}`,
      externalKey: `thread-${thread.id}`,
      time: formatTaskTime(dueAt.toISOString()),
      dueAt: dueAt.toISOString(),
      type: thread.tag === 'complaint' ? 'Guest request' : 'Follow-up',
      villaId: thread.villaId,
      villaName: thread.villaName,
      description: `${thread.guestName}: ${thread.messages[thread.messages.length - 1]?.body || 'Guest follow-up'}`,
      priority: thread.tag === 'complaint' || thread.unread ? 'Critical' : 'Warning',
      status: thread.status === 'Waiting' ? 'In progress' : 'To do',
      assignee: currentUserName,
      note: '',
      threadId: thread.id,
      bookingId: thread.bookingId || null,
      source: 'thread',
    })
  })

  expenses
    .filter((expense) => expense.villa_id && expense.category === 'maintenance' && expense.date)
    .filter((expense) => withinWindow(expense.date as string, filter, now))
    .forEach((expense) => {
      tasks.push({
        id: `maintenance-${expense.id}`,
        externalKey: `maintenance-${expense.id}`,
        time: formatTaskTime(withTime(expense.date as string, 16, 0).toISOString()),
        dueAt: withTime(expense.date as string, 16, 0).toISOString(),
        type: 'Maintenance',
        villaId: expense.villa_id as string,
        villaName: '',
        description: expense.note || 'Maintenance follow-up',
        priority: 'Warning',
        status: 'To do',
        assignee: currentUserName,
        note: '',
        expenseId: expense.id,
        source: 'expense',
      })
    })

  return tasks.sort((left, right) => left.dueAt.localeCompare(right.dueAt))
}

export function attachVillaNamesToTasks(tasks: StaffTask[], villas: VillaRecord[]) {
  const villaMap = new Map(villas.map((villa) => [villa.id, villa.name]))
  return tasks.map((task) => ({
    ...task,
    villaName: task.villaName || villaMap.get(task.villaId) || 'Unknown Villa',
  }))
}

export function buildStaffIssues(
  threads: InboxUiThread[],
  tasks: StaffTask[],
  expenses: ExpenseRecord[],
  villas: VillaRecord[],
  now: Date
) {
  const villaMap = new Map(villas.map((villa) => [villa.id, villa.name]))
  const issues: StaffIssue[] = []

  threads.forEach((thread) => {
    if (!thread.unread && thread.status === 'Resolved' && thread.tag !== 'complaint') return
    const hoursOpen = (now.getTime() - new Date(thread.lastMessageAt).getTime()) / 3_600_000
    const severity: StaffSeverity =
      thread.tag === 'complaint' || hoursOpen > 2 ? 'Critical' : thread.unread ? 'Warning' : 'Normal'
    issues.push({
      id: `issue-thread-${thread.id}`,
      externalKey: `issue-thread-${thread.id}`,
      severity,
      villaId: thread.villaId,
      villaName: thread.villaName,
      title: thread.tag === 'complaint' ? 'Guest complaint follow-up' : 'Guest reply pending',
      summary: thread.messages[thread.messages.length - 1]?.body || 'Open guest communication',
      openedAt: thread.lastMessageAt,
      assignee: 'Ops Team',
      status: thread.status === 'Resolved' ? 'Resolved' : severity === 'Critical' ? 'Open' : 'Waiting',
      source: thread.tag === 'complaint' ? 'guest complaint' : 'urgent follow-up',
      threadId: thread.id,
      bookingId: thread.bookingId || null,
      note: '',
    })
  })

  tasks
    .filter((task) => task.type === 'Cleaning' && task.priority === 'Critical')
    .forEach((task) => {
      issues.push({
        id: `issue-cleaning-${task.id}`,
        externalKey: `issue-cleaning-${task.id}`,
        severity: 'Warning',
        villaId: task.villaId,
        villaName: task.villaName || villaMap.get(task.villaId) || 'Unknown Villa',
        title: 'Delayed cleaning risk',
        summary: task.description,
        openedAt: task.dueAt,
        assignee: task.assignee,
        status: task.status === 'Done' ? 'Resolved' : 'Open',
        source: 'delayed cleaning',
        bookingId: task.bookingId || null,
        note: '',
      })
    })

  expenses
    .filter((expense) => expense.villa_id && expense.category === 'maintenance' && expense.date)
    .slice(0, 4)
    .forEach((expense) => {
      issues.push({
        id: `issue-maint-${expense.id}`,
        externalKey: `issue-maint-${expense.id}`,
        severity: 'Warning',
        villaId: expense.villa_id as string,
        villaName: villaMap.get(expense.villa_id as string) || 'Unknown Villa',
        title: 'Maintenance follow-up',
        summary: expense.note || 'Maintenance expense logged',
        openedAt: expense.date as string,
        assignee: 'Maintenance Lead',
        status: 'Investigating',
        source: 'maintenance',
        expenseId: expense.id,
        note: '',
      })
    })

  return issues
    .filter((issue, index, collection) => collection.findIndex((candidate) => candidate.id === issue.id) === index)
    .sort((left, right) => new Date(right.openedAt).getTime() - new Date(left.openedAt).getTime())
}

export function buildVillaStatusCards(
  villas: VillaRecord[],
  bookings: BookingRecord[],
  threads: InboxUiThread[],
  tasks: StaffTask[],
  issues: StaffIssue[],
  focusDate: Date
) {
  return villas.map<StaffVillaCard>((villa) => {
    const villaBookings = bookings.filter((booking) => booking.villa_id === villa.id)
    const activeBooking = villaBookings.find((booking) => {
      const current = focusDate.getTime()
      return new Date(booking.check_in).getTime() <= current && new Date(booking.check_out).getTime() > current
    })
    const nextBooking = villaBookings
      .filter((booking) => new Date(booking.check_in).getTime() >= focusDate.getTime())
      .sort((left, right) => left.check_in.localeCompare(right.check_in))[0]
    const villaTasks = tasks.filter((task) => task.villaId === villa.id && task.status !== 'Done')
    const villaIssues = issues.filter((issue) => issue.villaId === villa.id && issue.status !== 'Resolved')
    const unreadMessages = threads.filter((thread) => thread.villaId === villa.id && thread.unread).length

    let status: StaffVillaCard['status'] = activeBooking ? 'Occupied' : 'Vacant'
    if (villaIssues.length > 0) status = villaIssues.some((issue) => issue.severity === 'Critical') ? 'Issue flagged' : 'Maintenance'
    else if (villaTasks.some((task) => task.type === 'Cleaning' && task.status !== 'Done')) status = 'Cleaning in progress'
    else if (!activeBooking && nextBooking) status = 'Ready'

    return {
      id: villa.id,
      name: villa.name,
      status,
      todayEvents: villaTasks.length,
      currentGuest: activeBooking ? activeBooking.guest_name : 'No current guest',
      nextGuest: nextBooking ? `${nextBooking.guest_name} ${new Date(nextBooking.check_in).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'No upcoming arrival',
      issueCount: villaIssues.length,
      unreadMessages,
      cleaningState: villaTasks.some((task) => task.type === 'Cleaning' && task.status !== 'Done') ? 'Cleaning pending' : 'Operationally clear',
    }
  })
}

export function buildUpcomingBookings(bookings: BookingRecord[], now: Date, days = 7) {
  const start = startOfDay(now)
  const end = new Date(start)
  end.setDate(end.getDate() + (days - 1))
  return bookings
    .filter((booking) => {
      const checkIn = startOfDay(new Date(booking.check_in))
      return checkIn >= start && checkIn <= end
    })
    .sort((left, right) => left.check_in.localeCompare(right.check_in))
}

export function buildCalendarPreview(villas: VillaRecord[], bookings: BookingRecord[], startDate: Date, days = 7) {
  return villas.map<StaffCalendarPreviewRow>((villa) => ({
    villaId: villa.id,
    villaName: villa.name,
    days: Array.from({ length: days }, (_, index) => {
      const day = new Date(startDate)
      day.setDate(day.getDate() + index)
      const dayKey = isoDate(day)
      const hasCheckIn = bookings.some((booking) => booking.villa_id === villa.id && booking.check_in === dayKey)
      const hasCheckOut = bookings.some((booking) => booking.villa_id === villa.id && booking.check_out === dayKey)
      const occupied = bookings.some((booking) => booking.villa_id === villa.id && booking.check_in <= dayKey && booking.check_out > dayKey)
      return {
        date: dayKey,
        label: day.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2),
        state: hasCheckIn || hasCheckOut ? 'turnover' : occupied ? 'booked' : 'empty',
      }
    }),
  }))
}

export function countOccupiedVillas(bookings: BookingRecord[], villas: VillaRecord[], focusDate: Date) {
  const current = focusDate.getTime()
  return villas.filter((villa) =>
    bookings.some((booking) => booking.villa_id === villa.id && new Date(booking.check_in).getTime() <= current && new Date(booking.check_out).getTime() > current)
  ).length
}

export function isUrgentTask(task: StaffTask) {
  return task.priority === 'Critical' || task.status === 'Blocked'
}

export function isNeedsActionTask(task: StaffTask) {
  return task.status !== 'Done'
}

export function isUrgentIssue(issue: StaffIssue) {
  return issue.severity === 'Critical' || issue.status === 'Open'
}

export function isNeedsActionIssue(issue: StaffIssue) {
  return issue.status !== 'Resolved'
}

export function issueStatusFromTaskStatus(status: StaffTaskStatus): StaffIssueStatus {
  if (status === 'Done') return 'Resolved'
  if (status === 'In progress') return 'Investigating'
  if (status === 'Blocked') return 'Waiting'
  return 'Open'
}

export function mergeStaffTasks(derivedTasks: StaffTask[], taskRecords: StaffTaskRecord[], villas: VillaRecord[] = []) {
  const taskMap = new Map(taskRecords.map((record) => [record.external_key, record]))
  const villaMap = new Map(villas.map((villa) => [villa.id, villa.name]))
  const mergedTasks = derivedTasks.map((task) => {
    const record = taskMap.get(task.externalKey || task.id)
    return {
      ...task,
      id: record?.external_key || task.id,
      recordId: record?.id,
      externalKey: record?.external_key || task.externalKey || task.id,
      time: formatTaskTime(record?.due_at || task.dueAt),
      dueAt: record?.due_at || task.dueAt,
      type: record ? normalizeTaskType(record.task_type) : task.type,
      description: record?.description || task.description,
      priority: record ? normalizeSeverity(record.priority) : task.priority,
      status: record ? normalizeTaskStatus(record.status) : task.status,
      assignee: record?.assignee || task.assignee,
      note: record?.note || task.note,
      bookingId: record?.booking_id ?? task.bookingId ?? null,
      threadId: record?.thread_id ?? task.threadId ?? null,
      expenseId: record?.expense_id ?? task.expenseId ?? null,
      source: (record?.source as StaffTask['source']) || task.source,
    } satisfies StaffTask
  })

  const matchedKeys = new Set(mergedTasks.map((task) => task.externalKey || task.id))
  const manualTasks = taskRecords
    .filter((record) => !matchedKeys.has(record.external_key))
    .map((record) => {
      const villaId = record.villa_id || ''
      return {
        id: record.external_key,
        recordId: record.id,
        externalKey: record.external_key,
        time: formatTaskTime(record.due_at),
        dueAt: record.due_at,
        type: normalizeTaskType(record.task_type),
        villaId,
        villaName: villaMap.get(villaId) || 'Unknown Villa',
        description: record.description,
        priority: normalizeSeverity(record.priority),
        status: normalizeTaskStatus(record.status),
        assignee: record.assignee || 'Ops Team',
        note: record.note || '',
        bookingId: record.booking_id,
        threadId: record.thread_id,
        expenseId: record.expense_id,
        source: (record.source as StaffTask['source']) || 'manual',
      } satisfies StaffTask
    })

  return [...mergedTasks, ...manualTasks].sort((left, right) => left.dueAt.localeCompare(right.dueAt))
}

export function mergeStaffIssues(derivedIssues: StaffIssue[], issueRecords: StaffIssueRecord[], villas: VillaRecord[] = []) {
  const issueMap = new Map(issueRecords.map((record) => [record.external_key, record]))
  const villaMap = new Map(villas.map((villa) => [villa.id, villa.name]))
  const mergedIssues = derivedIssues.map((issue) => {
    const record = issueMap.get(issue.externalKey || issue.id)
    return {
      ...issue,
      id: record?.external_key || issue.id,
      recordId: record?.id,
      externalKey: record?.external_key || issue.externalKey || issue.id,
      severity: record ? normalizeSeverity(record.severity) : issue.severity,
      title: record?.title || issue.title,
      summary: record?.summary || issue.summary,
      openedAt: record?.opened_at || issue.openedAt,
      assignee: record?.assignee || issue.assignee,
      status: record ? normalizeIssueStatus(record.status) : issue.status,
      note: record?.note || issue.note || '',
      bookingId: record?.booking_id ?? issue.bookingId ?? null,
      threadId: record?.thread_id ?? issue.threadId ?? null,
      expenseId: record?.expense_id ?? issue.expenseId ?? null,
      source: record ? normalizeIssueSource(record.source) : issue.source,
    } satisfies StaffIssue
  })

  const matchedKeys = new Set(mergedIssues.map((issue) => issue.externalKey || issue.id))
  const manualIssues = issueRecords
    .filter((record) => !matchedKeys.has(record.external_key))
    .map((record) => {
      const villaId = record.villa_id || ''
      return {
        id: record.external_key,
        recordId: record.id,
        externalKey: record.external_key,
        severity: normalizeSeverity(record.severity),
        villaId,
        villaName: villaMap.get(villaId) || 'Unknown Villa',
        title: record.title,
        summary: record.summary,
        openedAt: record.opened_at,
        assignee: record.assignee || 'Ops Team',
        status: normalizeIssueStatus(record.status),
        source: normalizeIssueSource(record.source),
        note: record.note || '',
        bookingId: record.booking_id,
        threadId: record.thread_id,
        expenseId: record.expense_id,
      } satisfies StaffIssue
    })

  return [...mergedIssues, ...manualIssues].sort((left, right) => new Date(right.openedAt).getTime() - new Date(left.openedAt).getTime())
}

export function toStaffTaskUpserts(tasks: StaffTask[]) {
  return tasks.map((task) => ({
    external_key: task.externalKey || task.id,
    villa_id: task.villaId,
    booking_id: task.bookingId || null,
    thread_id: task.threadId || null,
    expense_id: task.expenseId || null,
    task_type: formatTaskLabel(task.type),
    description: task.description,
    due_at: task.dueAt,
    priority: task.priority,
    status: task.status,
    assignee: task.assignee,
    note: task.note || '',
    source: task.source || 'manual',
    auto_generated: true,
  }))
}

export function toStaffIssueUpserts(issues: StaffIssue[]) {
  return issues.map((issue) => ({
    external_key: issue.externalKey || issue.id,
    villa_id: issue.villaId,
    booking_id: issue.bookingId || null,
    thread_id: issue.threadId || null,
    expense_id: issue.expenseId || null,
    severity: issue.severity,
    title: issue.title,
    summary: issue.summary,
    opened_at: issue.openedAt.includes('T') ? issue.openedAt : expenseDateToIso(issue.openedAt),
    assignee: issue.assignee,
    status: issue.status,
    source: issue.source,
    note: issue.note || '',
    auto_generated: true,
  }))
}

export function buildManualTaskInput(task: {
  externalKey: string
  villaId: string
  type: StaffTask['type']
  description: string
  dueAt: string
  priority: StaffSeverity
  status: StaffTaskStatus
  assignee: string
  note: string
}) {
  return {
    external_key: task.externalKey,
    villa_id: task.villaId,
    booking_id: null,
    thread_id: null,
    expense_id: null,
    task_type: formatTaskLabel(task.type),
    description: task.description,
    due_at: task.dueAt,
    priority: task.priority,
    status: task.status,
    assignee: task.assignee,
    note: task.note,
    source: 'manual',
    auto_generated: false,
  }
}

export function buildManualIssueInput(issue: {
  externalKey: string
  villaId: string
  severity: StaffSeverity
  title: string
  summary: string
  openedAt: string
  assignee: string
  status: StaffIssueStatus
  source: StaffIssue['source']
  note: string
}) {
  return {
    external_key: issue.externalKey,
    villa_id: issue.villaId,
    booking_id: null,
    thread_id: null,
    expense_id: null,
    severity: issue.severity,
    title: issue.title,
    summary: issue.summary,
    opened_at: issue.openedAt,
    assignee: issue.assignee,
    status: issue.status,
    source: issue.source,
    note: issue.note,
    auto_generated: false,
  }
}
