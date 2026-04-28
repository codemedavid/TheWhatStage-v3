import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LeadsQuery } from './_lib/schemas'
import { seedDefaultStagesIfEmpty } from './_lib/seed'
import { fetchStages, fetchFieldDefs } from './_lib/queries'
import { Toolbar } from './_components/Toolbar'
import { ViewToggle } from './_components/ViewToggle'
import { KanbanBoard } from './_components/KanbanBoard'
import { LeadsTable } from './_components/LeadsTable'

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

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  await seedDefaultStagesIfEmpty(supabase, user.id)

  const [stages, fieldDefs] = await Promise.all([
    fetchStages(supabase, user.id),
    fetchFieldDefs(supabase, user.id),
  ])

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-[#111827]">Leads</h1>
        <ViewToggle view={params.view} />
      </header>

      <Toolbar params={params} stages={stages} fieldDefs={fieldDefs} />

      {params.view === 'kanban' ? (
        <KanbanBoard userId={user.id} stages={stages} fieldDefs={fieldDefs} params={params} />
      ) : (
        <LeadsTable userId={user.id} stages={stages} fieldDefs={fieldDefs} params={params} />
      )}
    </div>
  )
}
