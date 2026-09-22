import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// Registration side of push: which devices belong to which operator.
//
// A token identifies an app install, not a person — `unique(token)` in the
// schema enforces that — so the row moves when a different operator signs in on
// the same handset. Getting that wrong would keep delivering one operator's
// customer messages to another's phone.

export const PUSH_PLATFORMS = ['ios', 'android'] as const
export type PushPlatform = (typeof PUSH_PLATFORMS)[number]

export function isPushPlatform(value: unknown): value is PushPlatform {
  return typeof value === 'string' && (PUSH_PLATFORMS as readonly string[]).includes(value)
}

/** Postgres unique-violation. */
const UNIQUE_VIOLATION = '23505'

export interface RegisterPushDeviceInput {
  userId: string
  token: string
  platform: PushPlatform
  deviceName?: string | null
}

type DbError = { code?: string; message: string } | null
type EnabledRow = { enabled: boolean } | null

function fail(action: string, error: NonNullable<DbError>): never {
  throw new Error(`[push.devices] ${action} failed: ${error.message}`)
}

/**
 * Claim this device for `userId`. Returns the row's mute state so the app can
 * render its notifications toggle truthfully after a restart — the write
 * already round-trips, so reading it back costs nothing extra.
 */
export async function registerPushDevice(
  admin: SupabaseClient,
  { userId, token, platform, deviceName }: RegisterPushDeviceInput,
): Promise<{ enabled: boolean }> {
  const { data: existing } = await admin
    .from('push_devices')
    .select('id, user_id')
    .eq('token', token)
    .maybeSingle<{ id: string; user_id: string }>()

  const base = {
    user_id: userId,
    platform,
    device_name: deviceName ?? null,
    last_seen_at: new Date().toISOString(),
  }

  if (!existing) {
    const { data, error } = (await admin
      .from('push_devices')
      .insert({ ...base, token })
      .select('enabled')
      .maybeSingle()) as { data: EnabledRow; error: DbError }
    if (!error) return { enabled: data?.enabled ?? true }
    // Another launch of the same app registered between our read and write.
    // The row exists now, so continue as an update instead of 500-ing.
    if (error.code !== UNIQUE_VIOLATION) fail('insert', error)

    const { data: raced, error: raceErr } = (await admin
      .from('push_devices')
      .update(base)
      .eq('token', token)
      .select('enabled')
      .maybeSingle()) as { data: EnabledRow; error: DbError }
    if (raceErr) fail('update-after-race', raceErr)
    return { enabled: raced?.enabled ?? true }
  }

  // A handover to a different operator clears the previous owner's mute —
  // otherwise the new signed-in user would silently get nothing.
  const patch = existing.user_id === userId ? base : { ...base, enabled: true }
  const { data, error } = (await admin
    .from('push_devices')
    .update(patch)
    .eq('id', existing.id)
    .select('enabled')
    .maybeSingle()) as { data: EnabledRow; error: DbError }
  if (error) fail('update', error)
  return { enabled: data?.enabled ?? true }
}

export async function unregisterPushDevice(
  admin: SupabaseClient,
  { userId, token }: { userId: string; token: string },
): Promise<void> {
  const { error } = (await admin
    .from('push_devices')
    .delete()
    .eq('token', token)
    .eq('user_id', userId)) as { error: DbError }
  if (error) fail('delete', error)
}

export async function setPushDeviceEnabled(
  admin: SupabaseClient,
  { userId, token, enabled }: { userId: string; token: string; enabled: boolean },
): Promise<void> {
  const { error } = (await admin
    .from('push_devices')
    .update({ enabled })
    .eq('token', token)
    .eq('user_id', userId)) as { error: DbError }
  if (error) fail('toggle', error)
}
