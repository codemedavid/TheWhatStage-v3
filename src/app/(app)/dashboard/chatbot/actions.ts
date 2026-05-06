'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { upsertChatbotConfig } from '@/lib/chatbot/config'

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
    doRules: entries(formData, 'doRules'),
    dontRules: entries(formData, 'dontRules'),
    fallbackMessage: String(formData.get('fallbackMessage') ?? ''),
    temperature: num(formData.get('temperature'), 0.4),
    maxContext: num(formData.get('maxContext'), 12),
    autoClassifyEnabled: formData.get('autoClassifyEnabled') === 'on',
  })

  revalidatePath('/dashboard/chatbot')
}
