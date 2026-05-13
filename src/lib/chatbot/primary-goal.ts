import type { SupabaseClient } from '@supabase/supabase-js'
import { publicActionPageUrl } from '@/lib/action-pages/urls'

interface ConfigRow {
  primary_action_page_id: string | null
}

interface PageRow {
  title: string
  slug: string
  bot_send_instructions: string | null
  status: string
}

/**
 * Returns a fully-formatted "primary goal" instruction block for the system
 * prompt, or null when no goal is set / the page was deleted / the page is
 * not currently published.
 */
export async function loadPrimaryGoalInstruction(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data: cfg, error: cErr } = await supabase
    .from('chatbot_configs')
    .select('primary_action_page_id')
    .eq('user_id', userId)
    .maybeSingle<ConfigRow>()
  if (cErr) throw new Error(`loadPrimaryGoalInstruction config: ${cErr.message}`)
  if (!cfg?.primary_action_page_id) return null

  const { data: page, error: pErr } = await supabase
    .from('action_pages')
    .select('title, slug, bot_send_instructions, status')
    .eq('id', cfg.primary_action_page_id)
    .eq('status', 'published')
    .maybeSingle<PageRow>()
  if (pErr) throw new Error(`loadPrimaryGoalInstruction page: ${pErr.message}`)
  if (!page) return null

  const trigger = page.bot_send_instructions?.trim()
  const lines = [
    'Your primary goal is to guide the conversation toward sharing this page with the customer when it fits naturally:',
    '',
    `Page: ${page.title}`,
    `Link: ${publicActionPageUrl(page.slug)}`,
  ]
  if (trigger) {
    lines.push('', 'When to send / what to say:', trigger)
  }
  lines.push(
    '',
    "Continue answering the customer's actual questions first. When the conversation is open-ended, winding down, or the customer asks generally about what you offer, steer toward this page. Do not force it if the customer's intent clearly points elsewhere.",
  )
  return lines.join('\n')
}
