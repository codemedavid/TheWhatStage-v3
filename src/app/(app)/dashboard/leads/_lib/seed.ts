import type { SupabaseClient } from '@supabase/supabase-js'
import { revalidateTag } from 'next/cache'
import { DEFAULT_STAGES } from './defaults'
import { stagesTag } from './queries'

export async function seedDefaultStagesIfEmpty(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { count, error: countErr } = await supabase
    .from('pipeline_stages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  if (countErr) throw countErr
  if ((count ?? 0) > 0) return

  const rows = DEFAULT_STAGES.map((s, i) => ({
    user_id: userId,
    name: s.name,
    description: s.description,
    position: i,
    is_default: s.isDefault,
  }))

  const { error } = await supabase.from('pipeline_stages').insert(rows)
  if (error) throw error
  revalidateTag(stagesTag(userId), 'max')
}
