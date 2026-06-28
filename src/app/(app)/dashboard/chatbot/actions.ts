'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { setPrimaryActionPageId, upsertChatbotConfig } from '@/lib/chatbot/config'

function entries(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
}

function num(s: FormDataEntryValue | null, fallback: number): number {
  if (typeof s !== 'string') return fallback
  const n = Number(s)
  return Number.isFinite(n) ? n : fallback
}

export async function saveChatbotConfig(formData: FormData): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  await upsertChatbotConfig(supabase, user.id, {
    name: String(formData.get('name') ?? ''),
    persona: String(formData.get('persona') ?? ''),
    instructions: String(formData.get('instructions') ?? ''),
    pauseAiInstructions: String(formData.get('pauseAiInstructions') ?? ''),
    doRules: entries(formData, 'doRules'),
    dontRules: entries(formData, 'dontRules'),
    fallbackMessage: String(formData.get('fallbackMessage') ?? ''),
    temperature: num(formData.get('temperature'), 0.4),
    maxContext: num(formData.get('maxContext'), 12),
    virtualSubmissionMode: String(formData.get('virtualSubmissionMode') ?? ''),
    virtualSubmissionInstructions: String(formData.get('virtualSubmissionInstructions') ?? ''),
    chatFillupTemplate: String(formData.get('chatFillupTemplate') ?? ''),
  })

  revalidatePath('/dashboard/chatbot')
}

/**
 * Server action: set or clear the chatbot's primary goal action page.
 * Callable from the chatbot settings page, the action-pages list, and the
 * published-banner. Pass null to clear.
 */
export async function setPrimaryActionPage(
  actionPageId: string | null,
): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  if (actionPageId) {
    const { data: page } = await supabase
      .from('action_pages')
      .select('id, status')
      .eq('id', actionPageId)
      .eq('user_id', user.id)
      .maybeSingle<{ id: string; status: string }>()
    if (!page) throw new Error('action page not found')
    if (page.status !== 'published') throw new Error('action page not published')
  }

  await setPrimaryActionPageId(supabase, user.id, actionPageId)

  revalidatePath('/dashboard/chatbot')
  revalidatePath('/dashboard/action-pages')
}
