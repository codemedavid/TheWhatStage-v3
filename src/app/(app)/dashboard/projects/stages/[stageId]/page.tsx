import { Suspense } from 'react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ProjectsQuery } from '../../_lib/schemas'
import {
  fetchProjectStageById,
  fetchProjectsPage,
  fetchStageLeadSummary,
  fetchStageSequenceRunStatus,
} from '../../_lib/queries'
import { formatMoney } from '../../_lib/format'
import { SequenceConfig } from '../../_components/SequenceConfig'
import { StageLeadsList } from './_components/StageLeadsList'
import { StageLeadsToolbar } from './_components/StageLeadsToolbar.client'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function StageDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ stageId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { stageId } = await params
  if (!UUID_RE.test(stageId)) notFound()
  const sp = await searchParams
  // Normalize duplicated params (Next gives string[] for ?q=a&q=b) and parse
  // without throwing — a malformed URL degrades to defaults instead of crashing
  // the route's error boundary.
  const firstParam = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const parsed = ProjectsQuery.safeParse({ q: firstParam(sp.q), sort: firstParam(sp.sort), page: firstParam(sp.page) })
  const query = parsed.success ? parsed.data : ProjectsQuery.parse({})

  return (
    <div data-leads-root className="px-4 py-6 md:px-8">
      <Suspense fallback={<StageFallback />}>
        <StageDetailBody stageId={stageId} query={query} />
      </Suspense>
    </div>
  )
}

async function StageDetailBody({ stageId, query }: { stageId: string; query: ProjectsQuery }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const stage = await fetchProjectStageById(supabase, user.id, stageId)
  if (!stage) notFound()

  const [{ rows, total }, summary, runStatus] = await Promise.all([
    fetchProjectsPage(supabase, user.id, query, stageId),
    fetchStageLeadSummary(supabase, user.id, stageId),
    fetchStageSequenceRunStatus(supabase, user.id, stageId),
  ])

  // Preserve the active search/sort when paging; omit defaults to keep URLs clean.
  const makeHref = (p: number) => {
    const params = new URLSearchParams()
    if (query.q) params.set('q', query.q)
    if (query.sort !== 'recent') params.set('sort', query.sort)
    if (p > 1) params.set('page', String(p))
    const qs = params.toString()
    return `/dashboard/projects/stages/${stageId}${qs ? `?${qs}` : ''}`
  }

  return (
    <div>
      <header className="mb-5">
        <Link
          href={`/dashboard/projects/${stage.workspace_id}`}
          className="lead-focus inline-flex items-center gap-1 text-[12.5px] font-medium"
          style={{ color: 'var(--lead-muted)' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back to board
        </Link>
        <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
          {stage.color && <span className="h-3 w-3 rounded-full" style={{ background: stage.color }} />}
          <h1 className="text-[20px] font-semibold" style={{ color: 'var(--lead-ink)' }}>{stage.name}</h1>
          <span className="text-[13px]" style={{ color: 'var(--lead-muted)' }}>
            {summary.count} {summary.count === 1 ? 'deal' : 'deals'}
            {summary.subtotal > 0 ? ` · ${formatMoney(summary.subtotal, summary.currency)}` : ''}
          </span>
        </div>
        {stage.description && (
          <p className="mt-1 text-[13px]" style={{ color: 'var(--lead-muted)' }}>{stage.description}</p>
        )}
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide" style={{ color: 'var(--lead-body)' }}>
            Leads in stage
          </h2>
          <div className="mb-3">
            <StageLeadsToolbar q={query.q ?? ''} sort={query.sort} />
          </div>
          <StageLeadsList rows={rows} runStatus={runStatus} total={total} page={query.page} makeHref={makeHref} />
        </section>

        <section>
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide" style={{ color: 'var(--lead-body)' }}>
            Follow-up &amp; rules
          </h2>
          <div
            className="rounded-2xl p-4"
            style={{ background: 'var(--lead-surface-2)', border: '1px solid var(--lead-line)' }}
          >
            <SequenceConfig stageId={stage.id} stageName={stage.name} />
          </div>
        </section>
      </div>
    </div>
  )
}

function StageFallback() {
  return (
    <div className="animate-pulse">
      <div className="mb-5 h-6 w-40 rounded bg-[#E5E7EB]" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="h-64 rounded-2xl bg-[#F3F4F6]" />
        <div className="h-64 rounded-2xl bg-[#F3F4F6]" />
      </div>
    </div>
  )
}
