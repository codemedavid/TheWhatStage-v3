import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  ensureDefaultProjectStages,
  fetchProjectStagesCached,
  fetchBoardProjects,
  fetchProjectById,
} from './_lib/queries'
import { ProjectBoardClient } from './_components/ProjectBoard.client'
import { DeepLinkProjectDrawer } from './_components/DeepLinkProjectDrawer.client'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const projectId =
    typeof sp.project === 'string' && UUID_RE.test(sp.project) ? sp.project : undefined

  return (
    <div data-leads-root className="px-4 py-6 md:px-8">
      <Suspense fallback={<BoardFallback />}>
        <ProjectsBody projectId={projectId} />
      </Suspense>
    </div>
  )
}

async function ProjectsBody({ projectId }: { projectId?: string }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  await ensureDefaultProjectStages(user.id)

  const [stages, projects, deepLinkProject] = await Promise.all([
    fetchProjectStagesCached(user.id),
    fetchBoardProjects(supabase, user.id),
    projectId ? fetchProjectById(supabase, user.id, projectId) : Promise.resolve(null),
  ])

  const columns = stages.map((stage) => ({
    stage,
    projects: projects.filter((p) => p.stage_id === stage.id),
  }))

  return (
    <>
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-[20px] font-semibold" style={{ color: 'var(--lead-ink)' }}>
          Projects
        </h1>
        <span className="text-[13px]" style={{ color: 'var(--lead-muted)' }}>
          {projects.length} {projects.length === 1 ? 'project' : 'projects'} · {stages.length} stages
        </span>
      </header>

      <ProjectBoardClient columns={columns} stages={stages} />

      {projectId && (
        <DeepLinkProjectDrawer project={deepLinkProject} stages={stages} />
      )}
    </>
  )
}

function BoardFallback() {
  return (
    <div className="animate-pulse">
      <div className="mb-5 h-6 w-32 rounded bg-[#E5E7EB]" />
      <div className="flex gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="w-[296px] shrink-0 space-y-2 rounded-2xl border border-[#E5E7EB] bg-white p-3" style={{ minHeight: 320 }}>
            <div className="h-4 w-24 rounded bg-[#E5E7EB]" />
            <div className="h-20 rounded bg-[#F3F4F6]" />
            <div className="h-20 rounded bg-[#F3F4F6]" />
          </div>
        ))}
      </div>
    </div>
  )
}
