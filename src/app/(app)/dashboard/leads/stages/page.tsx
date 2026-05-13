import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchStages } from '../_lib/queries'
import { seedDefaultStagesIfEmpty } from '../_lib/seed'
import { needsStageUpgrade } from '@/lib/leads/upgrade'
import { StageManager } from '../_components/StageManager'
import { UpgradeBanner } from './_components/UpgradeBanner'
import { StageSuggestionsPanel } from './_components/StageSuggestionsPanel'

export default async function StagesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  await seedDefaultStagesIfEmpty(supabase, user.id)
  const stages = await fetchStages(supabase, user.id)
  const showBanner = await needsStageUpgrade(createAdminClient(), user.id)
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Pipeline stages</h1>
      {showBanner && <UpgradeBanner />}
      <StageSuggestionsPanel />
      <StageManager stages={stages} />
    </div>
  )
}
