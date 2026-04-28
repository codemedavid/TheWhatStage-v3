import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchStages } from '../_lib/queries'
import { seedDefaultStagesIfEmpty } from '../_lib/seed'
import { StageManager } from '../_components/StageManager'

export default async function StagesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  await seedDefaultStagesIfEmpty(supabase, user.id)
  const stages = await fetchStages(supabase, user.id)
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Pipeline stages</h1>
      <StageManager stages={stages} />
    </div>
  )
}
