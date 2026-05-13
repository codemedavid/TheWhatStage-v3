'use client'
import { useState, useTransition } from 'react'
import { UpgradePreviewModal } from './UpgradePreviewModal'
import { dismissUpgradeAction, applyUpgradeAction } from '../../actions/upgrade'

export function UpgradeBanner() {
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between">
      <div>
        <div className="font-medium text-amber-900">Upgrade to the smart pipeline</div>
        <div className="text-sm text-amber-800">
          Better stage movement with signal-based detection. Your existing leads stay put.
        </div>
      </div>
      <div className="flex gap-2">
        <button
          className="rounded border border-amber-300 bg-white px-3 py-1.5 text-sm hover:bg-amber-100"
          onClick={() => setOpen(true)}
        >
          Preview changes
        </button>
        <button
          className="rounded bg-amber-900 px-3 py-1.5 text-sm text-white hover:bg-amber-800 disabled:opacity-60"
          disabled={isPending}
          onClick={() => startTransition(() => applyUpgradeAction().then(() => {}))}
        >
          {isPending ? 'Upgrading…' : 'Apply upgrade'}
        </button>
        <button
          className="rounded border border-transparent px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100"
          onClick={() => startTransition(() => dismissUpgradeAction().then(() => {}))}
        >
          Not now
        </button>
      </div>
      {open && <UpgradePreviewModal onClose={() => setOpen(false)} />}
    </div>
  )
}
