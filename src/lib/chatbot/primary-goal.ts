import type { SupabaseClient } from '@supabase/supabase-js'

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
    `PRIMARY GOAL — Page: "${page.title}"`,
    'Your long-term goal is to steer the conversation toward this page so the customer ends up tapping its button. The page appears in the "Action pages" list below; when you decide to send it, you MUST do so by setting `action_page.action_page_id` to that page\'s id — the system will then deliver the button card as a SEPARATE message automatically.',
    '',
    'NEVER paste the page URL, slug, or any link to it in `reply`. NEVER tell the customer "here\'s the link", "check this page", "tingnan mo \'to", or anything similar in `reply` — the button arrives on its own.',
  ]
  if (trigger) {
    lines.push(
      '',
      'Send when the customer\'s latest message matches this trigger AND every qualifying prerequisite below has been answered:',
      trigger,
      '',
      'QUALIFY FIRST: Read the trigger above literally. If it names prerequisites — e.g. "ask the customer\'s X first", "only after they share Y", "make sure Z is collected", "kapag nasagot na ang … bago", or any similar wording in any language — those are required questions you MUST ask BEFORE sending. Until every one of them is answered in the conversation history, leave `action_page` null and ask the next missing qualifying question in `reply` (one at a time, in the customer\'s language). Do not re-ask anything they already answered.',
      '',
      'ONCE QUALIFIED: Once every prerequisite above has been answered AND the customer\'s latest message shows any signal of wanting to proceed (asking how, agreeing, saying "sige"/"okay"/"magkano"/"sign me up"/"book na"/equivalents in any language, or any forward intent), you MUST set `action_page.action_page_id` to this page on this turn. Do not stall with another qualifying question. Do not wait for a more explicit ask. The button arrives as a separate message — your `reply` stays conversational.',
    )
  } else {
    lines.push(
      '',
      'Send only when the customer\'s latest message clearly signals readiness for this page (a question it answers, an explicit ask, or a clear buying signal). If you are missing the basic info needed to know this page is the right fit, ask a qualifying question first instead of sending.',
    )
  }
  lines.push(
    '',
    "Until the trigger AND its prerequisites are all met, just answer the customer's actual question and gently nurture interest — do not force the page. When everything is met, set `action_page.action_page_id` to this page in the Action Pages list and write a short conversational `reply` that does NOT reference the link or button.",
  )
  return lines.join('\n')
}
