import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: campaignId } = await params

  const supabase = await createClient()
  const claims = await supabase.auth.getClaims()
  let userId: string | undefined = claims.data?.claims?.sub
  if (!userId) {
    const { data } = await supabase.auth.getUser()
    userId = data.user?.id
  }
  if (!userId) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Verify ownership.
  const { data: campaign } = await admin
    .from('agent_campaigns')
    .select('id')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .maybeSingle<{ id: string }>()

  if (!campaign) {
    return Response.json({ error: 'campaign not found' }, { status: 404 })
  }

  const { data, error } = await admin
    .from('agent_campaign_messages')
    .select(`
      id,
      lead_id,
      draft_text,
      policy_at_preview,
      policy_at_send,
      user_edited,
      status,
      skip_reason,
      error,
      attempts,
      sent_at,
      created_at,
      leads ( name )
    `)
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ messages: data ?? [] })
}
