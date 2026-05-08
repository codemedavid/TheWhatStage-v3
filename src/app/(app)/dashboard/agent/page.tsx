import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AgentClient } from './_components/AgentClient'
import type { TemplateButton } from '@/lib/messenger-templates/types'

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

  // Approved utility templates available for shared-template campaigns.
  const { data: tplData } = await supabase
    .from('messenger_message_templates')
    .select('id, display_name, name, language, body_text, variable_count, buttons')
    .eq('user_id', user.id)
    .eq('meta_status', 'approved')
    .order('display_name', { ascending: true })

  const templates = (tplData ?? []).map((t) => ({
    id: t.id as string,
    display_name: t.display_name as string,
    name: t.name as string,
    language: t.language as string,
    body_text: t.body_text as string,
    variable_count: t.variable_count as number,
    buttons: (t.buttons as TemplateButton[]) ?? [],
  }))

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

  return <AgentClient stages={stages} templates={templates} actionPages={actionPages} />
}
