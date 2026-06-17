'use client'

import { useRef, useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'

interface Props {
  slug: string
  submitLabel: string
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
export default function FormClient({ slug, submitLabel, buttonStyle, children }: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [hasError, setHasError] = useState(false)
  const inFlightRef = useRef(false)
  // Generated lazily on first submit (an event handler, never during render) so
  // the impure crypto/random calls stay out of the render path. The ref
  // persists across renders, so retries of the same form reuse the key.
  const idempotencyKeyRef = useRef<string>('')

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (inFlightRef.current || submitting) return

    const form = e.currentTarget
    // Respect native required-field validation before sending.
    if (!form.checkValidity()) {
      form.reportValidity()
      return
    }

    inFlightRef.current = true
    const fd = new FormData(form)
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    }
    // set (not append) so the per-instance client key always wins — a hidden
    // idempotency_key field slipping into the form children can't override it.
    fd.set('idempotency_key', idempotencyKeyRef.current)

    setSubmitting(true)
    setHasError(false)
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
      // Mirror the server's native 303 redirect to the thank-you screen. Keep
      // the button latched (no reset) while we navigate away.
      const url = new URL(`/a/${slug}`, window.location.href)
      url.searchParams.set('submitted', '1')
      if (body?.submission_id) url.searchParams.set('submission', body.submission_id)
      window.location.assign(url.toString())
      // Keep the button latched (submitting stays true) while navigating away,
      // but release the ref so the guard isn't left dirty if navigation is
      // blocked (e.g. a beforeunload handler) and the user must retry.
      inFlightRef.current = false
    } catch {
      setHasError(true)
      setSubmitting(false)
      inFlightRef.current = false
    }
  }

  return (
    <form
      action="/api/action-pages/submit"
      method="post"
      onSubmit={handleSubmit}
      className="space-y-4"
    >
      {children}
      {hasError && (
        <p className="text-[13px] text-red-600" role="alert">
          Something went wrong. Please try again.
        </p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md px-3 py-2 text-[14px] font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
        style={buttonStyle}
      >
        {submitting ? 'Submitting…' : submitLabel}
      </button>
    </form>
  )
}
