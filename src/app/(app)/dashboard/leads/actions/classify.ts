'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { setAutoClassifyEnabled } from '@/lib/chatbot/config'

export async function setAutoClassifyAction(enabled: boolean): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  await setAutoClassifyEnabled(supabase, user.id, enabled)

  revalidatePath('/dashboard/leads')
  revalidatePath('/dashboard/chatbot')
}
