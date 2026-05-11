import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LeadsQuery } from './_lib/schemas'
import { seedDefaultStagesIfEmpty } from './_lib/seed'
import { fetchStagesCached, fetchFieldDefsCached, fetchLeadsTotal, fetchCampaignOptions } from './_lib/queries'
import { LeadsShell } from './_components/LeadsShell'
import { LeadsHeader } from './_components/LeadsHeader'
import { Toolbar } from './_components/Toolbar'
import { KanbanBoard } from './_components/KanbanBoard'
import { LeadsTable } from './_components/LeadsTable'
import { StageRulesTip } from './_components/StageRulesTip'

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = LeadsQuery.parse({
    view: sp.view, stage: sp.stage, page: sp.page,
    q: sp.q, from: sp.from, to: sp.to, sort: sp.sort,
  })

  return (
    <LeadsShell>
      <Suspense fallback={<LeadsBodyFallback view={params.view} />}>
        <LeadsBody params={params} />
      </Suspense>
    </LeadsShell>
  )
}

async function LeadsBody({ params }: { params: ReturnType<typeof LeadsQuery.parse> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  await seedDefaultStagesIfEmpty(supabase, user.id)

  const [stages, fieldDefs, total, campaigns] = await Promise.all([
    fetchStagesCached(user.id),
    fetchFieldDefsCached(user.id),
    fetchLeadsTotal(supabase, user.id, params),
    fetchCampaignOptions(supabase, user.id),
  ])

  return (
    <>
      <LeadsHeader
        view={params.view}
        stageCount={stages.length}
        leadCount={total}
        stages={stages}
        fieldDefs={fieldDefs}
        campaigns={campaigns}
      />
      <Toolbar params={params} />

      {params.view === 'kanban' && (
        <StageRulesTip
          hasUnconfiguredStage={stages.some((s) => !s.description?.trim())}
        />
      )}

      <div className="mt-5">
        {params.view === 'kanban' ? (
          <KanbanBoard userId={user.id} stages={stages} fieldDefs={fieldDefs} campaigns={campaigns} params={params} />
        ) : (
          <LeadsTable userId={user.id} stages={stages} fieldDefs={fieldDefs} campaigns={campaigns} params={params} />
        )}
      </div>
    </>
  )
}

function LeadsBodyFallback({ view }: { view: 'kanban' | 'table' }) {
  return (
    <div className="animate-pulse">
      <div
        className="sticky top-0 z-30 -mx-8 px-8 py-4 backdrop-blur"
        style={{
          background: 'color-mix(in oklab, var(--lead-page) 88%, transparent)',
          borderBottom: '1px solid var(--lead-line)',
        }}
      >
        <div className="flex items-center gap-4 flex-wrap">
          <div className="h-6 w-24 rounded bg-[#E5E7EB]" />
          <div className="h-3 w-40 rounded bg-[#EEF0F3]" />
          <div className="ml-auto flex items-center gap-2">
            <div className="h-8 w-32 rounded-full bg-[#EEF0F3]" />
            <div className="h-8 w-24 rounded-full bg-[#E5E7EB]" />
          </div>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <div className="h-9 w-72 rounded-md bg-[#EEF0F3]" />
        <div className="h-9 w-32 rounded-md bg-[#EEF0F3]" />
      </div>

      {view === 'kanban' ? (
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-[#E5E7EB] bg-white p-3 min-h-[320px] space-y-2"
            >
              <div className="h-4 w-24 rounded bg-[#E5E7EB]" />
              <div className="h-16 rounded bg-[#F3F4F6]" />
              <div className="h-16 rounded bg-[#F3F4F6]" />
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-5 space-y-2">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-10 rounded bg-[#F3F4F6]" />
          ))}
        </div>
      )}
    </div>
  )
}
