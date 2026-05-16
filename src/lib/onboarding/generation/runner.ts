import 'server-only'
import { canonicalHash } from './hash'
import { KINDS, type KindInput } from './kinds'
import { getJob, upsertRunning, markDone, markFailed } from './repo'
import type { GenerationKind } from './types'

/**
 * Run an AI generation in the background. Writes status to generation_jobs.
 * Idempotent: re-running with the same input short-circuits.
 * Never throws — errors are persisted as status='failed' on the job row.
 */
export async function runGeneration<K extends GenerationKind>(
  profileId: string,
  kind: K,
  input: KindInput<K>,
): Promise<void> {
  try {
    const hash = canonicalHash(input)
    const existing = await getJob(profileId, kind)
    if (existing?.status === 'done' && existing.input_hash === hash) return

    await upsertRunning(profileId, kind, hash)
    try {
      const handler = KINDS[kind] as { run: (i: KindInput<K>) => Promise<unknown> }
      const result = await handler.run(input)
      await markDone(profileId, kind, hash, result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await markFailed(profileId, kind, hash, message)
    }
  } catch (err) {
    console.error('[generation.runner]', err)
  }
}
