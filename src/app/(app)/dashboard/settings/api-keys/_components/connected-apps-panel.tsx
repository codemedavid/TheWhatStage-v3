'use client'

import { useState, useTransition } from 'react'
import { revokeConnectedApp } from '../actions'

export interface ConnectedAppItem {
  clientId: string
  clientName: string
  scopes: string[]
  connectedAt: string
  lastUsedAt: string | null
}

const CARD = 'rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]'
const BUTTON_QUIET =
  'inline-flex items-center rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-[12px] font-medium text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-50'

function formatDate(iso: string | null): string {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleString()
}

export function ConnectedAppsPanel({ apps }: { apps: ConnectedAppItem[] }) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleDisconnect(clientId: string) {
    setError(null)
    startTransition(async () => {
      const result = await revokeConnectedApp(clientId)
      if (!result.ok) setError(result.error)
    })
  }

  return (
    <div className={CARD}>
      <h3 className="text-[14px] font-semibold text-[#111827]">Connected apps</h3>
      <p className="mt-1 text-[13px] text-[#6B7280]">
        Apps you approved through the sign-in flow. Disconnecting signs them out immediately.
      </p>
      {apps.length === 0 ? (
        <p className="mt-3 text-[13px] text-[#6B7280]">Nothing connected yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-[#F3F4F6]">
          {apps.map((app) => (
            <li key={app.clientId} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-[#111827]">{app.clientName}</p>
                <p className="mt-0.5 text-[12px] text-[#9CA3AF]">
                  Connected {formatDate(app.connectedAt)} · Last used {formatDate(app.lastUsedAt)} · Access:{' '}
                  {app.scopes.join(', ') || 'none'}
                </p>
              </div>
              <button
                type="button"
                className={BUTTON_QUIET}
                disabled={isPending}
                onClick={() => handleDisconnect(app.clientId)}
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="mt-2 text-[13px] text-[#B91C1C]">{error}</p> : null}
    </div>
  )
}
