import { parseOffset } from './offsets'
import type {
  WorkflowNode,
  WorkflowEdge,
  WorkflowTrigger,
  SendNodeConfig,
  IfNodeConfig,
} from './types'
import type { VariableMap } from '@/lib/messenger-templates/render'

export interface FollowupTouchpoint {
  id: string
  enabled: boolean
  offset: string
  template_id: string
  variables: VariableMap
  button_url_override?: string | null
  button_index?: number | null
}

export interface FollowupGraphOutput {
  triggers: WorkflowTrigger[]
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  start_node_id: string
}

const MAX_TOUCHPOINTS = 7

export function validateTouchpoint(tp: FollowupTouchpoint): string | null {
  if (!tp.id || typeof tp.id !== 'string') return 'invalid id'
  if (!tp.template_id || typeof tp.template_id !== 'string') return 'template_id required'
  if (!tp.offset || typeof tp.offset !== 'string') return 'offset required'
  if (parseOffset(tp.offset) === null) return `invalid offset: ${tp.offset}`
  return null
}

export function validateTouchpoints(tps: FollowupTouchpoint[]): string | null {
  if (tps.length > MAX_TOUCHPOINTS) return `at most ${MAX_TOUCHPOINTS} touchpoints`
  const seen = new Set<string>()
  for (const tp of tps) {
    const err = validateTouchpoint(tp)
    if (err) return err
    if (tp.enabled) {
      if (seen.has(tp.offset)) return `duplicate enabled offset: ${tp.offset}`
      seen.add(tp.offset)
    }
  }
  return null
}

/**
 * Produce a workflow graph + triggers from a touchpoint config.
 *
 * Routing: linear if-chain. Each `if` uses condition kind `custom_field_eq`
 * with `params: { field: 'offset', value: tp.offset }`. The executor reads
 * `ctx.run.state.variables[field]` directly (bare key, NOT a dotted path).
 * The dispatcher seeds `state.variables.offset` for every booking-offset run.
 */
export function generateFollowupGraph(
  touchpoints: FollowupTouchpoint[],
  actionPageId: string,
): FollowupGraphOutput {
  const enabled = touchpoints.filter((tp) => tp.enabled)

  const triggers: WorkflowTrigger[] = enabled.map((tp) => ({
    kind: 'booking_offset',
    config: { offset: tp.offset, action_page_id: actionPageId },
  }))

  const nodes: WorkflowNode[] = []
  const edges: WorkflowEdge[] = []

  const stopId = 'stop'
  nodes.push({ id: stopId, type: 'stop', config: {} })

  if (enabled.length === 0) {
    return { triggers, nodes, edges, start_node_id: stopId }
  }

  let prevElseFromId: string | null = null
  enabled.forEach((tp, idx) => {
    const ifId = `if_${tp.id}`
    const sendId = `send_${tp.id}`

    nodes.push({
      id: ifId,
      type: 'if',
      config: {
        conditions: [
          {
            kind: 'custom_field_eq',
            params: { field: 'offset', value: tp.offset },
          },
        ],
        logic: 'AND',
      } satisfies IfNodeConfig,
    })

    nodes.push({
      id: sendId,
      type: 'send',
      config: {
        payload: {
          kind: 'utility_template',
          template_id: tp.template_id,
          variables: tp.variables,
          ...(tp.button_url_override
            ? { button_url_override: tp.button_url_override }
            : {}),
          ...(tp.button_index != null ? { button_index: tp.button_index } : {}),
        },
      } satisfies SendNodeConfig,
    })

    edges.push({ from: ifId, label: 'then', to: sendId })
    edges.push({ from: sendId, label: 'success', to: stopId })
    edges.push({ from: sendId, label: 'policy_blocked', to: stopId })
    edges.push({ from: sendId, label: 'error', to: stopId })

    if (prevElseFromId) {
      edges.push({ from: prevElseFromId, label: 'else', to: ifId })
    }
    prevElseFromId = ifId

    if (idx === enabled.length - 1) {
      edges.push({ from: ifId, label: 'else', to: stopId })
    }
  })

  const startNodeId = `if_${enabled[0].id}`
  return { triggers, nodes, edges, start_node_id: startNodeId }
}

/**
 * Inverse: read touchpoints back from a generated workflow.
 * Returns [] for graphs that don't look generated.
 */
export function parseTouchpointsFromWorkflow(args: {
  triggers: WorkflowTrigger[]
  graph: { nodes: WorkflowNode[]; edges: WorkflowEdge[]; start_node_id: string }
}): FollowupTouchpoint[] {
  const out: FollowupTouchpoint[] = []
  for (const node of args.graph.nodes) {
    if (node.type !== 'send') continue
    const cfg = node.config as { payload?: { kind?: string } }
    if (cfg.payload?.kind !== 'utility_template') continue
    const payload = cfg.payload as Extract<SendNodeConfig['payload'], { kind: 'utility_template' }>
    const tpId = node.id.startsWith('send_') ? node.id.slice('send_'.length) : node.id
    const ifNode = args.graph.nodes.find((n) => n.id === `if_${tpId}`)
    let offset = ''
    if (ifNode && ifNode.type === 'if') {
      const ifCfg = ifNode.config as unknown as IfNodeConfig
      const cond = ifCfg.conditions?.[0]
      const params = cond?.params as { value?: string } | undefined
      if (typeof params?.value === 'string') offset = params.value
    }
    out.push({
      id: tpId,
      enabled: true,
      offset,
      template_id: payload.template_id,
      variables: payload.variables,
      button_url_override: payload.button_url_override ?? null,
      button_index: payload.button_index ?? null,
    })
  }
  return out
}
