import type { SupabaseClient } from '@supabase/supabase-js'
import {
  generateFollowupGraph,
  parseTouchpointsFromWorkflow,
  validateTouchpoints,
  type FollowupTouchpoint,
} from './booking-followups'
import type { WorkflowGraph, WorkflowTrigger } from './types'

export interface ManagedFollowupsLoadResult {
  workflowId: string
  manuallyEdited: boolean
  version: number
  status: 'draft' | 'active' | 'paused' | 'archived'
  touchpoints: FollowupTouchpoint[]
}

interface WorkflowRow {
  id: string
  manually_edited: boolean
  version: number
  status: 'draft' | 'active' | 'paused' | 'archived'
  triggers: WorkflowTrigger[] | null
  graph: WorkflowGraph | null
}

export async function loadManagedFollowups(
  admin: SupabaseClient,
  pageId: string,
): Promise<ManagedFollowupsLoadResult | null> {
  const { data: wf } = await admin
    .from('workflows')
    .select('id, manually_edited, version, status, triggers, graph')
    .eq('managed_kind', 'booking_followups')
    .eq('managed_source_id', pageId)
    .maybeSingle<WorkflowRow>()

  if (!wf) return null

  const touchpoints =
    wf.triggers && wf.graph
      ? parseTouchpointsFromWorkflow({ triggers: wf.triggers, graph: wf.graph })
      : []

  return {
    workflowId: wf.id,
    manuallyEdited: wf.manually_edited,
    version: wf.version,
    status: wf.status,
    touchpoints,
  }
}

export type SaveManagedFollowupsResult =
  | { ok: true; workflowId: string }
  | { ok: false; reason: string }

export async function saveManagedFollowups(
  admin: SupabaseClient,
  args: {
    userId: string
    pageId: string
    pageTitle: string
    touchpoints: FollowupTouchpoint[]
  },
): Promise<SaveManagedFollowupsResult> {
  const validationError = validateTouchpoints(args.touchpoints)
  if (validationError) return { ok: false, reason: validationError }

  const existing = await loadManagedFollowups(admin, args.pageId)
  if (existing && existing.manuallyEdited) {
    return { ok: false, reason: 'manually_edited' }
  }

  const generated = generateFollowupGraph(args.touchpoints, args.pageId)
  const triggers = generated.triggers
  const graph: WorkflowGraph = {
    nodes: generated.nodes,
    edges: generated.edges,
    start_node_id: generated.start_node_id,
  }

  const name = `${args.pageTitle || 'Booking'} — Follow-ups`
  const status: 'active' | 'paused' = triggers.length > 0 ? 'active' : 'paused'

  if (!existing) {
    const { data: ins, error } = await admin
      .from('workflows')
      .insert({
        user_id: args.userId,
        name,
        status,
        version: 1,
        trigger: triggers[0] ?? { kind: 'booking_offset', config: {} },
        triggers,
        graph,
        managed_kind: 'booking_followups',
        managed_source_id: args.pageId,
        manually_edited: false,
      })
      .select('id')
      .maybeSingle<{ id: string }>()
    if (error || !ins) return { ok: false, reason: error?.message ?? 'insert failed' }
    return { ok: true, workflowId: ins.id }
  }

  const { error } = await admin
    .from('workflows')
    .update({
      name,
      status,
      version: existing.version + 1,
      trigger: triggers[0] ?? { kind: 'booking_offset', config: {} },
      triggers,
      graph,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.workflowId)
    .eq('manually_edited', false)
  if (error) return { ok: false, reason: error.message }
  return { ok: true, workflowId: existing.workflowId }
}

export async function resetManualEdit(
  admin: SupabaseClient,
  pageId: string,
): Promise<void> {
  await admin
    .from('workflows')
    .update({ manually_edited: false, updated_at: new Date().toISOString() })
    .eq('managed_kind', 'booking_followups')
    .eq('managed_source_id', pageId)
}
