import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_STAGES } from './defaults'

export async function seedDefaultStagesIfEmpty(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { count, error: countErr } = await supabase
    .from('pipeline_stages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  if (countErr) throw countErr
  if ((count ?? 0) > 0) return false

  const rows = DEFAULT_STAGES.map((s, i) => ({
    user_id: userId,
    name: s.name,
    description: s.description,
    position: i,
    is_default: s.isDefault,
    kind: s.kind,
    is_won: s.kind === 'won',
    is_lost: s.kind === 'lost',
    is_terminal: s.kind === 'won' || s.kind === 'lost',
  }))

  const { error } = await supabase.from('pipeline_stages').insert(rows)
  if (error) throw error
  return true
}
