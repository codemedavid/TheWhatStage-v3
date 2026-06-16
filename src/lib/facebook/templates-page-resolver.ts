// Resolve the Facebook page (+ encrypted page access token) to use when
// submitting or polling message templates for a given user.
//
// Lifted out of dashboard/templates/actions.ts so it can be shared by:
//   - the bulk submit/refresh server actions (resolve once per batch), and
//   - /api/cron/template-status-poll (which has no requireUser() session).
//
// Reads through the admin client because RLS on facebook_pages joins through
// facebook_connections and would block a user-scoped client from reading the
// encrypted page_access_token directly.

import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export interface ResolvedPage {
  id: string
  fb_page_id: string
  page_access_token: string
}

/**
 * Resolve a target page for a user: the preferred page when given and owned by
 * the user, otherwise their earliest-connected page. Returns null when the
 * user has no connected page.
 */
export async function resolveTargetPage(
  admin: AdminClient,
  userId: string,
  preferredPageId: string | null,
): Promise<ResolvedPage | null> {
  if (preferredPageId) {
    const { data } = await admin
      .from('facebook_pages')
      .select('id, fb_page_id, page_access_token, facebook_connections!inner(user_id)')
      .eq('id', preferredPageId)
      .eq('facebook_connections.user_id', userId)
      .maybeSingle<ResolvedPage & { facebook_connections: unknown }>()
    if (data) {
      return { id: data.id, fb_page_id: data.fb_page_id, page_access_token: data.page_access_token }
    }
  }
  const { data } = await admin
    .from('facebook_pages')
    .select('id, fb_page_id, page_access_token, facebook_connections!inner(user_id)')
    .eq('facebook_connections.user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle<ResolvedPage & { facebook_connections: unknown }>()
  if (!data) return null
  return { id: data.id, fb_page_id: data.fb_page_id, page_access_token: data.page_access_token }
}
