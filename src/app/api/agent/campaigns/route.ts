import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
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

  const { data, error } = await admin
    .from('agent_campaigns')
    .select('id, command_text, status, total, sent, failed, skipped, created_at, dispatched_at, completed_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ campaigns: data ?? [] })
}
