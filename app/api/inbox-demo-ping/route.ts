import { supabase } from '@/lib/supabase'
import type { MessageRecord, MessageThreadRecord } from '@/lib/types'

const DEMO_MESSAGES = [
  'Hi again, can we do an early check-in if our flight lands before noon?',
  'Can you confirm the WiFi password before we arrive tonight?',
  'One more question: is airport pickup still available for this booking?',
  'We may arrive late. Is self check-in possible after 10 PM?',
]

export async function POST() {
  try {
    const threadResult = await supabase
      .from('message_threads')
      .select('*')
      .order('last_message_at', { ascending: false })
      .limit(1)
      .single()

    if (threadResult.error || !threadResult.data) {
      return Response.json(
        { error: threadResult.error?.message || 'No message thread found.' },
        { status: 500 }
      )
    }

    const thread = threadResult.data as MessageThreadRecord
    const sentAt = new Date().toISOString()
    const messageBody =
      DEMO_MESSAGES[Math.floor(Math.random() * DEMO_MESSAGES.length)]

    const messageResult = await supabase
      .from('messages')
      .insert({
        thread_id: thread.id,
        sender: 'guest',
        body: messageBody,
        sent_at: sentAt,
      })
      .select('*')
      .single()

    if (messageResult.error || !messageResult.data) {
      return Response.json(
        { error: messageResult.error?.message || 'Failed to insert demo message.' },
        { status: 500 }
      )
    }

    const updatedThreadResult = await supabase
      .from('message_threads')
      .update({
        unread: true,
        status: 'Needs reply',
        last_message_at: sentAt,
        updated_at: sentAt,
      })
      .eq('id', thread.id)
      .select('*')
      .single()

    if (updatedThreadResult.error || !updatedThreadResult.data) {
      return Response.json(
        { error: updatedThreadResult.error?.message || 'Failed to update thread.' },
        { status: 500 }
      )
    }

    return Response.json({
      success: true,
      threadId: thread.id,
      message: messageResult.data as MessageRecord,
    })
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
