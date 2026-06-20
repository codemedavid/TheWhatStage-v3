import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  getAnalyticsFilterOptions,
  getAnalyticsOverview,
  getAnalyticsTimeseries,
  getDefaultCurrency,
  getLeadFunnel,
  getLeadToProject,
  getSubmissionToProject,
} from '@/lib/analytics/leads-analytics'
import { formatCount } from '@/lib/analytics/metrics'
import { AnalyticsQuery } from './_lib/schemas'
import { rangeLabel, resolveDateRange } from './_lib/date-range'
import { AnalyticsToolbar } from './_components/Toolbar'
import { KpiCards } from './_components/KpiCards'
import { ConversionCard } from './_components/ConversionCard'
import { StageJourney } from './_components/StageJourney'
import { TrendChart } from './_components/charts/TrendChart'

// Per-tenant, cookie/auth-derived data — never statically cached.
export const dynamic = 'force-dynamic'

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = AnalyticsQuery.parse({
    range: sp.range,
    from: sp.from,
    to: sp.to,
    source: sp.source,
    campaign: sp.campaign,
  })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const q = resolveDateRange(params)
  const filters = {
    from: q.from ?? null,
    to: q.to ?? null,
    source: q.source ?? null,
    campaign: q.campaign ?? null,
  }

  const [overview, timeseries, leadFunnel, leadToProject, subToProject, options, currency] =
    await Promise.all([
      getAnalyticsOverview(filters),
      getAnalyticsTimeseries(filters),
      getLeadFunnel(filters),
      getLeadToProject(filters),
      getSubmissionToProject({ from: filters.from, to: filters.to }),
      getAnalyticsFilterOptions(),
      getDefaultCurrency(),
    ])

  // For "per day" averages: use the explicit range, or fall back to the span of
  // observed activity when the range is "all".
  const effFrom = q.from ?? timeseries[0]?.day ?? null
  const effTo = q.to ?? timeseries[timeseries.length - 1]?.day ?? null
  const submissionWon = subToProject.find((r) => r.kind === 'won')?.reached ?? 0
  const isEmpty =
    overview.totalLeads === 0 && overview.totalProjects === 0 && overview.totalSubmissions === 0

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold text-neutral-900">Analytics</h1>
          <p className="text-[13px] text-neutral-500">Your business numbers — {rangeLabel(params)}</p>
        </div>
        <AnalyticsToolbar params={params} sources={options.sources} campaigns={options.campaigns} />
      </header>

      {isEmpty ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center">
          <p className="text-[14px] font-medium text-neutral-700">No data in this range</p>
          <p className="mt-1 text-[13px] text-neutral-400">
            Try widening the date range or switching to “All”.
          </p>
        </div>
      ) : (
        <>
          <KpiCards overview={overview} currency={currency} from={effFrom} to={effTo} />

          <section className="rounded-xl border border-neutral-200 bg-white p-5">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-[14px] font-semibold text-neutral-900">Volume over time</h2>
              <span className="text-[12px] text-neutral-400">leads · projects · submissions per day</span>
            </div>
            {timeseries.length > 0 ? (
              <TrendChart points={timeseries} />
            ) : (
              <p className="text-[13px] text-neutral-400">No activity in this range.</p>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-[14px] font-semibold text-neutral-900">The money math</h2>
            <div className="grid gap-3 md:grid-cols-3">
              <ConversionCard
                title="Lead → Submission"
                from={overview.totalLeads}
                fromLabel="leads"
                to={overview.totalSubmissions}
                toLabel="submissions"
                note={`${formatCount(overview.attributedSubmissions)} submissions linked to a lead`}
              />
              <ConversionCard
                title="Lead → Won project"
                from={overview.totalLeads}
                fromLabel="leads"
                to={overview.wonProjects}
                toLabel="won"
              />
              <ConversionCard
                title="Submission → Won project"
                from={overview.totalSubmissions}
                fromLabel="submissions"
                to={submissionWon}
                toLabel="won"
                note={`${formatCount(overview.submissionsWithProject)} of ${formatCount(
                  overview.totalSubmissions,
                )} submissions became projects`}
              />
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-[14px] font-semibold text-neutral-900">Stage journeys</h2>
            <div className="grid gap-4 lg:grid-cols-2">
              <StageJourney title="Lead stage journey" rows={leadFunnel} unit="leads" accent="#2563eb" showSelector />
              <StageJourney
                title="Lead → Project stages"
                rows={leadToProject}
                unit="projects"
                accent="#16a34a"
                footnote={`${formatCount(overview.lostProjects)} projects lost (off-ramp, excluded from the ladder)`}
              />
              <StageJourney title="Submission → Project stages" rows={subToProject} unit="submissions" accent="#d97706" />
            </div>
          </section>
        </>
      )}
    </div>
  )
}
