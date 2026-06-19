import type { SupabaseClient } from '@supabase/supabase-js'

const PREVIEW_MAX = 200

// Thread-tail preview string stored on messenger_threads for a new inbound.
export function inboundPreview(text: string): string {
  return text.slice(0, PREVIEW_MAX) || '[attachment]'
}

// Atomically bump unread_count + missed_count and refresh the thread tail when
// a new inbound message arrives. Best-effort: a failed bump is logged, not
// thrown. The message is already persisted idempotently (unique fb_message_id),
// and throwing here would only trigger a Meta redelivery whose dedup
// short-circuits before reaching this point — so it could never re-bump anyway.
export async function bumpThreadOnInbound(
  admin: SupabaseClient,
  threadId: string,
  text: string,
): Promise<void> {
  const { error } = await admin.rpc('increment_thread_counters', {
    p_thread_id: threadId,
    p_preview: inboundPreview(text),
  })
  if (error) {
    console.warn(`[fb.webhook] counter bump failed for thread ${threadId}: ${error.message}`)
  }
}
