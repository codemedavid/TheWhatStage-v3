'use client'
import Link from 'next/link'
import type { PaymentMethod } from '@/lib/payment-methods/types'
import { paymentMethodKindLabel } from '@/lib/payment-methods/types'

export interface PaymentSettings {
  enabled: boolean
  excluded_method_ids: string[]
}

interface Props {
  value: PaymentSettings
  onChange: (next: PaymentSettings) => void
  paymentMethods: PaymentMethod[]
}

export default function PaymentSettingsPanel({ value, onChange, paymentMethods }: Props) {
  const enabledMethods = paymentMethods.filter((m) => m.enabled)
  const excluded = new Set(value.excluded_method_ids)

  function toggleEnabled(next: boolean) {
    onChange({ ...value, enabled: next })
  }

  function toggleMethod(id: string) {
    const e = new Set(excluded)
    if (e.has(id)) e.delete(id); else e.add(id)
    onChange({ ...value, excluded_method_ids: Array.from(e) })
  }

  return (
    <section className="rounded-lg border border-gray-200 p-4">
      <header className="flex items-center justify-between">
        <h3 className="font-semibold">Payment</h3>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(e) => toggleEnabled(e.target.checked)}
          />
          Show payment section on this page
        </label>
      </header>

      {value.enabled ? (
        <div className="mt-3">
          {paymentMethods.length === 0 ? (
            <p className="text-sm text-gray-600">
              You don't have any payment methods yet.{' '}
              <Link href="/dashboard/payment-methods" className="underline">
                Add one
              </Link>.
            </p>
          ) : (
            <ul className="grid gap-2">
              {paymentMethods.map((m) => {
                const shown = m.enabled && !excluded.has(m.id)
                return (
                  <li
                    key={m.id}
                    className={
                      'flex items-center justify-between rounded border border-gray-200 p-2 ' +
                      (m.enabled ? '' : 'opacity-50')
                    }
                  >
                    <div>
                      <div className="text-sm font-medium">{m.name}</div>
                      <div className="text-xs text-gray-500">
                        {paymentMethodKindLabel(m.kind)}
                        {!m.enabled ? ' · Disabled in /payment-methods' : ''}
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        disabled={!m.enabled}
                        checked={shown}
                        onChange={() => toggleMethod(m.id)}
                      />
                      Show on this page
                    </label>
                  </li>
                )
              })}
              {enabledMethods.length === 0 ? (
                <p className="text-xs text-gray-600">
                  All your payment methods are disabled. Enable at least one in{' '}
                  <Link href="/dashboard/payment-methods" className="underline">
                    /payment-methods
                  </Link>.
                </p>
              ) : null}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  )
}
