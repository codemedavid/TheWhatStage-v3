'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Superadmin control to set or clear a tenant's per-user soft-cap override
 * (in tokens). Empty + Save, or Clear, reverts to the tier's cap. Display-only —
 * nothing is enforced.
 */
export function CapOverrideForm({
  userId,
  currentOverride,
  tierCap,
}: {
  userId: string
  currentOverride: number | null
  tierCap: number | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [value, setValue] = useState(currentOverride != null ? String(currentOverride) : '')
  const [error, setError] = useState<string | null>(null)

  function submit(override: number | null) {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/superadmin/users/${userId}/cap`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ includedTokensOverride: override }),
        })
        if (!res.ok) {
          const b = (await res.json().catch(() => null)) as { error?: string } | null
          setError(b?.error ?? 'Update failed')
          return
        }
        router.refresh()
      } catch {
        setError('Network error')
      }
    })
  }

  function onSave() {
    const trimmed = value.trim()
    if (trimmed === '') return submit(null)
    const num = Number(trimmed)
    if (!Number.isInteger(num) || num < 0) {
      setError('Enter a whole number of tokens (or clear).')
      return
    }
    submit(num)
  }

  return (
    <div className="space-y-2">
      <label className="block text-[12px] font-medium text-neutral-600">
        Monthly token cap override
      </label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={tierCap != null ? `tier default: ${tierCap.toLocaleString('en-US')}` : 'no cap'}
          disabled={pending}
          className="w-48 rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm tabular-nums focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={onSave}
          disabled={pending}
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        {currentOverride != null && (
          <button
            type="button"
            onClick={() => {
              setValue('')
              submit(null)
            }}
            disabled={pending}
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-60"
          >
            Clear
          </button>
        )}
      </div>
      <p className="text-[12px] text-neutral-400">
        {currentOverride != null
          ? `Overriding the tier cap with ${currentOverride.toLocaleString('en-US')} tokens.`
          : 'Using the tier cap. Set a value to override for this tenant only.'}
      </p>
      {error && <p className="text-[12px] text-red-600">{error}</p>}
    </div>
  )
}
