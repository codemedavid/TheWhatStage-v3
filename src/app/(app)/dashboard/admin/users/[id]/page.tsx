import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSuperadminSession } from '@/lib/auth/admin-guards'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getUsageTotals,
  getUsageTrend,
  getUsageByScopeModel,
  manilaMonthStart,
  manilaToday,
  manilaMonthLabel,
} from '@/lib/billing/admin-usage'
import { UserTierToggle } from '../../../_components/UserTierToggle'
import { CapOverrideForm } from '../../../_components/CapOverrideForm'
import { UsageAdjustForm } from '../../../_components/UsageAdjustForm'
import UsageAnalyticsPanel from '../../../_components/UsageAnalyticsPanel'

export const dynamic = 'force-dynamic'

type AdjustmentRow = {
  id: number
  delta_tokens: number
  delta_cost_micros: number
  reason: string
  kind: string
  created_at: string
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  // Live role check (not just the JWT claim) — a demoted superadmin is locked out.
  const session = await getSuperadminSession()
  if (!session) notFound()

  const { id } = await params
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles')
    .select('id, email, full_name, role, status, subscription_tier, included_tokens_override, created_at')
    .eq('id', id)
    .maybeSingle<{
      id: string
      email: string
      full_name: string | null
      role: string
      status: string
      subscription_tier: string | null
      included_tokens_override: number | null
      created_at: string
    }>()

  // Drill-down is for tenant accounts only.
  if (!profile || profile.role !== 'user') notFound()

  const tier = profile.subscription_tier === 'pro' ? 'pro' : 'free'
  const from = manilaMonthStart()
  const to = manilaToday()

  const [totals, trend, scopeModel, planRes, adjRes] = await Promise.all([
    getUsageTotals(from, to, id),
    getUsageTrend(from, to, id),
    getUsageByScopeModel(from, to, id),
    admin.from('billing_plans').select('included_tokens').eq('id', tier).maybeSingle<{ included_tokens: number }>(),
    admin
      .from('usage_adjustments')
      .select('id, delta_tokens, delta_cost_micros, reason, kind, created_at')
      .eq('user_id', id)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const tierCap = planRes.data?.included_tokens != null ? Number(planRes.data.included_tokens) : null
  const adjustments = (adjRes.data ?? []) as AdjustmentRow[]

  return (
    <div className="mx-auto max-w-[1000px] px-8 py-7">
      <Link href="/dashboard" className="text-sm text-neutral-500 hover:text-neutral-800">
        ← Back to superadmin
      </Link>

      <header className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{profile.full_name || profile.email}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {profile.email} · joined {new Date(profile.created_at).toLocaleDateString()} ·{' '}
            <span className="capitalize">{profile.status}</span>
          </p>
        </div>
        <a
          href={`/api/superadmin/usage/export?from=${from}&to=${to}&user=${id}`}
          className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Export CSV
        </a>
      </header>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Usage · {manilaMonthLabel()}</h2>
        <UsageAnalyticsPanel totals={totals} trend={trend} scopeModel={scopeModel} periodLabel={manilaMonthLabel()} showCost />
      </section>

      <section className="mb-8 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-neutral-200 bg-white p-5">
          <h3 className="text-[14px] font-semibold text-neutral-900">Plan &amp; cap</h3>
          <p className="mt-1 text-[12px] text-neutral-500">
            Tier also controls WhatStage University access for this tenant.
          </p>
          <div className="mt-3">
            <UserTierToggle userId={id} tier={tier} />
          </div>
          <div className="mt-4 border-t border-neutral-100 pt-4">
            <CapOverrideForm userId={id} currentOverride={profile.included_tokens_override} tierCap={tierCap} />
          </div>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-5">
          <h3 className="text-[14px] font-semibold text-neutral-900">Adjust usage</h3>
          <p className="mt-1 text-[12px] text-neutral-500">
            Corrections never edit the metered ledger; they post to an audited adjustments log.
          </p>
          <div className="mt-3">
            <UsageAdjustForm userId={id} />
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-[14px] font-semibold text-neutral-900">Adjustment history</h3>
        {adjustments.length === 0 ? (
          <p className="text-sm text-neutral-400">No adjustments recorded.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">When</th>
                  <th className="px-4 py-2.5 font-medium">Kind</th>
                  <th className="px-4 py-2.5 font-medium text-right">Δ Tokens</th>
                  <th className="px-4 py-2.5 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {adjustments.map((a) => (
                  <tr key={a.id} className="border-t border-neutral-100">
                    <td className="px-4 py-2.5 text-neutral-500">{new Date(a.created_at).toLocaleString()}</td>
                    <td className="px-4 py-2.5 capitalize">{a.kind}</td>
                    <td className={'px-4 py-2.5 text-right tabular-nums ' + (a.delta_tokens < 0 ? 'text-emerald-600' : 'text-neutral-700')}>
                      {a.delta_tokens > 0 ? '+' : ''}
                      {Number(a.delta_tokens).toLocaleString('en-US')}
                    </td>
                    <td className="px-4 py-2.5 text-neutral-600">{a.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
