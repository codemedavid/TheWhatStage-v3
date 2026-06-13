import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/get-session'
import { isAccountStatus, type AccountStatus } from '@/lib/auth/account-status'
import {
  getUsageTotals,
  getUsageTrend,
  getUsageByScopeModel,
  getUsageByTenant,
  manilaMonthStart,
  manilaToday,
  manilaMonthLabel,
  type TenantUsageRow,
} from '@/lib/billing/admin-usage'
import { UserRowActions } from './UserRowActions'
import { UserTierToggle } from './UserTierToggle'
import UsageAnalyticsPanel from './UsageAnalyticsPanel'

type SubscriptionTier = 'free' | 'pro'

type ProfileRow = {
  id: string
  email: string
  full_name: string
  role: 'user' | 'admin' | 'superadmin'
  status: AccountStatus
  subscription_tier: SubscriptionTier
  created_at: string
}

const STATUS_SORT: Record<AccountStatus, number> = { pending: 0, active: 1, paused: 2 }

const statusBadgeClass: Record<AccountStatus, string> = {
  pending: 'inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800',
  active: 'inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800',
  paused: 'inline-flex rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-700',
}

function UsageCell({ usage }: { usage: TenantUsageRow | undefined }) {
  if (!usage || usage.effectiveTokens === 0) return <span className="text-neutral-300">—</span>
  const cap = usage.includedTokens
  const pct = cap && cap > 0 ? Math.round((usage.effectiveTokens / cap) * 100) : null
  const over = pct != null && pct > 100
  return (
    <div className="min-w-[120px]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="tabular-nums text-neutral-700">{usage.effectiveTokens.toLocaleString('en-US')}</span>
        <span className={'text-xs tabular-nums ' + (over ? 'font-semibold text-red-600' : 'text-neutral-400')}>
          {pct != null ? `${pct}%` : ''}
        </span>
      </div>
      {pct != null && (
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100" aria-hidden="true">
          <div
            className={'h-full rounded-full ' + (over ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500')}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      )}
    </div>
  )
}

export default async function SuperadminDashboard({ userName }: { userName: string }) {
  const session = await getSession()
  const admin = createAdminClient()
  const from = manilaMonthStart()
  const to = manilaToday()

  const [profilesRes, totals, trend, scopeModel, tenantUsage] = await Promise.all([
    admin
      .from('profiles')
      .select('id, email, full_name, role, status, subscription_tier, created_at')
      .order('created_at', { ascending: false }),
    getUsageTotals(from, to),
    getUsageTrend(from, to),
    getUsageByScopeModel(from, to),
    getUsageByTenant(from, to),
  ])

  const { data, error } = profilesRes
  const usageByUser = new Map(tenantUsage.map((u) => [u.userId, u]))

  const profiles = ((data ?? []) as Array<Omit<ProfileRow, 'status' | 'subscription_tier'> & { status: string; subscription_tier: string | null }>)
    .map<ProfileRow>((p) => ({
      ...p,
      status: isAccountStatus(p.status) ? p.status : 'active',
      subscription_tier: p.subscription_tier === 'pro' ? 'pro' : 'free',
    }))
    .sort((a, b) => STATUS_SORT[a.status] - STATUS_SORT[b.status])

  const pendingCount = profiles.filter((p) => p.status === 'pending').length

  return (
    <div className="mx-auto max-w-[1200px] px-8 py-7">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Superadmin</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Welcome, {userName}. {profiles.length} user{profiles.length === 1 ? '' : 's'} total
          {pendingCount > 0 ? ` · ${pendingCount} awaiting approval` : ''}.
        </p>
      </header>

      {/* ── Fleet usage analytics ── */}
      <section className="mb-10">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold tracking-tight">AI usage · {manilaMonthLabel()}</h2>
          <a
            href={`/api/superadmin/usage/export?from=${from}&to=${to}`}
            className="text-sm font-medium text-emerald-700 hover:underline"
          >
            Export CSV
          </a>
        </div>
        <UsageAnalyticsPanel totals={totals} trend={trend} scopeModel={scopeModel} periodLabel={manilaMonthLabel()} isFleet />
      </section>

      {/* ── Users ── */}
      <section>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Users</h2>
        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Failed to load users: {error.message}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Tier</th>
                  <th className="px-4 py-3 font-medium">Usage (mo)</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => {
                  const isSelf = session?.userId === p.id
                  const isOtherSuperadmin = p.role === 'superadmin' && !isSelf
                  return (
                    <tr key={p.id} className="border-t border-neutral-100">
                      <td className="px-4 py-3">
                        {p.role === 'user' ? (
                          <Link href={`/dashboard/admin/users/${p.id}`} className="font-medium text-neutral-800 hover:text-emerald-700 hover:underline">
                            {p.full_name || p.email}
                          </Link>
                        ) : (
                          p.full_name
                        )}
                      </td>
                      <td className="px-4 py-3 text-neutral-700">{p.email}</td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            p.role === 'superadmin'
                              ? 'inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700'
                              : p.role === 'admin'
                                ? 'inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700'
                                : 'inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700'
                          }
                        >
                          {p.role}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {p.role === 'user' ? (
                          <UserTierToggle userId={p.id} tier={p.subscription_tier} />
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            ✦ Pro <span className="text-emerald-500">(role)</span>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {p.role === 'user' ? <UsageCell usage={usageByUser.get(p.id)} /> : <span className="text-neutral-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={statusBadgeClass[p.status]}>{p.status}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isSelf || isOtherSuperadmin ? (
                          <span className="text-xs text-neutral-400">—</span>
                        ) : (
                          <UserRowActions userId={p.id} status={p.status} />
                        )}
                      </td>
                    </tr>
                  )
                })}
                {profiles.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-neutral-500">
                      No users found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
