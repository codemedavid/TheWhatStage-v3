import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hasPersonalizationTags, personalize } from '@/lib/agent/personalize'

// Saved messages may carry the campaign merge tags ([first_name], [name],
// [last_name]). Both mobile send routes — plain text and action-page button —
// render them against the recipient, so the lookup lives here rather than
// being copy-pasted per route.

/**
 * Render merge tags in `text` for one lead. Returns `text` untouched when it
 * has no tags (no lead read) or when the lead cannot be read, which is the
 * safe direction: `personalize` still substitutes its own NAME_FALLBACK, so a
 * literal `[first_name]` can never reach a customer.
 */
export async function personalizeForLead(
  admin: SupabaseClient,
  userId: string,
  leadId: string,
  text: string,
): Promise<string> {
  if (!hasPersonalizationTags(text)) return text
  const { data: lead } = await admin
    .from('leads')
    .select('name')
    .eq('id', leadId)
    .eq('user_id', userId)
    .maybeSingle<{ name: string | null }>()
  return personalize(text, { name: lead?.name ?? null })
}
