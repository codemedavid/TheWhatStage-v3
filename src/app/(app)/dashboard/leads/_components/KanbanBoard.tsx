import { createClient } from '@/lib/supabase/server'
import { fetchLeadsPage } from '../_lib/queries'
import type { LeadsQuery } from '../_lib/schemas'
import type { StageRow, FieldDefRow, CampaignOption } from '../_lib/queries'
import { KanbanBoardClient } from './KanbanBoard.client'

export async function KanbanBoard({
  userId, stages, fieldDefs, campaigns, params,
}: {
  userId: string
  stages: StageRow[]
  fieldDefs: FieldDefRow[]
  campaigns: CampaignOption[]
  params: LeadsQuery
}) {
  const supabase = await createClient()
  const columns = await Promise.all(
    stages.map(async (s) => {
      const { rows, total } = await fetchLeadsPage(supabase, userId, params, s.id)
      return { stage: s, leads: rows, total }
    }),
  )
  return (
    <KanbanBoardClient
      columns={columns}
      stages={stages}
      fieldDefs={fieldDefs}
      campaigns={campaigns}
      params={params}
    />
  )
}
