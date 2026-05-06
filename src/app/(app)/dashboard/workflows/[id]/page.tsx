import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchWorkflow } from '@/lib/workflow/queries'
import { WorkflowEditor } from './WorkflowEditor'
import '../workflows.css'

export const dynamic = 'force-dynamic'

export default async function WorkflowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const workflow = await fetchWorkflow(supabase, user.id, id)
  if (!workflow) notFound()

  // Fetch pipeline stages for if-node and set_stage config
  const { data: stages } = await supabase
    .from('pipeline_stages')
    .select('id, name')
    .eq('user_id', user.id)
    .order('position')

  // Fetch action pages for trigger config
  const { data: actionPages } = await supabase
    .from('action_pages')
    .select('id, title')
    .eq('user_id', user.id)
    .eq('status', 'published')
    .order('title')

  // Fetch leads for test mode
  const { data: leads } = await supabase
    .from('leads')
    .select('id, name, email, phone')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <WorkflowEditor
      workflow={workflow}
      stages={(stages ?? []) as Array<{ id: string; name: string }>}
      actionPages={(actionPages ?? []) as Array<{ id: string; title: string }>}
      leads={(leads ?? []) as Array<{ id: string; name: string | null; email: string | null; phone: string | null }>}
    />
  )
}
