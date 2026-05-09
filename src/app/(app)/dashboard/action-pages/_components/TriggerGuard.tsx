'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  pageId: string
  initialTrigger: string | null
  backHref: string
  className?: string
  children: ReactNode
  /** Called when user picks "Add now" — let the host switch to the workflow tab/step. */
  onJumpToTrigger?: () => void
}

function readCurrentTriggerFromDOM(initial: string | null): string {
  if (typeof document === 'undefined') return (initial ?? '').trim()
  const el = document.querySelector<HTMLTextAreaElement>(
    'textarea[name="bot_send_instructions"]',
  )
  if (el) return el.value.trim()
  return (initial ?? '').trim()
}

export function TriggerGuard({
  pageId,
  initialTrigger,
  backHref,
  className,
  children,
  onJumpToTrigger,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const skippingRef = useRef(false)

  const hasTriggerNow = useCallback(() => {
    return readCurrentTriggerFromDOM(initialTrigger).length > 0
  }, [initialTrigger])

  // Warn on full-page unload (tab close, hard reload) when no trigger.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (skippingRef.current) return
      if (hasTriggerNow()) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasTriggerNow])

  // Lock body scroll while modal is open.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  function handleBackClick(e: React.MouseEvent) {
    if (hasTriggerNow()) return
    e.preventDefault()
    setError(null)
    setOpen(true)
  }

  function leave() {
    skippingRef.current = true
    setOpen(false)
    router.push(backHref)
  }

  function jumpToTrigger() {
    setOpen(false)
    if (onJumpToTrigger) onJumpToTrigger()
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLTextAreaElement>(
        'textarea[name="bot_send_instructions"]',
      )
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.focus({ preventScroll: true })
      }
    })
  }

  async function autoGenerate() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/action-pages/generate-trigger', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pageId }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'failed')
      }
      router.refresh()
      skippingRef.current = true
      router.push(backHref)
    } catch (err) {
      console.error('[trigger-guard] auto-generate failed', err)
      setError("Couldn't auto-generate. Try again, or add manually.")
      setBusy(false)
    }
  }

  return (
    <>
      <a href={backHref} onClick={handleBackClick} className={className}>
        {children}
      </a>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="trigger-guard-title"
          className="fixed inset-0 z-[80] flex items-end justify-center bg-zinc-900/50 p-4 sm:items-center"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setOpen(false)
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl ring-1 ring-zinc-200">
            <div className="px-5 pt-5 pb-3">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-200">
                  <SparkIcon />
                </div>
                <div className="min-w-0">
                  <h3
                    id="trigger-guard-title"
                    className="text-[15px] font-semibold text-zinc-900"
                  >
                    Add a trigger before you go?
                  </h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-zinc-600">
                    Without a trigger, the bot won&apos;t know when to send this
                    action page in Messenger. We can draft one for you in a
                    second.
                  </p>
                </div>
              </div>

              {error && (
                <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-800">
                  {error}
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-zinc-100 bg-zinc-50/60 px-5 py-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={leave}
                disabled={busy}
                className="rounded-md px-3 py-2 text-[13px] font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50"
              >
                Skip and leave
              </button>
              <button
                type="button"
                onClick={jumpToTrigger}
                disabled={busy}
                className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-[13px] font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
              >
                Add it now
              </button>
              <button
                type="button"
                onClick={autoGenerate}
                disabled={busy}
                className="inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-[13px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {busy ? (
                  <>
                    <Spinner /> Generating…
                  </>
                ) : (
                  <>
                    <SparkIcon size={14} /> Auto-generate
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function SparkIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />
      <path d="M19 14l.7 2 2 .7-2 .7L19 19l-.7-1.6L16.6 17l1.7-.6z" />
    </svg>
  )
}

function Spinner() {
  return (
    <svg
      className="animate-spin"
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}
