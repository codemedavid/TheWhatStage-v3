import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { WorkflowGraph, WorkflowNode, WorkflowEdge, IfNodeConfig, IfCondition } from '@/lib/workflow/types'

export const dynamic = 'force-dynamic'

interface SimStep {
  node_id: string
  node_type: string
  decision: string
  note: string
  blocked?: boolean
}

interface SimContext {
  lead: { id: string; stage_id: string | null } | null
  thread: { last_inbound_at: string | null } | null
  lastInboundMs: number | null
}

function followEdge(graph: WorkflowGraph, fromId: string, label: string): WorkflowNode | null {
  const edge = graph.edges.find((e: WorkflowEdge) => e.from === fromId && e.label === label)
  if (!edge) return null
  return graph.nodes.find((n: WorkflowNode) => n.id === edge.to) ?? null
}

function inWindow(ctx: SimContext): boolean {
  if (!ctx.lastInboundMs) return false
  return Date.now() - ctx.lastInboundMs < 24 * 60 * 60 * 1000
}

function evalCondition(cond: IfCondition, ctx: SimContext): boolean {
  const p = cond.params as Record<string, unknown>
  switch (cond.kind) {
    case 'in_stage':
      return ctx.lead?.stage_id === p.stage_id
    case 'replied_within':
      return inWindow(ctx)
    case 'submission_outcome_is':
      return false // dry run: no submission context
    case 'custom_field_eq':
      return false // dry run: no custom fields loaded
    default:
      return false
  }
}

function simulateGraph(graph: WorkflowGraph, ctx: SimContext): SimStep[] {
  const steps: SimStep[] = []
  let current: WorkflowNode | undefined = graph.nodes.find((n: WorkflowNode) => n.id === graph.start_node_id)
  const visited = new Set<string>()
  const MAX = 30

  while (current && steps.length < MAX) {
    if (visited.has(current.id)) {
      steps.push({ node_id: current.id, node_type: current.type, decision: 'loop_detected', note: 'Cycle detected — stopped' })
      break
    }
    visited.add(current.id)

    switch (current.type) {
      case 'send': {
        const canSend = inWindow(ctx)
        const decision = canSend ? 'success' : 'policy_blocked'
        const note = canSend
          ? 'Inside 24-hour window — message would be sent'
          : 'Outside 24-hour window — send would be policy_blocked'
        steps.push({ node_id: current.id, node_type: current.type, decision, note, blocked: !canSend })
        current = followEdge(graph, current.id, decision) ?? undefined
        break
      }
      case 'set_stage': {
        const cfg = current.config as Record<string, unknown>
        steps.push({ node_id: current.id, node_type: current.type, decision: 'then', note: `Would move lead to stage ${cfg.stage_id ?? '(unset)'}` })
        current = followEdge(graph, current.id, 'then') ?? undefined
        break
      }
      case 'wait': {
        const cfg = current.config as Record<string, unknown>
        const ms = typeof cfg.duration_ms === 'number' ? cfg.duration_ms : null
        const label = ms ? `${Math.round(ms / 60000)} min` : 'timed wait'
        steps.push({ node_id: current.id, node_type: current.type, decision: 'timeout', note: `Run would pause for ${label} then continue via timeout edge` })
        current = followEdge(graph, current.id, 'timeout') ?? undefined
        break
      }
      case 'wait_for_reply': {
        const cfg = current.config as Record<string, unknown>
        const ms = typeof cfg.timeout_ms === 'number' ? cfg.timeout_ms : null
        const label = ms ? `${Math.round(ms / 60000)} min` : 'configured timeout'
        steps.push({ node_id: current.id, node_type: current.type, decision: 'on_timeout', note: `Dry run: no reply — simulating ${label} timeout` })
        current = followEdge(graph, current.id, 'on_timeout') ?? undefined
        break
      }
      case 'if': {
        const cfg = current.config as unknown as IfNodeConfig
        const conditions = cfg.conditions ?? []
        const results = conditions.map((c: IfCondition) => evalCondition(c, ctx))
        const pass = cfg.logic === 'OR' ? results.some(Boolean) : results.every(Boolean)
        const decision = pass ? 'then' : 'else'
        steps.push({
          node_id: current.id,
          node_type: current.type,
          decision,
          note: `Conditions evaluated (${cfg.logic}): ${pass ? 'passed → then' : 'failed → else'}`,
        })
        current = followEdge(graph, current.id, decision) ?? undefined
        break
      }
      case 'classify_and_route': {
        steps.push({ node_id: current.id, node_type: current.type, decision: 'continue', note: 'Dry run: skipping LLM classify — following continue edge' })
        current = followEdge(graph, current.id, 'continue') ?? undefined
        break
      }
      case 'request_marketing_optin': {
        steps.push({ node_id: current.id, node_type: current.type, decision: 'timeout', note: 'Dry run: no reply — simulating timeout edge' })
        current = followEdge(graph, current.id, 'timeout') ?? undefined
        break
      }
      case 'request_otn': {
        steps.push({ node_id: current.id, node_type: current.type, decision: 'timeout', note: 'Dry run: no grant — simulating timeout edge' })
        current = followEdge(graph, current.id, 'timeout') ?? undefined
        break
      }
      case 'stop': {
        steps.push({ node_id: current.id, node_type: current.type, decision: 'done', note: 'Workflow run ends here' })
        current = undefined
        break
      }
      default: {
        steps.push({ node_id: current.id, node_type: current.type, decision: 'unknown', note: `Unknown node type: ${current.type}` })
        current = undefined
      }
    }
  }

  return steps
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    // ok
  }

  const { data: wf, error: wfErr } = await supabase
    .from('workflows')
    .select('graph')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()
  if (wfErr || !wf) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const leadId = typeof body.lead_id === 'string' ? body.lead_id : null
  let lead: { id: string; stage_id: string | null } | null = null
  let thread: { last_inbound_at: string | null } | null = null

  if (leadId) {
    const { data: l } = await supabase
      .from('leads')
      .select('id, stage_id')
      .eq('id', leadId)
      .eq('user_id', user.id)
      .single()
    if (l) lead = l as { id: string; stage_id: string | null }

    const { data: t } = await supabase
      .from('messenger_threads')
      .select('last_inbound_at')
      .eq('lead_id', leadId)
      .order('last_inbound_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
    if (t) thread = t as { last_inbound_at: string | null }
  }

  const ctx: SimContext = {
    lead,
    thread,
    lastInboundMs: thread?.last_inbound_at ? new Date(thread.last_inbound_at).getTime() : null,
  }

  const graph = (wf as Record<string, unknown>).graph as WorkflowGraph
  const steps = simulateGraph(graph, ctx)

  return NextResponse.json({ steps, dry_run: true })
}
