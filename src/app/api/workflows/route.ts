import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { WorkflowGraph, WorkflowTrigger } from '@/lib/workflow/types'

export const dynamic = 'force-dynamic'

const BLANK_GRAPH: WorkflowGraph = {
  nodes: [{ id: 'stop-1', type: 'stop', config: {} }],
  edges: [],
  start_node_id: 'stop-1',
}

const BLANK_TRIGGER: WorkflowTrigger = {
  kind: 'stage_entered',
  config: {},
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('workflows')
    .select('id, name, status, trigger, version, updated_at, created_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ workflows: data ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    // empty body — use defaults
  }

  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Untitled workflow'
  const triggersInput = Array.isArray(body.triggers) ? (body.triggers as WorkflowTrigger[]) : null
  const trigger = triggersInput?.[0] ?? (body.trigger as WorkflowTrigger) ?? BLANK_TRIGGER
  const graph = (body.graph as WorkflowGraph) ?? BLANK_GRAPH

  const insertRow: Record<string, unknown> = {
    user_id: user.id, name, status: 'draft', trigger, graph,
  }
  if (triggersInput && triggersInput.length > 0) insertRow.triggers = triggersInput

  const { data, error } = await supabase
    .from('workflows')
    .insert(insertRow)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ workflow: data }, { status: 201 })
}
