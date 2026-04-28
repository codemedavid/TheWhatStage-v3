import { createClient } from '@/lib/supabase/server'
import { fetchLeadsPage } from '../_lib/queries'
import type { LeadsQuery } from '../_lib/schemas'
import type { StageRow, FieldDefRow } from '../_lib/queries'
import { LeadsTableClient } from './LeadsTable.client'
import { Pagination } from './Pagination'

export async function LeadsTable({
  userId, stages, fieldDefs, params,
}: {
  userId: string
  stages: StageRow[]
  fieldDefs: FieldDefRow[]
  params: LeadsQuery
}) {
  const supabase = await createClient()
  const stageId = params.stage
  const { rows, total } = await fetchLeadsPage(supabase, userId, params, stageId)

  return (
    <div className="space-y-3">
      <StageTabs stages={stages} active={stageId} params={params} />
      <LeadsTableClient rows={rows} stages={stages} fieldDefs={fieldDefs} />
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
    <div className="flex gap-1 flex-wrap">
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
      className={`px-3 py-1.5 text-sm rounded-md border ${active ? 'bg-emerald-50 border-emerald-600 text-emerald-700' : 'bg-white'}`}
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
