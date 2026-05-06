import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { decryptToken } from '@/lib/facebook/crypto'
import { sendOutbound } from '@/lib/messenger/outbound'
import { applyStageChange, answerWithClassification, type StageBrief } from '@/lib/chatbot/classify'
import type {
  WorkflowGraph,
  WorkflowNode,
  WorkflowRunState,
  SendNodeConfig,
  SetStageNodeConfig,
  WaitNodeConfig,
  WaitForReplyNodeConfig,
  IfNodeConfig,
  IfCondition,
  RequestMarketingOptinConfig,
  RequestOtnConfig,
} from './types'

type AdminClient = ReturnType<typeof createAdminClient>

// ---------------------------------------------------------------------------
// Row shapes (only the fields we actually read)
// ---------------------------------------------------------------------------

interface WorkflowRunRow {
  id: string
  workflow_id: string
  workflow_version: number
  user_id: string
  lead_id: string | null
  thread_id: string | null
  current_node_id: string | null
  state: WorkflowRunState
  status: string
  next_run_at: string | null
}

interface WorkflowRow {
  id: string
  version: number
  graph: WorkflowGraph
}

interface LeadRow {
  id: string
  stage_id: string | null
  version: number
}

interface ThreadRow {
  id: string
  psid: string
  page_id: string
  user_id: string
  last_inbound_at: string | null
  controlled_by_run_id: string | null
}

interface RunContext {
  run: WorkflowRunRow
  workflow: WorkflowRow
  graph: WorkflowGraph
  lead: LeadRow | null
  thread: ThreadRow | null
  pageToken: string | null
}

// ---------------------------------------------------------------------------
// Graph helpers
// ---------------------------------------------------------------------------

function followEdge(graph: WorkflowGraph, fromNodeId: string, label: string): WorkflowNode | null {
  const edge = graph.edges.find((e) => e.from === fromNodeId && e.label === label)
  if (!edge) return null
  return graph.nodes.find((n) => n.id === edge.to) ?? null
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function persistRunState(
  admin: AdminClient,
  runId: string,
  updates: Partial<{
    status: string
    current_node_id: string | null
    next_run_at: string | null
    state: WorkflowRunState
  }>,
): Promise<void> {
  await admin.from('workflow_runs').update(updates).eq('id', runId)
}

async function recordStep(
  admin: AdminClient,
  runId: string,
  nodeId: string,
  nodeType: string,
  enteredAt: string,
  decision: string | null,
  payload: Record<string, unknown>,
  error: string | null,
): Promise<void> {
  await admin.from('workflow_run_steps').insert({
    run_id: runId,
    node_id: nodeId,
    node_type: nodeType,
    entered_at: enteredAt,
    exited_at: new Date().toISOString(),
    decision,
    payload,
    error,
  })
}

// ---------------------------------------------------------------------------
// Context loading
// ---------------------------------------------------------------------------

async function loadContext(admin: AdminClient, runId: string): Promise<RunContext | null> {
  const { data: run, error: runErr } = await admin
    .from('workflow_runs')
    .select('id, workflow_id, workflow_version, user_id, lead_id, thread_id, current_node_id, state, status, next_run_at')
    .eq('id', runId)
    .single<WorkflowRunRow>()
  if (runErr || !run) {
    console.error('[workflow.executor] run not found', runId, runErr?.message)
    return null
  }

  const { data: workflow, error: wfErr } = await admin
    .from('workflows')
    .select('id, version, graph')
    .eq('id', run.workflow_id)
    .eq('version', run.workflow_version)
    .single<WorkflowRow>()
  if (wfErr || !workflow) {
    console.error('[workflow.executor] workflow not found', run.workflow_id, wfErr?.message)
    return null
  }

  const graph = workflow.graph as WorkflowGraph

  let lead: LeadRow | null = null
  if (run.lead_id) {
    const { data } = await admin
      .from('leads')
      .select('id, stage_id, version')
      .eq('id', run.lead_id)
      .maybeSingle<LeadRow>()
    lead = data ?? null
  }

  let thread: ThreadRow | null = null
  let pageToken: string | null = null
  if (run.thread_id) {
    const { data } = await admin
      .from('messenger_threads')
      .select('id, psid, page_id, user_id, last_inbound_at, controlled_by_run_id')
      .eq('id', run.thread_id)
      .maybeSingle<ThreadRow>()
    thread = data ?? null

    if (thread?.page_id) {
      const { data: page } = await admin
        .from('facebook_pages')
        .select('id, page_access_token')
        .eq('id', thread.page_id)
        .maybeSingle<{ id: string; page_access_token: string }>()
      if (page?.page_access_token) {
        try {
          pageToken = decryptToken(page.page_access_token)
        } catch (e) {
          console.error('[workflow.executor] token decrypt failed', e)
        }
      }
    }
  }

  return { run, workflow, graph, lead, thread, pageToken }
}

// ---------------------------------------------------------------------------
// Node handlers — each returns the label of the edge to follow, or null to suspend
// ---------------------------------------------------------------------------

async function handleSend(
  admin: AdminClient,
  ctx: RunContext,
  node: WorkflowNode,
): Promise<{ edge: string | null; payload: Record<string, unknown>; error: string | null }> {
  const config = node.config as unknown as SendNodeConfig

  if (!ctx.thread || !ctx.pageToken) {
    return {
      edge: 'error',
      payload: { reason: 'missing_thread_or_token' },
      error: 'thread or page token not available',
    }
  }

  try {
    const result = await sendOutbound({
      admin,
      thread: {
        id: ctx.thread.id,
        psid: ctx.thread.psid,
        last_inbound_at: ctx.thread.last_inbound_at,
      },
      pageToken: ctx.pageToken,
      payload: config.payload,
      kind: config.kind ?? 'workflow_human_agent',
    })

    if (!result.sent) {
      return {
        edge: 'policy_blocked',
        payload: { reason: result.reason },
        error: null,
      }
    }

    return {
      edge: 'success',
      payload: { messageId: result.messageId },
      error: null,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { edge: 'error', payload: {}, error: msg }
  }
}

async function handleSetStage(
  admin: AdminClient,
  ctx: RunContext,
  node: WorkflowNode,
): Promise<{ edge: string; payload: Record<string, unknown>; error: string | null }> {
  const config = node.config as unknown as SetStageNodeConfig

  if (!ctx.run.lead_id) {
    return { edge: 'then', payload: { skipped: 'no_lead' }, error: null }
  }

  const { error } = await admin.rpc('set_lead_stage', {
    p_lead_id: ctx.run.lead_id,
    p_to_stage_id: config.stage_id,
    p_source: 'workflow',
    p_reason: null,
    p_idempotency_key: `wf-run:${ctx.run.id}:node:${node.id}`,
    p_expected_version: null,
    p_confidence: null,
    p_thread_id: ctx.run.thread_id ?? null,
  })

  if (error) {
    console.error('[workflow.executor] set_lead_stage rpc failed', error.message)
  }

  return {
    edge: 'then',
    payload: { stage_id: config.stage_id, rpc_error: error?.message ?? null },
    error: null,
  }
}

async function handleWait(
  admin: AdminClient,
  ctx: RunContext,
  node: WorkflowNode,
): Promise<void> {
  const config = node.config as WaitNodeConfig
  const now = Date.now()

  let nextRunAt: string
  if (config.duration_ms != null && config.duration_ms > 0) {
    nextRunAt = new Date(now + config.duration_ms).toISOString()
  } else if (config.until) {
    nextRunAt = new Date(config.until).toISOString()
  } else {
    nextRunAt = new Date(now + 60 * 60 * 1000).toISOString()
  }

  const newState: WorkflowRunState = {
    ...ctx.run.state,
    waiting_for: 'timeout',
    interrupt_on: config.interrupt_on ?? [],
  }

  await persistRunState(admin, ctx.run.id, {
    status: 'waiting',
    current_node_id: node.id,
    next_run_at: nextRunAt,
    state: newState,
  })
}

async function handleWaitForReply(
  admin: AdminClient,
  ctx: RunContext,
  node: WorkflowNode,
): Promise<void> {
  const config = node.config as unknown as WaitForReplyNodeConfig
  const nextRunAt = new Date(Date.now() + config.timeout_ms).toISOString()

  if (ctx.thread) {
    await admin
      .from('messenger_threads')
      .update({ controlled_by_run_id: ctx.run.id })
      .eq('id', ctx.thread.id)
  }

  const newState: WorkflowRunState = {
    ...ctx.run.state,
    waiting_for: 'inbound_message',
    interrupt_on: ['inbound_message'],
  }

  await persistRunState(admin, ctx.run.id, {
    status: 'waiting',
    current_node_id: node.id,
    next_run_at: nextRunAt,
    state: newState,
  })
}

function evaluateCondition(condition: IfCondition, ctx: RunContext): boolean {
  const { kind, params } = condition

  if (kind === 'in_stage') {
    return ctx.lead?.stage_id === (params.stage_id as string)
  }

  if (kind === 'replied_within') {
    if (!ctx.thread?.last_inbound_at) return false
    const ms = params.ms as number
    return Date.now() - new Date(ctx.thread.last_inbound_at).getTime() <= ms
  }

  if (kind === 'submission_outcome_is') {
    return ctx.run.state.variables.submission_outcome === params.outcome
  }

  if (kind === 'custom_field_eq') {
    const field = params.field
    if (typeof field !== 'string' || field === '__proto__' || field === 'constructor' || field === 'prototype') {
      return false
    }
    const vars = ctx.run.state.variables
    if (!Object.prototype.hasOwnProperty.call(vars, field)) return false
    return vars[field] === params.value
  }

  return false
}

function handleIf(ctx: RunContext, node: WorkflowNode): { edge: string } {
  const config = node.config as unknown as IfNodeConfig
  const { conditions, logic } = config

  let result: boolean
  if (logic === 'AND') {
    result = conditions.every((c) => evaluateCondition(c, ctx))
  } else {
    result = conditions.some((c) => evaluateCondition(c, ctx))
  }

  return { edge: result ? 'then' : 'else' }
}

async function handleClassifyAndRoute(
  admin: SupabaseClient,
  ctx: RunContext,
  node: WorkflowNode,
): Promise<{ edge: string; payload: Record<string, unknown>; error: string | null }> {
  if (!ctx.thread || !ctx.run.lead_id) {
    return { edge: 'continue', payload: { skipped: 'no_thread_or_lead' }, error: null }
  }

  try {
    const { data: messagesData } = await admin
      .from('messenger_messages')
      .select('direction, body')
      .eq('thread_id', ctx.thread.id)
      .order('created_at', { ascending: false })
      .limit(20)

    const history = ((messagesData ?? []) as Array<{ direction: string; body: string }>)
      .reverse()
      .filter((m) => m.body?.trim())
      .map((m) => ({
        role: m.direction === 'outbound' ? ('assistant' as const) : ('user' as const),
        content: m.body,
      }))

    const lastUserMsg = history.filter((m) => m.role === 'user').at(-1)?.content ?? ''

    const { data: stagesData } = await admin
      .from('pipeline_stages')
      .select('id, name, description')
      .eq('user_id', ctx.run.user_id)
      .order('position', { ascending: true })

    const stages = (stagesData ?? []) as StageBrief[]
    const currentStageId = ctx.lead?.stage_id ?? null

    const result = await answerWithClassification(
      admin,
      ctx.run.user_id,
      lastUserMsg,
      history,
      stages,
      currentStageId,
      { rpcName: 'match_knowledge_hybrid_service' },
    )

    if (result.stageChange) {
      await applyStageChange(admin, {
        leadId: ctx.run.lead_id,
        userId: ctx.run.user_id,
        threadId: ctx.thread.id,
        fromStageId: currentStageId,
        change: result.stageChange,
        stages,
      })
      return {
        edge: 'stage_changed',
        payload: { to_stage_id: result.stageChange.to_stage_id },
        error: null,
      }
    }

    if (result.actionPage) {
      return {
        edge: 'action_page_recommended',
        payload: { action_page_id: result.actionPage.action_page_id },
        error: null,
      }
    }

    return { edge: 'continue', payload: {}, error: null }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[workflow.executor] classify_and_route failed', msg)
    return { edge: 'continue', payload: {}, error: msg }
  }
}

async function handleStop(admin: AdminClient, ctx: RunContext): Promise<void> {
  if (ctx.thread?.controlled_by_run_id === ctx.run.id) {
    await admin
      .from('messenger_threads')
      .update({ controlled_by_run_id: null })
      .eq('id', ctx.thread.id)
  }

  await persistRunState(admin, ctx.run.id, { status: 'done' })
}

async function handleInterrupt(
  admin: AdminClient,
  ctx: RunContext,
  node: WorkflowNode,
): Promise<{ edge: string; payload: Record<string, unknown>; error: string | null }> {
  const event = ctx.run.state.interrupt_event!
  const clearedState: WorkflowRunState = { ...ctx.run.state, interrupt_event: undefined }

  if (node.type === 'wait_for_reply') {
    await persistRunState(admin, ctx.run.id, { state: clearedState })
    if (event.kind === 'inbound_message') {
      return { edge: 'on_reply', payload: { body: event.body }, error: null }
    }
    return { edge: 'on_timeout', payload: {}, error: null }
  }

  if (node.type === 'wait') {
    await persistRunState(admin, ctx.run.id, { state: clearedState })
    if (event.kind === 'inbound_message') {
      return { edge: 'interrupted_inbound', payload: { body: event.body }, error: null }
    }
    return { edge: 'timeout', payload: {}, error: null }
  }

  if (node.type === 'request_marketing_optin') {
    if (event.kind === 'inbound_message') {
      const body = (event.body ?? '').toLowerCase()
      const affirmative = /\b(yes|sure|okay|ok|yep|yeah|agree|allow|accept|subscribe)\b/.test(body)
      if (affirmative && ctx.run.thread_id && ctx.run.user_id) {
        await admin.from('messenger_marketing_optins').upsert(
          {
            thread_id: ctx.run.thread_id,
            user_id: ctx.run.user_id,
            opted_in_at: new Date().toISOString(),
            source: 'in_thread',
          },
          { onConflict: 'thread_id' },
        )
        await persistRunState(admin, ctx.run.id, { state: clearedState })
        return { edge: 'accepted', payload: {}, error: null }
      }
      await persistRunState(admin, ctx.run.id, { state: clearedState })
      return { edge: 'declined', payload: {}, error: null }
    }
    await persistRunState(admin, ctx.run.id, { state: clearedState })
    return { edge: 'timeout', payload: {}, error: null }
  }

  if (node.type === 'request_otn') {
    if (event.kind === 'otn_granted' && event.otn_token) {
      const cfg = node.config as unknown as RequestOtnConfig
      if (ctx.run.thread_id && ctx.run.user_id) {
        await admin.from('messenger_otn_tokens').insert({
          thread_id: ctx.run.thread_id,
          user_id: ctx.run.user_id,
          topic: cfg.topic,
          token: event.otn_token,
          requested_at: new Date().toISOString(),
        })
      }
      await persistRunState(admin, ctx.run.id, { state: clearedState })
      return { edge: 'granted', payload: { token: event.otn_token }, error: null }
    }
    await persistRunState(admin, ctx.run.id, { state: clearedState })
    return { edge: 'declined', payload: {}, error: null }
  }

  await persistRunState(admin, ctx.run.id, { state: clearedState })
  return { edge: 'timeout', payload: {}, error: null }
}

async function handleRequestMarketingOptin(
  admin: AdminClient,
  ctx: RunContext,
  node: WorkflowNode,
): Promise<void> {
  const cfg = node.config as unknown as RequestMarketingOptinConfig

  if (ctx.thread && ctx.pageToken) {
    await sendOutbound({
      admin,
      thread: {
        id: ctx.thread.id,
        psid: ctx.thread.psid,
        last_inbound_at: ctx.thread.last_inbound_at,
      },
      pageToken: ctx.pageToken,
      payload: { kind: 'text', text: cfg.message },
      kind: 'bot',
    })
    await admin
      .from('messenger_threads')
      .update({ controlled_by_run_id: ctx.run.id })
      .eq('id', ctx.thread.id)
  }

  const newState: WorkflowRunState = {
    ...ctx.run.state,
    waiting_for: 'inbound_message',
    interrupt_on: ['inbound_message'],
  }

  await persistRunState(admin, ctx.run.id, {
    status: 'waiting',
    current_node_id: node.id,
    next_run_at: new Date(Date.now() + cfg.timeout_ms).toISOString(),
    state: newState,
  })
}

async function handleRequestOtn(
  admin: AdminClient,
  ctx: RunContext,
  node: WorkflowNode,
): Promise<void> {
  const cfg = node.config as unknown as RequestOtnConfig

  if (ctx.thread && ctx.pageToken) {
    await sendOutbound({
      admin,
      thread: {
        id: ctx.thread.id,
        psid: ctx.thread.psid,
        last_inbound_at: ctx.thread.last_inbound_at,
      },
      pageToken: ctx.pageToken,
      payload: { kind: 'text', text: cfg.message },
      kind: 'bot',
    })
    await admin
      .from('messenger_threads')
      .update({ controlled_by_run_id: ctx.run.id })
      .eq('id', ctx.thread.id)
  }

  const newState: WorkflowRunState = {
    ...ctx.run.state,
    waiting_for: 'otn',
    interrupt_on: ['inbound_message'],
  }

  await persistRunState(admin, ctx.run.id, {
    status: 'waiting',
    current_node_id: node.id,
    next_run_at: new Date(Date.now() + cfg.timeout_ms).toISOString(),
    state: newState,
  })
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const MAX_STEPS = 50

export async function executeRun(admin: AdminClient, runId: string): Promise<void> {
  const ctx = await loadContext(admin, runId)
  if (!ctx) {
    console.error('[workflow.executor] could not load context for run', runId)
    return
  }

  if (ctx.run.status === 'done' || ctx.run.status === 'failed') {
    return
  }

  const { graph, run } = ctx

  let currentNode: WorkflowNode | null = null

  if (run.current_node_id) {
    currentNode = graph.nodes.find((n) => n.id === run.current_node_id) ?? null
  }

  // If run is waiting and resuming, find which edge to follow from the wait node.
  // The caller (worker) is responsible for updating status to 'running' before calling us,
  // OR we start fresh at start_node_id.
  if (!currentNode) {
    currentNode = graph.nodes.find((n) => n.id === graph.start_node_id) ?? null
  }

  if (!currentNode) {
    console.error('[workflow.executor] no start node found', runId)
    await persistRunState(admin, runId, { status: 'failed' })
    return
  }

  // Mark as running
  await persistRunState(admin, runId, { status: 'running' })

  let steps = 0

  while (currentNode && steps < MAX_STEPS) {
    steps++
    const enteredAt = new Date().toISOString()
    const node = currentNode

    // If we're resuming a suspended node with a pending interrupt, handle it first.
    if (ctx.run.state.interrupt_event && ['wait', 'wait_for_reply', 'request_marketing_optin', 'request_otn'].includes(node.type)) {
      const { edge, payload, error } = await handleInterrupt(admin, ctx, node)
      await recordStep(admin, runId, node.id, node.type, enteredAt, edge, payload, error)
      currentNode = followEdge(graph, node.id, edge)
      continue
    }

    if (node.type === 'stop') {
      await handleStop(admin, ctx)
      await recordStep(admin, runId, node.id, node.type, enteredAt, 'stop', {}, null)
      return
    }

    if (node.type === 'wait') {
      await handleWait(admin, ctx, node)
      await recordStep(admin, runId, node.id, node.type, enteredAt, 'suspended', {}, null)
      return
    }

    if (node.type === 'wait_for_reply') {
      await handleWaitForReply(admin, ctx, node)
      await recordStep(admin, runId, node.id, node.type, enteredAt, 'suspended', {}, null)
      return
    }

    if (node.type === 'request_marketing_optin') {
      await handleRequestMarketingOptin(admin, ctx, node)
      await recordStep(admin, runId, node.id, node.type, enteredAt, 'suspended', {}, null)
      return
    }

    if (node.type === 'request_otn') {
      await handleRequestOtn(admin, ctx, node)
      await recordStep(admin, runId, node.id, node.type, enteredAt, 'suspended', {}, null)
      return
    }

    if (node.type === 'send') {
      const { edge, payload, error } = await handleSend(admin, ctx, node)
      await recordStep(admin, runId, node.id, node.type, enteredAt, edge, payload, error)
      if (!edge) {
        await persistRunState(admin, runId, { status: 'failed' })
        return
      }
      currentNode = followEdge(graph, node.id, edge)
      continue
    }

    if (node.type === 'set_stage') {
      const { edge, payload, error } = await handleSetStage(admin, ctx, node)
      await recordStep(admin, runId, node.id, node.type, enteredAt, edge, payload, error)
      currentNode = followEdge(graph, node.id, edge)
      continue
    }

    if (node.type === 'if') {
      const { edge } = handleIf(ctx, node)
      await recordStep(admin, runId, node.id, node.type, enteredAt, edge, {}, null)
      currentNode = followEdge(graph, node.id, edge)
      continue
    }

    if (node.type === 'classify_and_route') {
      const { edge, payload, error } = await handleClassifyAndRoute(admin, ctx, node)
      await recordStep(admin, runId, node.id, node.type, enteredAt, edge, payload, error)
      currentNode = followEdge(graph, node.id, edge)
      continue
    }

    // Unknown node type — follow error edge or fail
    console.warn('[workflow.executor] unknown node type', node.type, node.id)
    await recordStep(admin, runId, node.id, node.type, enteredAt, 'error', {}, `unknown node type: ${node.type}`)
    currentNode = followEdge(graph, node.id, 'error')
    if (!currentNode) {
      await persistRunState(admin, runId, { status: 'failed' })
      return
    }
  }

  if (steps >= MAX_STEPS) {
    console.error('[workflow.executor] max steps reached, aborting run', runId)
    await persistRunState(admin, runId, { status: 'failed' })
    return
  }

  // Fell off the graph with no stop node — treat as done
  await persistRunState(admin, runId, { status: 'done' })
}
