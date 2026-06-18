'use client'

import { useRef, useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'

interface Props {
  slug: string
  submitLabel: string
  /**
   * Per-request idempotency key from the server. Rendered as a hidden input so
   * even a no-JS or pre-hydration native POST carries it, and reused by the JS
   * submit handler — both paths dedupe on the same value server-side.
   */
  idempotencyKey: string
  buttonStyle: CSSProperties
  /** Hidden inputs + field blocks, server-rendered and slotted in as children. */
  children: ReactNode
}

/**
 * Client wrapper around the public form. It exists to stop the duplicate
 * submissions seen on form action pages, on two layers:
 *
 *   1. A double-submit guard (`inFlightRef` + `submitting`) disables the button
 *      and ignores re-entrant submits, so an impatient multi-click can't fire
 *      multiple POSTs.
 *   2. An idempotency key generated once per form instance. The submit route
 *      dedupes on `meta->>'idempotency_key'` (unique index
 *      action_page_submissions_idempotency_key_uidx), so even if the same form
 *      is submitted twice (retry, back-button, slow network) only ONE row is
 *      inserted — every retry of the same instance reuses the key.
 *
 * `action`/`method` stay on the <form> so submission still works with JS
 * disabled (progressive enhancement); the handler enhances the JS path.
 */
/**
 * Submit lifecycle. `submitted` is a terminal latched state held while the
 * browser navigates to the thank-you screen, so on a slow network the lead
 * sees an unambiguous "✓ Submitted" confirmation instead of a button stuck on
 * "Submitting…" that invites another tap.
 */
type SubmitState = 'idle' | 'submitting' | 'submitted' | 'error'

export default function FormClient({
  slug,
  submitLabel,
  idempotencyKey,
  buttonStyle,
  children,
}: Props) {
  const [state, setState] = useState<SubmitState>('idle')
  const inFlightRef = useRef(false)

  // `submitted` keeps the lead locked out of re-submitting while we redirect.
  const isBusy = state === 'submitting' || state === 'submitted'

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (inFlightRef.current || isBusy) return

    const form = e.currentTarget
    // Respect native required-field validation before sending.
    if (!form.checkValidity()) {
      form.reportValidity()
      return
    }

    inFlightRef.current = true
    const fd = new FormData(form)
    // Pin the server-provided per-request key so every retry of this load
    // dedupes to one row (set, not append, to collapse any stray duplicate).
    fd.set('idempotency_key', idempotencyKey)

    setState('submitting')
    try {
      const res = await fetch('/api/action-pages/submit', {
        method: 'POST',
        body: fd,
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `submit_failed_${res.status}`)
      }
      const body = (await res.json().catch(() => null)) as
        | { submission_id?: string | null }
        | null
      // Latch the success state so the button reads "✓ Submitted" and stays
      // locked while we mirror the server's native 303 redirect to the
      // thank-you screen.
      setState('submitted')
      const url = new URL(`/a/${slug}`, window.location.href)
      url.searchParams.set('submitted', '1')
      if (body?.submission_id) url.searchParams.set('submission', body.submission_id)
      window.location.assign(url.toString())
      // Release the ref so the guard isn't left dirty if navigation is blocked
      // (e.g. a beforeunload handler); the latched `submitted` state still
      // blocks re-entry via isBusy.
      inFlightRef.current = false
    } catch {
      setState('error')
      inFlightRef.current = false
    }
  }

  return (
    <form
      action="/api/action-pages/submit"
      method="post"
      onSubmit={handleSubmit}
      aria-busy={isBusy}
      className="space-y-4"
    >
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      {/* Disable every field while in flight so the lead can't edit answers
          mid-submit and gets clear visual feedback the form is locked. */}
      <fieldset
        disabled={isBusy}
        className="m-0 min-w-0 space-y-4 border-0 p-0 transition-opacity disabled:opacity-60"
      >
        {children}
      </fieldset>
      {/* Polite live region so screen readers announce the status change. */}
      <p className="sr-only" role="status" aria-live="polite">
        {state === 'submitting'
          ? 'Submitting your response…'
          : state === 'submitted'
            ? 'Response submitted. Redirecting…'
            : ''}
      </p>
      {state === 'error' && (
        <p className="text-[13px] text-red-600" role="alert">
          Something went wrong. Please try again.
        </p>
      )}
      <button
        type="submit"
        disabled={isBusy}
        aria-disabled={isBusy}
        className="flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-[14px] font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
        style={buttonStyle}
      >
        {state === 'submitting' && <Spinner />}
        {state === 'submitting'
          ? 'Submitting…'
          : state === 'submitted'
            ? '✓ Submitted'
            : submitLabel}
      </button>
    </form>
  )
}

/** Inline spinner shown inside the submit button while the POST is in flight. */
function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  )
}
