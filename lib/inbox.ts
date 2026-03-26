import type {
  BookingRecord,
  InboxMessageSender,
  InboxPlatform,
  InboxTag,
  InboxThreadStatus,
  MessageRecord,
  MessageThreadRecord,
  VillaRecord,
} from '@/lib/types'

export type InboxUiMessage = {
  id: string
  sender: InboxMessageSender
  body: string
  sentAt: string
}

export type InboxUiThread = {
  id: string
  bookingId: string
  villaId: string
  villaName: string
  guestName: string
  platform: InboxPlatform
  status: InboxThreadStatus
  tag: InboxTag
  unread: boolean
  lastMessageAt: string
  bookingLabel: string
  revenue: number
  guestHistory: number
  notes: string
  messages: InboxUiMessage[]
}

export function normalizePlatform(source?: string | null): InboxPlatform {
  const value = source?.toLowerCase() || ''
  if (value.includes('airbnb')) return 'Airbnb'
  if (value.includes('booking')) return 'Booking.com'
  return 'Direct'
}

export function normalizeStatus(value?: string | null): InboxThreadStatus {
  if (value === 'Waiting' || value === 'Resolved') return value
  return 'Needs reply'
}

export function normalizeTag(value?: string | null): InboxTag {
  if (value === 'check-in' || value === 'pricing' || value === 'complaint') return value
  return 'general'
}

export function normalizeSender(value?: string | null): InboxMessageSender {
  return value === 'host' ? 'host' : 'guest'
}

export function classifyTag(message: string): InboxTag {
  const value = message.toLowerCase()
  if (value.includes('check-in') || value.includes('arrival')) return 'check-in'
  if (value.includes('price') || value.includes('discount') || value.includes('rate')) return 'pricing'
  if (value.includes('problem') || value.includes('issue') || value.includes('broken') || value.includes('complaint')) return 'complaint'
  return 'general'
}

export function bookingNights(booking: BookingRecord) {
  return Math.max(0, (new Date(booking.check_out).getTime() - new Date(booking.check_in).getTime()) / 86_400_000)
}

export function bookingRevenue(booking: BookingRecord) {
  return bookingNights(booking) * (Number(booking.price_per_night) || 0)
}

export function formatBookingRange(booking: BookingRecord) {
  const checkIn = new Date(booking.check_in).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const checkOut = new Date(booking.check_out).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${checkIn} - ${checkOut}`
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value)
}

export function formatTimeAgo(dateString: string, currentTime: number) {
  const diffHours = Math.max(0, (currentTime - new Date(dateString).getTime()) / 3_600_000)
  if (diffHours < 1) return `${Math.round(diffHours * 60)}m ago`
  if (diffHours < 24) return `${Math.round(diffHours)}h ago`
  return `${Math.round(diffHours / 24)}d ago`
}

export function buildInboxThreads(
  threadRows: MessageThreadRecord[],
  messageRows: MessageRecord[],
  bookings: BookingRecord[],
  villas: VillaRecord[]
) {
  const bookingsMap = new Map(bookings.map((booking) => [booking.id, booking]))
  const villasMap = new Map(villas.map((villa) => [villa.id, villa.name]))
  const guestCounts = bookings.reduce<Record<string, number>>((map, booking) => {
    map[booking.guest_name] = (map[booking.guest_name] || 0) + 1
    return map
  }, {})
  const messagesByThread = messageRows.reduce<Record<string, InboxUiMessage[]>>((map, message) => {
    const normalized = {
      id: message.id,
      sender: normalizeSender(message.sender),
      body: message.body,
      sentAt: message.sent_at,
    }
    if (!map[message.thread_id]) {
      map[message.thread_id] = []
    }
    map[message.thread_id].push(normalized)
    return map
  }, {})

  Object.values(messagesByThread).forEach((messages) => {
    messages.sort((a, b) => a.sentAt.localeCompare(b.sentAt))
  })

  return threadRows
    .map((thread) => {
      const booking = thread.booking_id ? bookingsMap.get(thread.booking_id) : null
      const messages = messagesByThread[thread.id] || []
      const lastMessage = messages[messages.length - 1]
      const status = normalizeStatus(thread.status)
      const derivedUnread = lastMessage ? lastMessage.sender === 'guest' && status !== 'Resolved' : false
      const firstGuestBody = messages.find((message) => message.sender === 'guest')?.body || ''
      return {
        id: thread.id,
        bookingId: thread.booking_id || '',
        villaId: thread.villa_id || booking?.villa_id || '',
        villaName: villasMap.get(thread.villa_id || booking?.villa_id || '') || 'Unknown Villa',
        guestName: thread.guest_name || booking?.guest_name || 'Guest',
        platform: normalizePlatform(thread.platform || booking?.source),
        status,
        tag: thread.tag ? normalizeTag(thread.tag) : classifyTag(firstGuestBody),
        unread: thread.unread ?? derivedUnread,
        lastMessageAt: thread.last_message_at || lastMessage?.sentAt || booking?.check_in || new Date(0).toISOString(),
        bookingLabel: booking ? formatBookingRange(booking) : 'No booking linked',
        revenue: booking ? bookingRevenue(booking) : 0,
        guestHistory: thread.guest_history ?? Math.max(0, (guestCounts[thread.guest_name] || 1) - 1),
        notes: thread.notes || booking?.notes || 'No notes yet',
        messages,
      } satisfies InboxUiThread
    })
    .filter((thread) => thread.villaId)
}
