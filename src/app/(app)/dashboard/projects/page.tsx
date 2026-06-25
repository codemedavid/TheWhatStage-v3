import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  ensureDefaultWorkspace,
  fetchWorkspaceSummaries,
  fetchProjectWorkspaceId,
} from './_lib/workspaces'
import { WorkspacesGrid } from './_components/WorkspacesGrid.client'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Params the pre-workspaces board wrote to /dashboard/projects. When any are
// present we forward to the default workspace board so bookmarked/shared filtered
// views keep working instead of dead-ending on the new index.
const BOARD_PARAM_KEYS = ['project', 'q', 'sort', 'range', 'from', 'to', 'archived'] as const

type SearchParams = Record<string, string | string[] | undefined>

function toQueryString(sp: SearchParams, omit?: string): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (k === omit) continue
    if (typeof v === 'string') p.set(k, v)
  }
  return p.toString()
}

export default async function ProjectsIndexPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const sp = await searchParams

  return (
    <div data-leads-root className="px-4 py-6 md:px-8">
      <Suspense fallback={<IndexFallback />}>
        <ProjectsIndexBody sp={sp} />
      </Suspense>
    </div>
  )
}

async function ProjectsIndexBody({ sp }: { sp: SearchParams }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const projectId =
    typeof sp.project === 'string' && UUID_RE.test(sp.project) ? sp.project : undefined

  // Legacy deep-link `/dashboard/projects?project=<id>` (lead drawer, "Mark as
  // project", stage leads list): forward to the card's workspace board with the
  // drawer open, preserving any other params.
  if (projectId) {
    const wsId = await fetchProjectWorkspaceId(supabase, user.id, projectId)
    if (wsId) {
      const qs = toQueryString(sp)
      redirect(`/dashboard/projects/${wsId}${qs ? `?${qs}` : ''}`)
    }
  }

  const defaultWsId = await ensureDefaultWorkspace(user.id)

  // Legacy filtered-board deep-links (?q/?sort/?range/?archived, or a now-stale
  // ?project=) → forward to the default workspace board, dropping any unresolved
  // project id, so shared filter URLs land on a board instead of the index.
  if (BOARD_PARAM_KEYS.some((k) => sp[k] != null)) {
    const qs = toQueryString(sp, 'project')
    redirect(`/dashboard/projects/${defaultWsId}${qs ? `?${qs}` : ''}`)
  }

  const summaries = await fetchWorkspaceSummaries(supabase, user.id)

  return (
    <div>
      <header className="mb-1">
        <h1 className="text-[20px] font-semibold" style={{ color: 'var(--lead-ink)' }}>
          Projects
        </h1>
        <p className="mt-0.5 text-[13px]" style={{ color: 'var(--lead-muted)' }}>
          Each workspace runs its own stages, follow-ups, and projects. Open one to manage its board,
          or duplicate a workspace to reuse its workflow.
        </p>
      </header>

      <div className="mt-5">
        <WorkspacesGrid summaries={summaries} />
      </div>
    </div>
  )
}

function IndexFallback() {
  return (
    <div className="animate-pulse">
      <div className="mb-5 h-6 w-32 rounded bg-[#E5E7EB]" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-32 rounded-2xl border border-[#E5E7EB] bg-white p-4">
            <div className="h-4 w-24 rounded bg-[#E5E7EB]" />
            <div className="mt-3 h-3 w-32 rounded bg-[#F3F4F6]" />
          </div>
        ))}
      </div>
    </div>
  )
}
