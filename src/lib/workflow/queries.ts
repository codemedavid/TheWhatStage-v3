import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkflowTrigger, WorkflowGraph } from './types'

export interface WorkflowListItem {
  id: string
  name: string
  status: 'draft' | 'active' | 'paused' | 'archived'
  trigger: WorkflowTrigger
  triggers: WorkflowTrigger[]
  version: number
  run_count_7d: number
  success_count_7d: number
  failed_count_7d: number
  last_run_at: string | null
  updated_at: string
  created_at: string
}

export interface WorkflowDetail extends WorkflowListItem {
  graph: WorkflowGraph
  health: {
    policy_blocked_7d: number
    failed_7d: number
  }
}

export async function fetchWorkflows(
  supabase: SupabaseClient,
  userId: string,
): Promise<WorkflowListItem[]> {
  const { data, error } = await supabase
    .from('workflows')
    .select('id, name, status, trigger, triggers, version, updated_at, created_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  if (error) throw new Error(`fetchWorkflows: ${error.message}`)
  if (!data?.length) return []

  const wfIds = data.map((w: Record<string, unknown>) => w.id as string)
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: runs, error: rErr } = await supabase
    .from('workflow_runs')
    .select('workflow_id, status, created_at')
    .in('workflow_id', wfIds)
    .gte('created_at', since)
  if (rErr) throw new Error(`fetchWorkflows runs: ${rErr.message}`)

  type RunRow = { workflow_id: string; status: string; created_at: string }
  const stats = new Map<string, { total: number; done: number; failed: number; last: string | null }>()
  for (const r of (runs as RunRow[]) ?? []) {
    const s = stats.get(r.workflow_id) ?? { total: 0, done: 0, failed: 0, last: null }
    s.total++
    if (r.status === 'done') s.done++
    if (r.status === 'failed') s.failed++
    if (!s.last || r.created_at > s.last) s.last = r.created_at
    stats.set(r.workflow_id, s)
  }

  return (data as Record<string, unknown>[]).map((w) => {
    const s = stats.get(w.id as string) ?? { total: 0, done: 0, failed: 0, last: null }
    return {
      id: w.id as string,
      name: w.name as string,
      status: w.status as WorkflowListItem['status'],
      trigger: w.trigger as WorkflowTrigger,
      triggers: Array.isArray(w.triggers) && (w.triggers as WorkflowTrigger[]).length > 0
        ? w.triggers as WorkflowTrigger[]
        : [w.trigger as WorkflowTrigger],
      version: w.version as number,
      run_count_7d: s.total,
      success_count_7d: s.done,
      failed_count_7d: s.failed,
      last_run_at: s.last,
      updated_at: w.updated_at as string,
      created_at: w.created_at as string,
    }
  })
}

export async function fetchWorkflow(
  supabase: SupabaseClient,
  userId: string,
  id: string,
): Promise<WorkflowDetail | null> {
  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single()
  if (error || !data) return null

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: runs } = await supabase
    .from('workflow_runs')
    .select('id, status, created_at')
    .eq('workflow_id', id)
    .gte('created_at', since)

  const runRows = (runs ?? []) as Array<{ id: string; status: string; created_at: string }>
  const runIds = runRows.map((r) => r.id)

  let policyBlocked = 0
  if (runIds.length > 0) {
    const { count } = await supabase
      .from('workflow_run_steps')
      .select('id', { count: 'exact', head: true })
      .in('run_id', runIds)
      .eq('decision', 'policy_blocked')
    policyBlocked = count ?? 0
  }

  const totalRuns = runRows.length
  const doneRuns = runRows.filter((r) => r.status === 'done').length
  const failedRuns = runRows.filter((r) => r.status === 'failed').length
  const lastRun = runRows.reduce((latest: string | null, r) => {
    return !latest || r.created_at > latest ? r.created_at : latest
  }, null)

  const w = data as Record<string, unknown>
  return {
    id: w.id as string,
    name: w.name as string,
    status: w.status as WorkflowListItem['status'],
    trigger: w.trigger as WorkflowTrigger,
    triggers: Array.isArray(w.triggers) && (w.triggers as WorkflowTrigger[]).length > 0
      ? w.triggers as WorkflowTrigger[]
      : [w.trigger as WorkflowTrigger],
    graph: w.graph as WorkflowGraph,
    version: w.version as number,
    run_count_7d: totalRuns,
    success_count_7d: doneRuns,
    failed_count_7d: failedRuns,
    last_run_at: lastRun,
    updated_at: w.updated_at as string,
    created_at: w.created_at as string,
    health: {
      policy_blocked_7d: policyBlocked,
      failed_7d: failedRuns,
    },
  }
}
