import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { fetchCampaigns } from './_lib/queries'
import { CampaignsList } from './_components/CampaignsList'
import './funnels.css'

export default async function FunnelsIndex() {
  return (
    <Suspense fallback={<ListFallback />}>
      <List />
    </Suspense>
  )
}

function ListFallback() {
  return (
    <div data-funnels-root>
      <div className="fn-wrap">
        <div className="fn-empty">Loading…</div>
      </div>
    </div>
  )
}

async function List() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const campaigns = await fetchCampaigns(supabase, user.id)
  return <CampaignsList campaigns={campaigns} />
}
