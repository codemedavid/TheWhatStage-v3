import type { AnalyticsOverview } from '@/lib/analytics/leads-analytics'
import { computeDelta, formatCount, perDay } from '@/lib/analytics/metrics'
import { formatMoney } from '../../projects/_lib/format'
import { Card, DeltaBadge } from './ui'

interface MetricProps {
  label: string
  value: string
  hint?: string
  current?: number
  previous?: number | null
  goodWhen?: 'up' | 'down'
  accent?: string
}

function Metric({ label, value, hint, current, previous, goodWhen, accent }: MetricProps) {
  const delta =
    current !== undefined && previous !== undefined && previous !== null
      ? computeDelta(current, previous)
      : null
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">{label}</span>
        {delta ? <DeltaBadge delta={delta} goodWhen={goodWhen} /> : null}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        {accent ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} /> : null}
        <span className="text-[23px] font-semibold tracking-tight tabular-nums text-neutral-900">{value}</span>
      </div>
      {hint ? <div className="mt-0.5 text-[12px] text-neutral-400">{hint}</div> : null}
    </Card>
  )
}

interface KpiCardsProps {
  overview: AnalyticsOverview
  previous: AnalyticsOverview | null
  currency: string
  from: string | null
  to: string | null
}

export function KpiCards({ overview, previous, currency, from, to }: KpiCardsProps) {
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
      <Metric
        label="Total leads"
        value={formatCount(overview.totalLeads)}
        hint={`${avgLeadsDay.toFixed(1)} / day`}
        current={overview.totalLeads}
        previous={previous?.totalLeads}
        accent="#2563eb"
      />
      <Metric
        label="Total projects"
        value={formatCount(overview.totalProjects)}
        hint={`${avgProjectsDay.toFixed(1)} / day`}
        current={overview.totalProjects}
        previous={previous?.totalProjects}
        accent="#16a34a"
      />
      <Metric
        label="Total submissions"
        value={formatCount(overview.totalSubmissions)}
        hint={`${avgSubsDay.toFixed(1)} / day · ${avgSubsPage.toFixed(1)} / page`}
        current={overview.totalSubmissions}
        previous={previous?.totalSubmissions}
        accent="#d97706"
      />
      <Metric
        label="Avg project value"
        value={avgValue}
        hint={mixedCurrency ? '⚠ mixed currencies' : `${formatCount(overview.projectValueCount)} valued`}
        current={overview.projectValueAvg}
        previous={previous?.projectValueAvg}
      />
      <Metric
        label="Pipeline value (open)"
        value={formatMoney(overview.openValueSum, currency)}
        hint={`${formatCount(overview.openProjects)} open`}
        current={overview.openValueSum}
        previous={previous?.openValueSum}
      />
      <Metric
        label="Value won"
        value={formatMoney(overview.wonValueSum, currency)}
        hint={`${formatCount(overview.wonProjects)} won`}
        current={overview.wonValueSum}
        previous={previous?.wonValueSum}
      />
      <Metric
        label="Projects won"
        value={formatCount(overview.wonProjects)}
        hint={`${formatCount(overview.lostProjects)} lost`}
        current={overview.wonProjects}
        previous={previous?.wonProjects}
      />
      <Metric
        label="Action pages active"
        value={formatCount(overview.activeActionPages)}
        hint="received a submission"
        current={overview.activeActionPages}
        previous={previous?.activeActionPages}
      />
    </div>
  )
}
