import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AgentClient } from './_components/AgentClient'
import { AGENT_TEMPLATE_SELECT, mapAgentTemplate } from '@/lib/messenger-templates/projection'

export const dynamic = 'force-dynamic'

export default async function AgentPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const sp = await searchParams
  const initialTemplateId = typeof sp.template === 'string' ? sp.template : null
  const initialMode =
    sp.mode === 'shared_template' || sp.mode === 'per_lead_ai' ? sp.mode : null

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

  // Approved utility templates available for shared-template campaigns —
  // shared projection so this stays in sync with the Templates loader.
  const { data: tplData } = await supabase
    .from('messenger_message_templates')
    .select(AGENT_TEMPLATE_SELECT)
    .eq('user_id', user.id)
    .eq('meta_status', 'approved')
    .order('display_name', { ascending: true })

  const templates = (tplData ?? []).map((t) => mapAgentTemplate(t as unknown as Record<string, unknown>))

  // How many templates are still awaiting Meta approval — drives the empty-state
  // nudge back to the Templates page.
  const { count: pendingApprovalCount } = await supabase
    .from('messenger_message_templates')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('meta_status', 'pending')

  const { data: catData } = await supabase
    .from('template_categories')
    .select('id, slug, label, is_system, sort_order')
    .order('is_system', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true })
  const categories = (catData ?? []) as Array<{ id: string; slug: string; label: string; is_system: boolean; sort_order: number }>

  // Published action pages — shown as optional button targets for templates
  // that have a URL button slot.
  const { data: pageData } = await supabase
    .from('action_pages')
    .select('id, title, slug, kind')
    .eq('user_id', user.id)
    .eq('status', 'published')
    .order('title', { ascending: true })

  const actionPages = (pageData ?? []).map((p) => ({
    id: p.id as string,
    title: p.title as string,
    slug: p.slug as string,
    kind: p.kind as string,
  }))

  return (
    <AgentClient
      stages={stages}
      templates={templates}
      actionPages={actionPages}
      categories={categories}
      pendingApprovalCount={pendingApprovalCount ?? 0}
      initialTemplateId={initialTemplateId}
      initialMode={initialMode}
    />
  )
}
