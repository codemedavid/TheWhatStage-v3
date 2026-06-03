import { createClient } from '@/lib/supabase/server'

/**
 * Current-month AI usage summary (Phase 2 — usage-based billing).
 * Reads the live llm_usage_events ledger directly (RLS-scoped to the logged-in
 * tenant) so the figure is real-time — no waiting on the hourly rollup. For a
 * single tenant's own month this is a cheap, index-backed scan
 * (user_id, created_at). The usage_daily rollup exists for cross-tenant/admin
 * and historical aggregation, not for this card. Self-contained server
 * component: drop it anywhere in the dashboard tree.
 *
 * "Estimated cost" is exactly that — derived from the in-app price map
 * (src/lib/billing/pricing.ts), which is pending verification against the live
 * provider dashboard. Surface it as a transparency figure, not an invoice.
 */
export default async function UsageCard({ userId }: { userId: string }) {
  if (!userId) return null

  // Start of the current month in Asia/Manila (UTC+8, no DST) as a timestamp.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  const [year, month] = parts.split('-')
  const monthStart = `${year}-${month}-01T00:00:00+08:00`

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('llm_usage_events')
    .select('total_tokens, cost_micros')
    .eq('user_id', userId)
    .gte('created_at', monthStart)

  if (error) {
    // Table not migrated yet, or transient — fail quiet, don't break the dashboard.
    console.warn('[UsageCard] llm_usage_events read failed', error.message)
    return null
  }

  const rows = data ?? []
  const totalTokens = rows.reduce((s, r) => s + Number(r.total_tokens ?? 0), 0)
  const costUsd = rows.reduce((s, r) => s + Number(r.cost_micros ?? 0), 0) / 1e6

  const monthLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    month: 'long',
    year: 'numeric',
  }).format(new Date())

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold text-[#111827]">AI usage</h2>
        <span className="text-[12px] text-[#6B7280]">{monthLabel}</span>
      </div>
      <p className="mt-1 text-[13px] text-[#6B7280]">
        Tokens your chatbot has used this month.
      </p>

      <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-[12px] font-medium uppercase tracking-wide text-[#6B7280]">
            Tokens used
          </dt>
          <dd className="mt-1 text-[22px] font-semibold tabular-nums text-[#111827]">
            {totalTokens.toLocaleString('en-US')}
          </dd>
        </div>
        <div>
          <dt className="text-[12px] font-medium uppercase tracking-wide text-[#6B7280]">
            Estimated cost
          </dt>
          <dd className="mt-1 text-[22px] font-semibold tabular-nums text-[#111827]">
            ${costUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
          </dd>
        </div>
      </dl>
    </div>
  )
}
