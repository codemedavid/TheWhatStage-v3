import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { WorkflowGraph, WorkflowTrigger } from '@/lib/workflow/types'

export const dynamic = 'force-dynamic'

const ALLOWED_STATUSES = new Set(['draft', 'active', 'paused', 'archived'])
const ALLOWED_TRIGGER_KINDS = new Set([
  'stage_entered', 'stage_idle', 'submission_received', 'booking_offset', 'cart_abandoned',
])
const ALLOWED_NODE_TYPES = new Set([
  'send', 'set_stage', 'wait', 'wait_for_reply', 'if', 'classify_and_route',
  'request_marketing_optin', 'request_otn', 'stop',
])
const MAX_NODES = 200
const MAX_EDGES = 500
const MAX_TRIGGERS = 10

function validateGraph(input: unknown): WorkflowGraph | { error: string } {
  if (!input || typeof input !== 'object') return { error: 'graph must be an object' }
  const g = input as { nodes?: unknown; edges?: unknown; start_node_id?: unknown }
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) return { error: 'graph.nodes / graph.edges required' }
  if (g.nodes.length > MAX_NODES) return { error: `too many nodes (max ${MAX_NODES})` }
  if (g.edges.length > MAX_EDGES) return { error: `too many edges (max ${MAX_EDGES})` }
  const seenIds = new Set<string>()
  for (const n of g.nodes) {
    if (!n || typeof n !== 'object') return { error: 'invalid node' }
    const node = n as { id?: unknown; type?: unknown }
    if (typeof node.id !== 'string' || !node.id) return { error: 'node.id required' }
    if (seenIds.has(node.id)) return { error: `duplicate node id: ${node.id}` }
    seenIds.add(node.id)
    if (typeof node.type !== 'string' || !ALLOWED_NODE_TYPES.has(node.type)) {
      return { error: `invalid node.type: ${String(node.type)}` }
    }
  }
  for (const e of g.edges) {
    if (!e || typeof e !== 'object') return { error: 'invalid edge' }
    const edge = e as { from?: unknown; to?: unknown; label?: unknown }
    if (typeof edge.from !== 'string' || typeof edge.to !== 'string' || typeof edge.label !== 'string') {
      return { error: 'edge.from / edge.to / edge.label must be strings' }
    }
    if (edge.label.length > 64) return { error: 'edge.label too long' }
  }
  if (typeof g.start_node_id !== 'string' || !seenIds.has(g.start_node_id)) {
    return { error: 'start_node_id must reference an existing node' }
  }
  return g as WorkflowGraph
}

function validateTriggers(input: unknown): WorkflowTrigger[] | { error: string } {
  if (!Array.isArray(input)) return { error: 'triggers must be an array' }
  if (input.length === 0) return { error: 'at least one trigger required' }
  if (input.length > MAX_TRIGGERS) return { error: `too many triggers (max ${MAX_TRIGGERS})` }
  for (const t of input) {
    if (!t || typeof t !== 'object') return { error: 'invalid trigger' }
    const trig = t as { kind?: unknown; config?: unknown }
    if (typeof trig.kind !== 'string' || !ALLOWED_TRIGGER_KINDS.has(trig.kind)) {
      return { error: `invalid trigger.kind: ${String(trig.kind)}` }
    }
    if (trig.config != null && (typeof trig.config !== 'object' || Array.isArray(trig.config))) {
      return { error: 'trigger.config must be an object' }
    }
  }
  return input as WorkflowTrigger[]
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ workflow: data })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.name === 'string' && body.name.trim()) {
    update.name = body.name.trim().slice(0, 200)
  }
  if (typeof body.status === 'string') {
    if (!ALLOWED_STATUSES.has(body.status)) {
      return NextResponse.json({ error: `invalid status: ${body.status}` }, { status: 400 })
    }
    update.status = body.status
  }
  if (Array.isArray(body.triggers)) {
    const validated = validateTriggers(body.triggers)
    if ('error' in validated) return NextResponse.json({ error: validated.error }, { status: 400 })
    update.triggers = validated
    update.trigger = validated[0]
  } else if (body.trigger) {
    const validated = validateTriggers([body.trigger])
    if ('error' in validated) return NextResponse.json({ error: validated.error }, { status: 400 })
    update.trigger = validated[0]
  }
  if (body.graph) {
    const validated = validateGraph(body.graph)
    if ('error' in validated) return NextResponse.json({ error: validated.error }, { status: 400 })
    update.graph = validated
    update.version = (body.version as number | undefined) ?? 1
  }

  const { data, error } = await supabase
    .from('workflows')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ workflow: data })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('workflows')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
