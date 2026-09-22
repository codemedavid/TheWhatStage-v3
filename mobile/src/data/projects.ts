import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api'
import type { ProjectRow, ProjectStage, ProjectStageEvent, Workspace } from './types'

// `projects` has two FKs to project_stages, so the embed must name the FK.
const STAGE_EMBED = 'project_stages!projects_stage_id_fkey(name, kind)'
const PROJECT_SELECT = `id, workspace_id, lead_id, stage_id, title, description, value, currency, notes, position, archived_at, created_at, updated_at, leads(name, email, phone, messenger_threads(picture_url, unread_count, missed_count)), ${STAGE_EMBED}`

export const projectKeys = {
  all: ['projects'] as const,
  workspaces: ['projects', 'workspaces'] as const,
  stages: (wsId: string) => ['projects', 'stages', wsId] as const,
  board: (wsId: string) => ['projects', 'board', wsId] as const,
  one: (id: string) => ['projects', 'one', id] as const,
  byLead: (leadId: string) => ['projects', 'byLead', leadId] as const,
  events: (id: string) => ['projects', 'events', id] as const,
}

export function useWorkspaces() {
  return useQuery({
    queryKey: projectKeys.workspaces,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_workspaces')
        .select('id, name, description, position, is_default, color')
        .order('position', { ascending: true })
      if (error) throw new Error(error.message)
      return (data ?? []) as Workspace[]
    },
  })
}

export function useProjectStages(workspaceId: string | undefined) {
  return useQuery({
    queryKey: projectKeys.stages(workspaceId ?? ''),
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_stages')
        .select('id, workspace_id, name, position, is_default, kind, color')
        .eq('workspace_id', workspaceId!)
        .order('position', { ascending: true })
      if (error) throw new Error(error.message)
      return (data ?? []) as ProjectStage[]
    },
  })
}

export function useProjectBoard(workspaceId: string | undefined) {
  return useQuery({
    queryKey: projectKeys.board(workspaceId ?? ''),
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select(PROJECT_SELECT)
        .eq('workspace_id', workspaceId!)
        .order('position', { ascending: true })
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as ProjectRow[]
    },
  })
}

export function useProject(projectId: string | undefined) {
  return useQuery({
    queryKey: projectKeys.one(projectId ?? ''),
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select(PROJECT_SELECT)
        .eq('id', projectId!)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data ?? null) as unknown as ProjectRow | null
    },
  })
}

export function useLeadProjects(leadId: string | undefined) {
  return useQuery({
    queryKey: projectKeys.byLead(leadId ?? ''),
    enabled: !!leadId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select(PROJECT_SELECT)
        .eq('lead_id', leadId!)
        .order('updated_at', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as ProjectRow[]
    },
  })
}

export function useProjectEvents(projectId: string | undefined) {
  return useQuery({
    queryKey: projectKeys.events(projectId ?? ''),
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_stage_events')
        .select('id, from_stage_id, to_stage_id, source, reason, created_at')
        .eq('project_id', projectId!)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw new Error(error.message)
      return (data ?? []) as ProjectStageEvent[]
    },
  })
}

export function useMoveProject(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ projectId, toStageId }: { projectId: string; toStageId: string }) => {
      const res = await api.moveProject(projectId, toStageId)
      if (!res.ok) throw new Error(res.error)
    },
    onMutate: async ({ projectId, toStageId }) => {
      await qc.cancelQueries({ queryKey: projectKeys.board(workspaceId) })
      const prev = qc.getQueryData<ProjectRow[]>(projectKeys.board(workspaceId))
      qc.setQueryData<ProjectRow[]>(projectKeys.board(workspaceId), (rows) =>
        rows?.map((p) => (p.id === projectId ? { ...p, stage_id: toStageId } : p)),
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(projectKeys.board(workspaceId), ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: projectKeys.all }),
  })
}

export type ProjectPatch = Partial<Pick<ProjectRow, 'title' | 'description' | 'value' | 'notes'>>

export function useUpdateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ projectId, patch }: { projectId: string; patch: ProjectPatch }) => {
      const { error } = await supabase.from('projects').update(patch).eq('id', projectId)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: projectKeys.all }),
  })
}

export function useArchiveProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ projectId, archive }: { projectId: string; archive: boolean }) => {
      const { error } = await supabase
        .from('projects')
        .update({ archived_at: archive ? new Date().toISOString() : null })
        .eq('id', projectId)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: projectKeys.all }),
  })
}

/** Create a project for a lead in a workspace's default stage. */
export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      leadId,
      workspaceId,
      title,
      value,
    }: {
      leadId: string
      workspaceId: string
      title: string
      value?: number | null
    }) => {
      const { data: stages, error: sErr } = await supabase
        .from('project_stages')
        .select('id, is_default, position')
        .eq('workspace_id', workspaceId)
        .order('position', { ascending: true })
      if (sErr) throw new Error(sErr.message)
      const stage = (stages ?? []).find((s) => s.is_default) ?? stages?.[0]
      if (!stage) throw new Error('This workspace has no stages yet')

      const { data: maxRow } = await supabase
        .from('projects')
        .select('position')
        .eq('stage_id', stage.id)
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle()
      const position = ((maxRow?.position as number | undefined) ?? -1) + 1

      const { data: me } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from('projects')
        .insert({
          user_id: me.user?.id,
          lead_id: leadId,
          workspace_id: workspaceId,
          stage_id: stage.id,
          title: title.trim(),
          value: value ?? null,
          position,
        })
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      return data as { id: string }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: projectKeys.all }),
  })
}
