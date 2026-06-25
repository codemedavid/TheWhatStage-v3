'use client'
import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ProjectDrawer } from './ProjectDrawer'
import type { ProjectCardRow } from '../_lib/queries'
import type { ProjectStageRow, ProjectWorkspaceRow } from '@/lib/projects/types'

type Props = {
  // null when the `?project=<id>` target does not exist or is not owned by the
  // user — the wrapper then just strips the stale param.
  project: ProjectCardRow | null
  stages: ProjectStageRow[]
  workspaces: ProjectWorkspaceRow[]
}

// Opens the project drawer for a `?project=<id>` deep link (board card clicks,
// "Mark as project" redirects). Closing is driven by local state, not the URL
// round-trip, so the drawer dismisses instantly and a re-render does not
// reopen it. Mirrors the leads DeepLinkLeadDrawer.
export function DeepLinkProjectDrawer({ project, stages, workspaces }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  const [dismissedId, setDismissedId] = useState<string | null>(null)
  const [trackedId, setTrackedId] = useState<string | null>(project?.id ?? null)
  if ((project?.id ?? null) !== trackedId) {
    setTrackedId(project?.id ?? null)
    setDismissedId(null)
  }

  const stripParam = useCallback(() => {
    const next = new URLSearchParams(sp.toString())
    next.delete('project')
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [router, pathname, sp])

  const handleClose = useCallback(() => {
    if (project) setDismissedId(project.id)
    stripParam()
  }, [project, stripParam])

  useEffect(() => {
    if (!project) stripParam()
  }, [project, stripParam])

  if (!project || project.id === dismissedId) return null

  return (
    <ProjectDrawer
      key={project.id}
      mode="edit"
      project={project}
      stages={stages}
      workspaceId={project.workspace_id}
      workspaces={workspaces}
      onClose={handleClose}
    />
  )
}
