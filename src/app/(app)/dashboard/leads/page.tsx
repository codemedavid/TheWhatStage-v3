import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LeadsQuery } from './_lib/schemas'
import { seedDefaultStagesIfEmpty } from './_lib/seed'
import { fetchStages, fetchStagesCached, fetchFieldDefsCached, fetchLeadsTotal, fetchContactLeadsTotal, fetchCampaignOptions, fetchLeadById } from './_lib/queries'
import { getChatbotConfig } from '@/lib/chatbot/config'
import { LeadsShell } from './_components/LeadsShell'
import { LeadsHeader } from './_components/LeadsHeader'
import { Toolbar } from './_components/Toolbar'
import { KanbanBoard } from './_components/KanbanBoard'
import { LeadsTable } from './_components/LeadsTable'
import { ContactList } from './_components/ContactList'
import { StageRulesTip } from './_components/StageRulesTip'
import { LeadsContentArea } from './_components/LeadsContentArea'
import { DeepLinkLeadDrawer } from './_components/DeepLinkLeadDrawer.client'
import { resolveDateRange } from './_lib/date-range'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = LeadsQuery.parse({
    view: sp.view, stage: sp.stage, page: sp.page,
    q: sp.q, range: sp.range, from: sp.from, to: sp.to, sort: sp.sort,
    contact_filter: sp.contact_filter,
    contact_sort: sp.contact_sort,
  })
  // Deep link target from "View lead" links elsewhere in the app
  // (`/dashboard/leads?lead=<id>`). Validated here so a malformed value never
  // reaches the (uuid-typed) query.
  const leadId =
    typeof sp.lead === 'string' && UUID_RE.test(sp.lead) ? sp.lead : undefined

  return (
    <LeadsShell>
      <Suspense fallback={<LeadsBodyFallback view={params.view} />}>
        <LeadsBody params={params} leadId={leadId} />
      </Suspense>
    </LeadsShell>
  )
}

async function LeadsBody({
  params,
  leadId,
}: {
  params: ReturnType<typeof LeadsQuery.parse>
  leadId?: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const justSeeded = await seedDefaultStagesIfEmpty(supabase, user.id)

  // Resolve the `range` preset (today / week / month / all) into concrete
  // from/to bounds for every data query, while the Toolbar keeps the original
  // `params` so its preset buttons reflect the user's selection.
  const queryParams = resolveDateRange(params)

  const totalPromise =
    params.view === 'contact'
      ? fetchContactLeadsTotal(supabase, user.id, queryParams)
      : fetchLeadsTotal(supabase, user.id, queryParams)

  const [stages, fieldDefs, total, campaigns, chatbotConfig, deepLinkLead] = await Promise.all([
    justSeeded ? fetchStages(supabase, user.id) : fetchStagesCached(user.id),
    fetchFieldDefsCached(user.id),
    totalPromise,
    fetchCampaignOptions(supabase, user.id),
    getChatbotConfig(supabase, user.id),
    leadId ? fetchLeadById(supabase, user.id, leadId) : Promise.resolve(null),
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
        autoClassifyEnabled={chatbotConfig.autoClassifyEnabled}
      />
      <Toolbar params={params} />

      {params.view === 'kanban' && (
        <StageRulesTip
          hasUnconfiguredStage={stages.some((s) => !s.description?.trim())}
        />
      )}

      <LeadsContentArea>
        {params.view === 'kanban' ? (
          <KanbanBoard userId={user.id} stages={stages} fieldDefs={fieldDefs} campaigns={campaigns} params={queryParams} />
        ) : params.view === 'contact' ? (
          <ContactList userId={user.id} stages={stages} fieldDefs={fieldDefs} campaigns={campaigns} params={queryParams} />
        ) : (
          <LeadsTable userId={user.id} stages={stages} fieldDefs={fieldDefs} campaigns={campaigns} params={queryParams} />
        )}
      </LeadsContentArea>

      {leadId && (
        <DeepLinkLeadDrawer
          lead={deepLinkLead}
          stages={stages}
          fieldDefs={fieldDefs}
          campaigns={campaigns}
        />
      )}
    </>
  )
}

function LeadsBodyFallback({ view }: { view: 'kanban' | 'table' | 'contact' }) {
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
