import { createClient } from '@/lib/supabase/server'
import { fetchContactLeadsPage } from '../_lib/queries'
import type { LeadsQuery } from '../_lib/schemas'
import type { StageRow, FieldDefRow, CampaignOption } from '../_lib/queries'
import { ContactListClient } from './ContactList.client'

export async function ContactList({
  userId, stages, fieldDefs, campaigns, params,
}: {
  userId: string
  stages: StageRow[]
  fieldDefs: FieldDefRow[]
  campaigns: CampaignOption[]
  params: LeadsQuery
}) {
  const supabase = await createClient()
  const { rows, total } = await fetchContactLeadsPage(supabase, userId, params)

  return (
    <ContactListClient
      rows={rows}
      total={total}
      stages={stages}
      fieldDefs={fieldDefs}
      campaigns={campaigns}
      page={params.page}
    />
  )
}
