import type { SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_NAME = 'Auto Follow-Up'
const DEFAULT_SLUG = 'auto-followup'

export async function ensureDefaultFolder(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from('media_folders')
    .select('id')
    .eq('user_id', userId)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>()

  if (existing) return existing.id

  const { data: created, error } = await supabase
    .from('media_folders')
    .insert({ user_id: userId, name: DEFAULT_NAME, slug: DEFAULT_SLUG })
    .select('id')
    .single<{ id: string }>()

  if (error || !created) {
    throw new Error('Failed to create default folder')
  }
  return created.id
}
