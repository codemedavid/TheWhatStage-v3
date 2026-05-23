import 'server-only'
import { canonicalHash } from './hash'
import { KINDS, type KindInput } from './kinds'
import { enqueueRunning, markDone, markFailed } from './repo'
import type { GenerationKind } from './types'

/**
 * Run an AI generation in the background. Writes status to generation_jobs.
 * Atomically conditional via the onboarding_enqueue_generation RPC: two
 * concurrent calls won't both run the LLM, and a finished job won't be
 * clobbered back to 'running' by a late-arriving duplicate request.
 * Never throws — errors are persisted as status='failed' on the job row.
 */
export async function runGeneration<K extends GenerationKind>(
  profileId: string,
  kind: K,
  input: KindInput<K>,
): Promise<void> {
  try {
    const hash = canonicalHash(input)
    const state = await enqueueRunning(profileId, kind, hash)
    if (state !== 'enqueued') return
    const handler = KINDS[kind] as { run: (i: KindInput<K>) => Promise<unknown> }
    let result: unknown
    let llmError: string | undefined
    try {
      result = await handler.run(input)
    } catch (err) {
      llmError = err instanceof Error ? err.message : String(err)
    }
    if (llmError !== undefined) {
      try {
        await markFailed(profileId, kind, hash, llmError)
      } catch (markErr) {
        console.error('[generation.runner] markFailed write error', markErr)
      }
    } else {
      try {
        await markDone(profileId, kind, hash, result)
      } catch (markErr) {
        console.error('[generation.runner] markDone write error', markErr)
        // Row stays 'running'; stale sweep converts it to 'failed' after 90 s.
      }
    }
  } catch (err) {
    console.error('[generation.runner]', err)
  }
}
