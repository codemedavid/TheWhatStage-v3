import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Cross-tenant AI usage table for the superadmin dashboard (Phase 2).
 * Aggregates the live llm_usage_events ledger DB-side via admin_usage_by_tenant()
 * (real-time, no rollup dependency) using the service-role admin client. This
 * component is only ever rendered inside SuperadminDashboard, which is gated on
 * role='superadmin'; the RPC is additionally locked to service_role execute.
 *
 * "Estimated cost" is derived from the in-app price map (pricing.ts) and shown
 * in USD — a transparency figure pending verification against the live provider
 * bill, not an invoice. (Peso display lands later on the customer side.)
 */

type UsageRow = {
  user_id: string
  email: string | null
  full_name: string | null
  tier: string | null
  included_tokens: number | null
  total_tokens: number
  cost_micros: number
  event_count: number
  last_event_at: string | null
}

export default async function SuperadminUsage() {
  // Start of the current month in Asia/Manila (UTC+8, no DST).
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  const [year, month] = parts.split('-')
  const monthStart = `${year}-${month}-01T00:00:00+08:00`
  const monthLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    month: 'long',
    year: 'numeric',
  }).format(new Date())

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('admin_usage_by_tenant', { p_since: monthStart })
  const rows = (data ?? []) as UsageRow[]

  const totalTokens = rows.reduce((s, r) => s + Number(r.total_tokens ?? 0), 0)
  const totalUsd = rows.reduce((s, r) => s + Number(r.cost_micros ?? 0), 0) / 1e6

  return (
    <section className="mt-10">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold tracking-tight">AI usage · {monthLabel}</h2>
        <p className="text-sm text-neutral-500">
          {totalTokens.toLocaleString('en-US')} tokens ·{' '}
          ${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} est. across{' '}
          {rows.length} tenant{rows.length === 1 ? '' : 's'}
        </p>
      </header>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load usage: {error.message}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-3 font-medium">Tenant</th>
                <th className="px-4 py-3 font-medium">Tier</th>
                <th className="px-4 py-3 font-medium text-right">Tokens</th>
                <th className="px-4 py-3 font-medium text-right">% of cap</th>
                <th className="px-4 py-3 font-medium text-right">Est. cost</th>
                <th className="px-4 py-3 font-medium text-right">Calls</th>
                <th className="px-4 py-3 font-medium text-right">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const cap = r.included_tokens != null ? Number(r.included_tokens) : null
                const pct = cap && cap > 0 ? Math.round((Number(r.total_tokens ?? 0) / cap) * 100) : null
                const over = pct != null && pct > 100
                return (
                <tr key={r.user_id} className="border-t border-neutral-100">
                  <td className="px-4 py-3">
                    <div className="font-medium text-neutral-800">
                      {r.full_name || <span className="text-neutral-400">—</span>}
                    </div>
                    <div className="text-xs text-neutral-500">{r.email ?? r.user_id}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium capitalize text-neutral-700">
                      {r.tier ?? 'free'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {Number(r.total_tokens ?? 0).toLocaleString('en-US')}
                  </td>
                  <td className={'px-4 py-3 text-right tabular-nums ' + (over ? 'font-semibold text-red-600' : 'text-neutral-600')}>
                    {pct != null ? `${pct}%` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    ${(Number(r.cost_micros ?? 0) / 1e6).toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 4,
                    })}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-neutral-600">
                    {Number(r.event_count ?? 0).toLocaleString('en-US')}
                  </td>
                  <td className="px-4 py-3 text-right text-neutral-500">
                    {r.last_event_at ? new Date(r.last_event_at).toLocaleString() : '—'}
                  </td>
                </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-neutral-500">
                    No AI usage recorded yet this month.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
