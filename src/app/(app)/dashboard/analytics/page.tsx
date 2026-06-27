import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  getAnalyticsFilterOptions,
  getAnalyticsOverview,
  getAnalyticsTimeseries,
  getDefaultCurrency,
  getLeadProjectCrosstab,
  getLeadStageDistribution,
  getLeadToProject,
  getProjectStageValue,
  getSubmissionToProject,
  type AnalyticsOverview,
} from '@/lib/analytics/leads-analytics'
import { formatCount, previousPeriod } from '@/lib/analytics/metrics'
import { fetchWorkspaces } from '../projects/_lib/workspaces'
import { AnalyticsQuery } from './_lib/schemas'
import { rangeLabel, resolveDateRange } from './_lib/date-range'
import { AnalyticsToolbar } from './_components/Toolbar'
import { KpiCards } from './_components/KpiCards'
import { ConversionCard } from './_components/ConversionCard'
import { StageJourney } from './_components/StageJourney'
import { StageDistribution } from './_components/StageDistribution'
import { TrendChart } from './_components/charts/TrendChart'
import { CrossStageExplorer } from './_components/CrossStageExplorer'
import { StageValueBreakdown } from './_components/StageValueBreakdown'
import { ExportButton } from './_components/ExportButton'
import { SectionHeader } from './_components/ui'

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
    workspace: sp.workspace,
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
    workspace: params.workspace ?? null,
  }

  const prev = previousPeriod(filters.from, filters.to)

  const [
    overview,
    previousOverview,
    timeseries,
    leadDistribution,
    leadToProject,
    subToProject,
    crosstab,
    stageValue,
    options,
    currency,
    workspaces,
  ] = await Promise.all([
    getAnalyticsOverview(filters),
    prev
      ? getAnalyticsOverview({ ...filters, from: prev.from, to: prev.to })
      : Promise.resolve<AnalyticsOverview | null>(null),
    getAnalyticsTimeseries(filters),
    getLeadStageDistribution(filters),
    getLeadToProject(filters),
    getSubmissionToProject({ from: filters.from, to: filters.to, workspace: filters.workspace }),
    getLeadProjectCrosstab(filters),
    getProjectStageValue(filters),
    getAnalyticsFilterOptions(),
    getDefaultCurrency(),
    fetchWorkspaces(supabase, user.id),
  ])

  // For "per day" averages: use the explicit range, or fall back to the span of
  // observed activity when the range is "all".
  const effFrom = q.from ?? timeseries[0]?.day ?? null
  const effTo = q.to ?? timeseries[timeseries.length - 1]?.day ?? null
  const submissionWon = subToProject.find((r) => r.kind === 'won')?.reached ?? 0
  const isEmpty =
    overview.totalLeads === 0 && overview.totalProjects === 0 && overview.totalSubmissions === 0

  const comparisonNote = prev ? `vs previous period (${prev.from} → ${prev.to})` : 'No prior period to compare'

  return (
    <div className="mx-auto max-w-6xl space-y-7 p-4 sm:p-6">
      <header className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200/70 bg-neutral-50/80 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div>
          <h1 className="text-[21px] font-semibold tracking-tight text-neutral-900">Analytics</h1>
          <p className="text-[13px] text-neutral-500">Your business numbers — {rangeLabel(params)}</p>
        </div>
        <AnalyticsToolbar
          params={params}
          sources={options.sources}
          campaigns={options.campaigns}
          workspaces={workspaces.map((w) => ({ id: w.id, name: w.name }))}
        />
      </header>

      {isEmpty ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-12 text-center">
          <p className="text-[15px] font-medium text-neutral-700">No data in this range</p>
          <p className="mt-1 text-[13px] text-neutral-400">
            Try widening the date range or switching to “All”.
          </p>
        </div>
      ) : (
        <>
          <section className="space-y-3">
            <SectionHeader title="Overview" subtitle={comparisonNote} />
            <KpiCards
              overview={overview}
              previous={previousOverview}
              currency={currency}
              from={effFrom}
              to={effTo}
            />
          </section>

          <section className="space-y-3">
            <SectionHeader
              title="Lead → Project conversion"
              subtitle="How qualified leads turn into won projects"
              action={<ExportButton cells={crosstab} rangeLabel={rangeLabel(params)} />}
            />
            <CrossStageExplorer cells={crosstab} filters={filters} currency={currency} />
          </section>

          <section className="space-y-3">
            <SectionHeader title="Volume over time" subtitle="Leads · projects · submissions per day" />
            <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-sm">
              {timeseries.length > 0 ? (
                <TrendChart points={timeseries} />
              ) : (
                <p className="text-[13px] text-neutral-400">No activity in this range.</p>
              )}
            </div>
          </section>

          <section className="space-y-3">
            <SectionHeader title="The money math" subtitle="Headline conversions, both ways" />
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
            <SectionHeader title="Where your leads are now" subtitle="Current lead count per stage — mirrors your kanban board" />
            <StageDistribution title="Lead stages" rows={leadDistribution} unit="leads" />
          </section>

          <section className="space-y-3">
            <SectionHeader title="Stage journeys" subtitle="Monotonic funnels — furthest stage each entity reached" />
            <div className="grid gap-4 lg:grid-cols-2">
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

          <section className="space-y-3">
            <SectionHeader title="Value by project stage" subtitle="Where pipeline value sits right now" />
            <StageValueBreakdown rows={stageValue} currency={currency} />
          </section>
        </>
      )}
    </div>
  )
}
