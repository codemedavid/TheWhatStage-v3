'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { generateApiKey } from '@/lib/api-keys/generate'
import {
  describeActionError,
  isRedirectError,
  type ActionResult,
  type VoidActionResult,
} from '@/app/(app)/dashboard/projects/_lib/action-result'

const SETTINGS_PATH = '/dashboard/settings/api-keys'
const MAX_ACTIVE_KEYS = 10

const keyNameSchema = z.string().trim().min(1, 'Give the key a name.').max(60, 'Name must be 60 characters or fewer.')

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

// Mint a key. The plaintext is returned exactly once; only its hash is stored.
export async function createApiKey(rawName: unknown): Promise<ActionResult<{ plaintext: string }>> {
  const parsed = keyNameSchema.safeParse(rawName)
  if (!parsed.success) return { ok: false, error: describeActionError(parsed.error) }
  const { supabase, userId } = await requireUser()
  try {
    const { count, error: countErr } = await supabase
      .from('api_keys').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).is('revoked_at', null)
    if (countErr) throw countErr
    if ((count ?? 0) >= MAX_ACTIVE_KEYS) {
      return { ok: false, error: `You can have at most ${MAX_ACTIVE_KEYS} active keys. Revoke one first.` }
    }

    const key = generateApiKey()
    const { error } = await supabase.from('api_keys').insert({
      user_id: userId,
      name: parsed.data,
      key_prefix: key.prefix,
      key_hash: key.hash,
    })
    if (error) throw error
    revalidatePath(SETTINGS_PATH)
    return { ok: true, plaintext: key.plaintext }
  } catch (e) {
    if (isRedirectError(e)) throw e
    return { ok: false, error: describeActionError(e) }
  }
}

export async function revokeApiKey(rawId: unknown): Promise<VoidActionResult> {
  const parsed = z.string().uuid().safeParse(rawId)
  if (!parsed.success) return { ok: false, error: 'Invalid key id.' }
  const { supabase, userId } = await requireUser()
  try {
    const { error } = await supabase
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', parsed.data).eq('user_id', userId).is('revoked_at', null)
    if (error) throw error
    revalidatePath(SETTINGS_PATH)
    return { ok: true }
  } catch (e) {
    if (isRedirectError(e)) throw e
    return { ok: false, error: describeActionError(e) }
  }
}
