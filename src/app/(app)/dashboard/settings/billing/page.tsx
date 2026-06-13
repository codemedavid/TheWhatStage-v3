import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { createClient } from '@/lib/supabase/server'
import { getQuotaState } from '@/lib/billing/quota'

/**
 * Tenant-facing Billing & Usage page (Phase 3, display-only).
 * Shows the current plan, this month's token usage against the plan's soft cap,
 * and the estimated cost. Nothing is enforced — over-cap is a visual nudge only.
 * Cost is shown in USD for now; customer-facing PHP lands with PayMongo later.
 */
export default async function BillingSettingsPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = await createClient()
  const quota = await getQuotaState(supabase, session.userId)

  const monthLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    month: 'long',
    year: 'numeric',
  }).format(new Date())

  const pct = quota.ratio != null ? Math.round(quota.ratio * 100) : null
  const barWidth = quota.ratio != null ? Math.min(100, Math.round(quota.ratio * 100)) : 0

  // Bar color: green under 80%, amber 80–100%, red over cap.
  const barColor =
    quota.ratio == null
      ? '#059669'
      : quota.ratio > 1
        ? '#DC2626'
        : quota.ratio >= 0.8
          ? '#D97706'
          : '#059669'

  return (
    <section className="space-y-4">
      {/* Plan + quota */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold text-[#111827]">Plan &amp; usage</h2>
          <span className="text-[12px] text-[#6B7280]">{monthLabel}</span>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-[#ECFDF5] px-2.5 py-0.5 text-[12px] font-medium capitalize text-[#047857]">
            {quota.planName}
          </span>
          {quota.overage && (
            <span className="inline-flex items-center rounded-full bg-[#FEF2F2] px-2.5 py-0.5 text-[12px] font-medium text-[#B91C1C]">
              Over monthly allowance
            </span>
          )}
        </div>

        {/* Usage bar */}
        <div className="mt-5">
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="text-[#374151]">
              {quota.usedTokens.toLocaleString('en-US')} tokens used
            </span>
            <span className="text-[#6B7280]">
              {quota.includedTokens != null
                ? `${quota.includedTokens.toLocaleString('en-US')} included${pct != null ? ` · ${pct}%` : ''}`
                : 'No limit'}
            </span>
          </div>
          <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-[#F1F5F9]">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${barWidth}%`, backgroundColor: barColor }}
            />
          </div>
        </div>
      </div>

      {/* Usage detail */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <h2 className="text-[15px] font-semibold text-[#111827]">About your usage</h2>
        <p className="mt-1 text-[13px] text-[#6B7280]">
          Usage is measured in tokens — the units your AI assistant consumes as it reads and writes
          messages. Your plan includes a monthly allowance; going over is never blocked.
        </p>
      </div>
    </section>
  )
}
