'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

type Kind = 'credit' | 'adjust' | 'reset'

/**
 * Superadmin control to correct a tenant's metered usage via the append-only
 * usage_adjustments ledger (the frozen event ledger is never touched).
 *  - credit : reduce usage by N tokens (goodwill)
 *  - adjust : add N tokens (manual correction; can be negative)
 *  - reset  : zero this month's net usage
 * Every action requires a reason and is recorded in admin_audit_log.
 */
export function UsageAdjustForm({ userId }: { userId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [kind, setKind] = useState<Kind>('credit')
  const [tokens, setTokens] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  function submit() {
    setError(null)
    setOk(false)
    if (reason.trim() === '') {
      setError('A reason is required.')
      return
    }
    let deltaTokens: number | undefined
    if (kind !== 'reset') {
      const n = Number(tokens.trim())
      if (!Number.isInteger(n) || n <= 0) {
        setError('Enter a positive whole number of tokens.')
        return
      }
      // credit reduces usage; adjust adds (use a negative value to subtract).
      deltaTokens = kind === 'credit' ? -n : n
    }
    startTransition(async () => {
      try {
        const res = await fetch(`/api/superadmin/users/${userId}/adjust`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind, deltaTokens, reason: reason.trim() }),
        })
        if (!res.ok) {
          const b = (await res.json().catch(() => null)) as { error?: string } | null
          setError(b?.error ?? 'Adjustment failed')
          return
        }
        setTokens('')
        setReason('')
        setOk(true)
        router.refresh()
      } catch {
        setError('Network error')
      }
    })
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-[12px] font-medium text-neutral-600">Action</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
            disabled={pending}
            className="mt-1 rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-60"
          >
            <option value="credit">Credit (reduce)</option>
            <option value="adjust">Adjust (add)</option>
            <option value="reset">Reset month to 0</option>
          </select>
        </div>
        {kind !== 'reset' && (
          <div>
            <label className="block text-[12px] font-medium text-neutral-600">Tokens</label>
            <input
              type="number"
              min={1}
              value={tokens}
              onChange={(e) => setTokens(e.target.value)}
              disabled={pending}
              className="mt-1 w-40 rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm tabular-nums focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-60"
            />
          </div>
        )}
      </div>
      <div>
        <label className="block text-[12px] font-medium text-neutral-600">Reason</label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder="e.g. goodwill credit for outage"
          disabled={pending}
          className="mt-1 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-60"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
        >
          {pending ? 'Applying…' : 'Apply adjustment'}
        </button>
        {ok && <span className="text-[12px] text-emerald-600">Recorded.</span>}
        {error && <span className="text-[12px] text-red-600">{error}</span>}
      </div>
    </div>
  )
}
