import { ZodError, type ZodIssue } from 'zod'

// Discriminated result returned by server actions instead of throwing.
//
// Why: Next.js Server Actions mask ANY thrown error in production with an
// opaque digest ("An error occurred in the Server Components render…"), so the
// user never learns what actually went wrong (e.g. an instruction that exceeds
// its length cap). Returning the failure as DATA lets the client show a real,
// actionable message.
export type ActionResult<T> = ({ ok: true } & T) | { ok: false; error: string }

// Human-friendly label for the field a Zod issue points at, so messages read
// "Do rule #2: …" instead of "do_rules.1: …".
function fieldLabel(path: ZodIssue['path']): string {
  const [head, idx, sub] = path
  const n = Number(idx) + 1
  if (head === 'do_rules') return `Do rule #${n}`
  if (head === 'dont_rules') return `Don't rule #${n}`
  if (head === 'stage_instructions') return 'Stage instructions'
  if (head === 'steps') {
    if (sub === 'instruction') return `Step #${n} instruction`
    if (sub === 'fallback_message') return `Step #${n} fallback message`
    if (sub === 'delay_minutes') return `Step #${n} delay`
    return `Step #${n}`
  }
  return path.length ? String(head) : 'Input'
}

// Turn a server-side error into a readable, user-facing message. Handles Zod
// validation errors (the common case) and PostgREST/Error-shaped objects.
export function describeActionError(e: unknown): string {
  if (e instanceof ZodError) {
    const first = e.issues[0]
    return first ? `${fieldLabel(first.path)}: ${first.message}` : 'Invalid input.'
  }
  if (e instanceof Error && e.message.trim()) return e.message
  if (e && typeof e === 'object') {
    const rec = e as { message?: unknown; details?: unknown }
    if (typeof rec.message === 'string' && rec.message.trim()) return rec.message
    if (typeof rec.details === 'string' && rec.details.trim()) return rec.details
  }
  return 'Something went wrong. Please try again.'
}

// `redirect()` works by throwing a sentinel error; an action's try/catch must
// re-throw it so the navigation still happens. Use this guard before mapping a
// caught error to an ActionResult.
export function isRedirectError(e: unknown): boolean {
  return (
    !!e &&
    typeof e === 'object' &&
    typeof (e as { digest?: unknown }).digest === 'string' &&
    (e as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  )
}
