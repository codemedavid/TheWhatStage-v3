import type { AnalyticsOverview } from '@/lib/analytics/leads-analytics'
import { formatCount, perDay } from '@/lib/analytics/metrics'
import { formatMoney } from '../../projects/_lib/format'

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-[22px] font-semibold tabular-nums text-neutral-900">{value}</div>
      {hint ? <div className="mt-0.5 text-[12px] text-neutral-400">{hint}</div> : null}
    </div>
  )
}

interface KpiCardsProps {
  overview: AnalyticsOverview
  currency: string
  from: string | null
  to: string | null
}

export function KpiCards({ overview, currency, from, to }: KpiCardsProps) {
  const avgLeadsDay = perDay(overview.totalLeads, from, to)
  const avgProjectsDay = perDay(overview.totalProjects, from, to)
  const avgSubsDay = perDay(overview.totalSubmissions, from, to)
  const avgSubsPage =
    overview.activeActionPages > 0 ? overview.totalSubmissions / overview.activeActionPages : 0
  const avgValue =
    overview.projectValueCount > 0 ? formatMoney(overview.projectValueAvg, currency) : '—'
  const mixedCurrency = overview.currencyCount > 1

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <Kpi label="Total leads" value={formatCount(overview.totalLeads)} hint={`${avgLeadsDay.toFixed(1)} / day`} />
      <Kpi label="Total projects" value={formatCount(overview.totalProjects)} hint={`${avgProjectsDay.toFixed(1)} / day`} />
      <Kpi
        label="Total submissions"
        value={formatCount(overview.totalSubmissions)}
        hint={`${avgSubsDay.toFixed(1)} / day · ${avgSubsPage.toFixed(1)} / page`}
      />
      <Kpi
        label="Avg project value"
        value={avgValue}
        hint={mixedCurrency ? '⚠ mixed currencies' : `${formatCount(overview.projectValueCount)} valued`}
      />
      <Kpi
        label="Pipeline value (open)"
        value={formatMoney(overview.openValueSum, currency)}
        hint={`${formatCount(overview.openProjects)} open`}
      />
      <Kpi
        label="Value won"
        value={formatMoney(overview.wonValueSum, currency)}
        hint={`${formatCount(overview.wonProjects)} won`}
      />
      <Kpi
        label="Won / lost"
        value={`${formatCount(overview.wonProjects)} / ${formatCount(overview.lostProjects)}`}
        hint="projects"
      />
      <Kpi
        label="Action pages active"
        value={formatCount(overview.activeActionPages)}
        hint="received a submission"
      />
    </div>
  )
}
