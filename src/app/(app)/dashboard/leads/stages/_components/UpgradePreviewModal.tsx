'use client'
import { useEffect, useState, useTransition } from 'react'
import { getUpgradePreview, applyUpgradeAction } from '../../actions/upgrade'

type Plan = Awaited<ReturnType<typeof getUpgradePreview>>

export function UpgradePreviewModal({ onClose }: { onClose: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [isPending, startTransition] = useTransition()
  useEffect(() => { getUpgradePreview().then(setPlan) }, [])

  if (!plan) return null

  const enrich = plan.operations.filter((op) => op.kind === 'enrich')
  const add = plan.operations.filter((op) => op.kind === 'add')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Smart pipeline upgrade preview</h2>

        <section className="mt-4">
          <h3 className="font-medium">Stages added ({add.length})</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {add.map((op) => (
              <li key={op.defaultStageName}>
                <strong>{op.defaultStageName}</strong>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-4">
          <h3 className="font-medium">Stages enriched ({enrich.length})</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {enrich.map((op) => (
              <li key={op.stageId} className="rounded border p-2">
                <div className="font-medium">{op.newName}</div>
                <div className="text-xs text-gray-500">kind: {op.newKind}</div>
                <div className="mt-1 text-xs">{op.newDescription}</div>
                <div className="mt-1 text-xs">
                  <strong>Entry signals:</strong> {op.newEntrySignals.length} added
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-4 rounded bg-gray-50 p-3 text-sm">
          <strong>Custom stages preserved:</strong> {plan.preservedCustomStageIds.length}
          <br />
          <strong>Leads that will move:</strong> 0 — every existing lead stays in its current stage.
        </section>

        <div className="mt-6 flex justify-end gap-2">
          <button className="rounded border px-3 py-1.5 text-sm" onClick={onClose}>Cancel</button>
          <button
            className="rounded bg-amber-900 px-3 py-1.5 text-sm text-white disabled:opacity-60"
            disabled={isPending}
            onClick={() => startTransition(() => applyUpgradeAction().then(onClose))}
          >
            {isPending ? 'Upgrading…' : 'Apply upgrade'}
          </button>
        </div>
      </div>
    </div>
  )
}
