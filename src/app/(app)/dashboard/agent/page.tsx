import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AgentClient } from './_components/AgentClient'

export const dynamic = 'force-dynamic'

export default async function AgentPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Load pipeline stages so the UI can show them as audience hints.
  const { data: stagesData } = await supabase
    .from('pipeline_stages')
    .select('id, name')
    .eq('user_id', user.id)
    .order('position', { ascending: true })

  const stages = (stagesData ?? []).map((s) => ({
    id: s.id as string,
    name: s.name as string,
  }))

  return <AgentClient stages={stages} />
}
