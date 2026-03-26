import { supabase } from '@/lib/supabase'
import { classifyTag, normalizePlatform } from '@/lib/inbox'
import type { BookingRecord, MessageRecord, MessageThreadRecord, VillaRecord } from '@/lib/types'

function makeGuestMessage(booking: BookingRecord, index: number) {
  const variants = [
    'Hi, what time is check-in?',
    'Can you send the WiFi details before arrival?',
    'Is there any flexibility on price for one extra night?',
    'We had an AC issue before. Has it been fixed?',
  ]

  const guestAt = new Date(booking.check_in)
  guestAt.setDate(guestAt.getDate() - 2)
  guestAt.setHours(9 + (index % 4), 20, 0, 0)
  return {
    body: variants[index % variants.length],
    sentAt: guestAt.toISOString(),
  }
}

export async function POST() {
  try {
    const [bookingsResult, villasResult] = await Promise.all([
      supabase.from('bookings').select('*').order('check_in', { ascending: false }).limit(12),
      supabase.from('villas').select('id, name'),
    ])

    if (bookingsResult.error) {
      return Response.json({ error: bookingsResult.error.message }, { status: 500 })
    }

    const bookings = (bookingsResult.data as BookingRecord[]) || []
    const villas = new Map(((villasResult.data as VillaRecord[]) || []).map((villa) => [villa.id, villa.name]))

    if (!bookings.length) {
      return Response.json({ error: 'No bookings found to seed inbox threads.' }, { status: 400 })
    }

    const bookingIds = bookings.map((booking) => booking.id)
    await supabase.from('message_threads').delete().in('booking_id', bookingIds)

    const threads: Array<Omit<MessageThreadRecord, 'id'>> = bookings
      .filter((booking) => booking.villa_id)
      .map((booking, index) => {
        const guestMessage = makeGuestMessage(booking, index)
        const platform = normalizePlatform(booking.source)
        return {
          booking_id: booking.id,
          villa_id: booking.villa_id,
          guest_name: booking.guest_name,
          platform,
          status: index % 3 === 0 ? 'Needs reply' : 'Waiting',
          tag: classifyTag(guestMessage.body),
          notes: booking.notes || (index % 2 === 0 ? 'VIP guest' : 'Prefers fast replies'),
          unread: index % 3 === 0,
          guest_history: index % 4,
          last_message_at: guestMessage.sentAt,
          created_at: guestMessage.sentAt,
          updated_at: guestMessage.sentAt,
        }
      })

    const insertedThreads = await supabase.from('message_threads').insert(threads).select('*')
    if (insertedThreads.error) {
      return Response.json({ error: insertedThreads.error.message }, { status: 500 })
    }

    const threadRows = (insertedThreads.data as MessageThreadRecord[]) || []
    const messages: Array<Omit<MessageRecord, 'id'>> = []

    threadRows.forEach((thread, index) => {
      const booking = bookings.find((item) => item.id === thread.booking_id)
      if (!booking) return

      const guestMessage = makeGuestMessage(booking, index)
      messages.push({
        thread_id: thread.id,
        sender: 'guest',
        body: guestMessage.body,
        sent_at: guestMessage.sentAt,
        created_at: guestMessage.sentAt,
      })

      if (index % 3 !== 0) {
        const hostAt = new Date(new Date(guestMessage.sentAt).getTime() + 50 * 60_000).toISOString()
        messages.push({
          thread_id: thread.id,
          sender: 'host',
          body: `Thanks ${thread.guest_name}, we are sending the details for ${villas.get(thread.villa_id || '') || 'your villa'} now.`,
          sent_at: hostAt,
          created_at: hostAt,
        })
      }
    })

    const insertedMessages = await supabase.from('messages').insert(messages)
    if (insertedMessages.error) {
      return Response.json({ error: insertedMessages.error.message }, { status: 500 })
    }

    return Response.json({
      success: true,
      threads: threadRows.length,
      messages: messages.length,
    })
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
