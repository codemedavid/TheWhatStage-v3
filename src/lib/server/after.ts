import { after } from 'next/server'

/**
 * Run bookkeeping once the response has been flushed to the client.
 *
 * Next's `after()` only exists inside a request scope; in unit tests and
 * standalone scripts it throws. There we fall back to awaiting the work inline
 * so the side effects still happen — just on the hot path, which is exactly
 * the old behaviour.
 *
 * The callback's own failures are swallowed with a log: deferred work runs
 * after the status code is already committed, so throwing can only produce an
 * unhandled rejection, never a useful error for the caller.
 */
export async function afterResponse(label: string, work: () => Promise<void>): Promise<void> {
  const guarded = async () => {
    try {
      await work()
    } catch (err) {
      console.error(`[after:${label}]`, err)
    }
  }
  try {
    after(guarded)
  } catch {
    await guarded()
  }
}
