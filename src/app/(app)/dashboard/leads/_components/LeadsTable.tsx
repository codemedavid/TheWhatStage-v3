import { createClient } from '@/lib/supabase/server'
import { fetchLeadsPage } from '../_lib/queries'
import type { LeadsQuery } from '../_lib/schemas'
import type { StageRow, FieldDefRow, CampaignOption } from '../_lib/queries'
import { LeadsTableClient } from './LeadsTable.client'
import { Pagination } from './Pagination'

export async function LeadsTable({
  userId, stages, fieldDefs, campaigns, params,
}: {
  userId: string
  stages: StageRow[]
  fieldDefs: FieldDefRow[]
  campaigns: CampaignOption[]
  params: LeadsQuery
}) {
  const supabase = await createClient()
  const stageId = params.stage
  const { rows, total } = await fetchLeadsPage(supabase, userId, params, stageId)

  return (
    <div className="space-y-3">
      <StageTabs stages={stages} active={stageId} params={params} />
      <LeadsTableClient rows={rows} stages={stages} fieldDefs={fieldDefs} campaigns={campaigns} />
      <Pagination total={total} page={params.page} makeHref={(p) => buildHref(params, p)} />
    </div>
  )
}

function StageTabs({
  stages, active, params,
}: {
  stages: StageRow[]
  active?: string
  params: LeadsQuery
}) {
  return (
    <div className="lead-scroll flex gap-1 overflow-x-auto">
      <TabLink label="All" stageId={undefined} active={!active} params={params} />
      {stages.map((s) => (
        <TabLink
          key={s.id}
          label={s.name}
          stageId={s.id}
          active={active === s.id}
          params={params}
        />
      ))}
    </div>
  )
}

function TabLink({
  label, stageId, active, params,
}: {
  label: string
  stageId?: string
  active: boolean
  params: LeadsQuery
}) {
  const u = new URLSearchParams()
  u.set('view', 'table')
  if (stageId) u.set('stage', stageId)
  if (params.q) u.set('q', params.q)
  if (params.from) u.set('from', params.from)
  if (params.to) u.set('to', params.to)
  u.set('sort', params.sort)
  return (
    <a
      href={`/dashboard/leads?${u.toString()}`}
      className="lead-focus inline-flex h-8 shrink-0 items-center rounded-full px-3 text-[12.5px] font-medium transition-colors"
      style={
        active
          ? {
              color: '#fff',
              background: 'var(--lead-accent)',
            }
          : {
              color: 'var(--lead-body)',
              background: 'var(--lead-surface)',
              border: '1px solid var(--lead-line)',
            }
      }
    >
      {label}
    </a>
  )
}

function buildHref(params: LeadsQuery, page: number) {
  const u = new URLSearchParams()
  u.set('view', 'table')
  if (params.stage) u.set('stage', params.stage)
  if (params.q) u.set('q', params.q)
  if (params.from) u.set('from', params.from)
  if (params.to) u.set('to', params.to)
  u.set('sort', params.sort)
  u.set('page', String(page))
  return `/dashboard/leads?${u.toString()}`
}
