import { Suspense } from 'react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  fetchProjectStagesCached,
  fetchBoardProjects,
  fetchProjectById,
} from '../_lib/queries'
import { fetchWorkspaces, fetchWorkspaceById } from '../_lib/workspaces'
import { ProjectsQuery } from '../_lib/schemas'
import { resolveProjectsDateRange } from '../_lib/date-range'
import { computeProjectStats } from '../_lib/stats'
import { ProjectViews, type ProjectView } from '../_components/ProjectViews.client'
import { ProjectsToolbar } from '../_components/ProjectsToolbar'
import { ProjectStats } from '../_components/ProjectStats'
import { ProjectsNavProvider } from '../_components/_useUrlState'
import { ArchiveRevealProvider } from '../_components/_useArchiveReveal'
import { DeepLinkProjectDrawer } from '../_components/DeepLinkProjectDrawer.client'
import { WorkspaceSwitcher } from '../_components/WorkspaceSwitcher'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function WorkspaceBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { workspaceId } = await params
  if (!UUID_RE.test(workspaceId)) notFound()
  const sp = await searchParams
  const query = ProjectsQuery.parse({
    q: sp.q, range: sp.range, from: sp.from, to: sp.to, sort: sp.sort, archived: sp.archived,
  })
  const projectId =
    typeof sp.project === 'string' && UUID_RE.test(sp.project) ? sp.project : undefined
  const view: ProjectView = sp.view === 'list' ? 'list' : 'kanban'

  return (
    <div data-leads-root className="px-4 py-6 md:px-8">
      <Suspense fallback={<BoardFallback />}>
        <WorkspaceBoardBody workspaceId={workspaceId} params={query} projectId={projectId} view={view} />
      </Suspense>
    </div>
  )
}

async function WorkspaceBoardBody({
  workspaceId,
  params,
  projectId,
  view,
}: {
  workspaceId: string
  params: ProjectsQuery
  projectId?: string
  view: ProjectView
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const workspace = await fetchWorkspaceById(supabase, user.id, workspaceId)
  if (!workspace) notFound()

  const queryParams = resolveProjectsDateRange(params)

  const [workspaces, stages, projects, deepLinkProject] = await Promise.all([
    fetchWorkspaces(supabase, user.id),
    fetchProjectStagesCached(user.id, workspaceId),
    fetchBoardProjects(supabase, user.id, workspaceId, queryParams),
    projectId ? fetchProjectById(supabase, user.id, projectId) : Promise.resolve(null),
  ])

  const columns = stages.map((stage) => ({
    stage,
    projects: projects.filter((p) => p.stage_id === stage.id),
  }))
  const stats = computeProjectStats(projects, stages)
  // A ?project= card that has since moved to another workspace self-heals: send
  // the deep-link to the card's CURRENT board (mirrors the index shim) instead of
  // silently dropping it.
  if (projectId && deepLinkProject && deepLinkProject.workspace_id !== workspaceId) {
    redirect(`/dashboard/projects/${deepLinkProject.workspace_id}?project=${projectId}`)
  }
  const deepLink = deepLinkProject

  return (
    <ProjectsNavProvider>
      <div className="mb-3">
        <Link
          href="/dashboard/projects"
          className="lead-focus inline-flex items-center gap-1 text-[12.5px] font-medium"
          style={{ color: 'var(--lead-muted)' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m15 18-6-6 6-6" />
          </svg>
          All workspaces
        </Link>
      </div>
      <header className="mb-1 flex flex-wrap items-center gap-3">
        <WorkspaceSwitcher workspaces={workspaces} current={workspace} />
        <span className="text-[13px]" style={{ color: 'var(--lead-muted)' }}>
          {projects.length} {projects.length === 1 ? 'project' : 'projects'} · {stages.length} stages
        </span>
      </header>

      <ProjectStats stats={stats} />

      {/* "Show archived" is client state shared by the toolbar toggle and the
          board — seeded from ?archived=1 for deep-links, then toggled instantly
          without a server round-trip (which silently failed to re-render). */}
      <ArchiveRevealProvider initial={params.archived}>
        <ProjectsToolbar params={params} />

        <ProjectViews
          initialView={view}
          columns={columns}
          stages={stages}
          workspaceId={workspaceId}
          workspaces={workspaces}
        />
      </ArchiveRevealProvider>

      {projectId && (
        <DeepLinkProjectDrawer project={deepLink} stages={stages} workspaces={workspaces} />
      )}
    </ProjectsNavProvider>
  )
}

function BoardFallback() {
  return (
    <div className="animate-pulse">
      <div className="mb-5 h-6 w-32 rounded" style={{ background: 'var(--lead-surface-2)' }} />
      <div className="flex gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="w-[296px] shrink-0 space-y-2 rounded-2xl p-3"
            style={{ minHeight: 320, background: 'var(--lead-surface)', border: '1px solid var(--lead-line)' }}
          >
            <div className="h-4 w-24 rounded" style={{ background: 'var(--lead-surface-2)' }} />
            <div className="h-20 rounded" style={{ background: 'var(--lead-surface-2)' }} />
            <div className="h-20 rounded" style={{ background: 'var(--lead-surface-2)' }} />
          </div>
        ))}
      </div>
    </div>
  )
}
