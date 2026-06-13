import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Append one entry to the admin audit trail (`admin_audit_log`). Call this AFTER
 * a superadmin mutation succeeds, from a route that has already verified the
 * caller is a superadmin (via getSession / requireSuperadmin).
 *
 * `supabase` must be the service-role admin client — the table has no insert RLS
 * policy, mirroring the usage ledger. BEST-EFFORT: a failure here must never undo
 * or fail the mutation it records, so every error is swallowed.
 */
export interface AdminAuditEntry {
  actorId: string
  actorEmail?: string | null
  /** Dotted verb, e.g. 'user.status.set', 'user.tier.set', 'usage.adjust', 'usage.cap.set'. */
  action: string
  targetUserId?: string | null
  detail?: Record<string, unknown>
}

export async function logAdminAction(
  supabase: SupabaseClient,
  entry: AdminAuditEntry,
): Promise<void> {
  try {
    await supabase.from('admin_audit_log').insert({
      actor_id: entry.actorId,
      actor_email: entry.actorEmail ?? null,
      action: entry.action,
      target_user_id: entry.targetUserId ?? null,
      detail: entry.detail ?? {},
    })
  } catch (e) {
    console.error('[admin-audit] log insert failed', { action: entry.action, error: e })
  }
}
