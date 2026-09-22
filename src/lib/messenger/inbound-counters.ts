import type { SupabaseClient } from '@supabase/supabase-js'

const PREVIEW_MAX = 200

// Thread-tail preview string stored on messenger_threads for a new inbound.
export function inboundPreview(text: string): string {
  return text.slice(0, PREVIEW_MAX) || '[attachment]'
}

// Atomically bump unread_count + missed_count, refresh the thread tail, and
// stamp `last_inbound_at` when a new inbound message arrives.
//
// The stamp is what the 24h Messenger window is measured from, so it MUST land
// here — at delivery time — and not later in the reply worker: a muted thread
// with auto-classify off never runs a worker at all, and even a live one lags
// by seconds, which is long enough for an operator's reply to be misjudged as
// out-of-window and rejected by Meta. See the 20260922014657 migration.
//
// Best-effort: a failed bump is logged, not thrown. The message is already
// persisted idempotently (unique fb_message_id), and throwing here would only
// trigger a Meta redelivery whose dedup short-circuits before reaching this
// point — so it could never re-bump anyway. A lost stamp degrades to the
// untagged-retry fallback in sendOutbound rather than a failed send.
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
