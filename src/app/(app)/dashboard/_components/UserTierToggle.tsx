'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

type Tier = 'free' | 'pro'

// Free | Pro segmented control for the superadmin users table. Reversible /
// low-stakes, so a single inline confirm step is enough.
export function UserTierToggle({ userId, tier }: { userId: string; tier: Tier }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Tier | null>(null)

  function apply(next: Tier) {
    setError(null)
    setConfirming(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/superadmin/users/${userId}/tier`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tier: next }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null
          setError(body?.error ?? 'Update failed')
          return
        }
        router.refresh()
      } catch {
        setError('Network error')
      }
    })
  }

  function onSegment(next: Tier) {
    if (next === tier || pending) return
    setConfirming(next)
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <div
        className="inline-flex rounded-full border border-neutral-200 bg-neutral-50 p-0.5"
        role="group"
        aria-label="Subscription tier"
      >
        {(['free', 'pro'] as const).map((t) => {
          const active = tier === t
          return (
            <button
              key={t}
              type="button"
              disabled={pending}
              onClick={() => onSegment(t)}
              aria-pressed={active}
              className={
                'rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 ' +
                (active
                  ? t === 'pro'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white text-neutral-800 shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-800')
              }
            >
              {t === 'pro' ? '✦ Pro' : 'Free'}
            </button>
          )
        })}
      </div>

      {confirming && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-neutral-600">
            {confirming === 'pro' ? 'Grant Pro access?' : 'Revoke Pro access?'}
          </span>
          <button
            type="button"
            onClick={() => apply(confirming)}
            className="font-medium text-emerald-700 hover:underline"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => setConfirming(null)}
            className="text-neutral-400 hover:text-neutral-600"
          >
            Cancel
          </button>
        </div>
      )}
      {pending && <span className="text-xs text-neutral-400">Saving…</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}
