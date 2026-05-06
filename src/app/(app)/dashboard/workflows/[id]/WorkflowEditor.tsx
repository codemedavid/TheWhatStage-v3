'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  Handle,
  Position,
  MarkerType,
  BackgroundVariant,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { WorkflowDetail } from '@/lib/workflow/queries'
import type {
  WorkflowGraph,
  WorkflowNode as WFNode,
  WorkflowEdge as WFEdge,
  WorkflowTrigger,
  NodeType,
} from '@/lib/workflow/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  workflow: WorkflowDetail
  stages: Array<{ id: string; name: string }>
  actionPages: Array<{ id: string; title: string }>
  leads: Array<{ id: string; name: string | null; email: string | null; phone: string | null }>
}

interface SimStep {
  node_id: string
  node_type: string
  decision: string
  note: string
  blocked?: boolean
}

// ---------------------------------------------------------------------------
// Node metadata
// ---------------------------------------------------------------------------

const NODE_META: Record<NodeType, { label: string; color: string }> = {
  send:                    { label: 'Send Message',     color: '#3B82F6' },
  set_stage:               { label: 'Set Stage',        color: '#8B5CF6' },
  wait:                    { label: 'Wait',             color: '#F59E0B' },
  wait_for_reply:          { label: 'Wait for Reply',   color: '#F59E0B' },
  if:                      { label: 'Conditional',      color: '#6366F1' },
  classify_and_route:      { label: 'AI Decision',      color: '#EC4899' },
  request_marketing_optin: { label: 'Marketing Opt-in', color: '#10B981' },
  request_otn:             { label: 'Request OTN',      color: '#10B981' },
  stop:                    { label: 'Stop',             color: '#94A3B8' },
}

const NODE_DESCRIPTIONS: Record<NodeType | 'trigger', string> = {
  trigger:                 'Initiate the workflow',
  send:                    'Send a message to a lead',
  set_stage:               'Update pipeline stage',
  wait:                    'Pause the workflow',
  wait_for_reply:          'Wait for a response',
  if:                      'Branch on conditions',
  classify_and_route:      'Route using AI',
  request_marketing_optin: 'Request marketing consent',
  request_otn:             'Request one-time notification',
  stop:                    'End the workflow run',
}

function NodeTypeIcon({ type, size = 14 }: { type: NodeType | 'trigger'; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (type) {
    case 'trigger':                 return <svg {...p}><path d="M13 2L3 14h9l-1 8 11-12h-9l1-8z" /></svg>
    case 'send':                    return <svg {...p}><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>
    case 'set_stage':               return <svg {...p}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></svg>
    case 'wait':                    return <svg {...p}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
    case 'wait_for_reply':          return <svg {...p}><polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" /></svg>
    case 'if':                      return <svg {...p}><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M6 21V9a9 9 0 0 0 9 9" /></svg>
    case 'classify_and_route':      return <svg {...p}><path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z" /></svg>
    case 'request_marketing_optin': return <svg {...p}><path d="M3 11l19-9-9 19-2-8-8-2z" /></svg>
    case 'request_otn':             return <svg {...p}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
    case 'stop':                    return <svg {...p}><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
    default:                        return <svg {...p}><circle cx="12" cy="12" r="4" /></svg>
  }
}

const TRIGGER_KINDS: Array<{ value: WorkflowTrigger['kind']; label: string }> = [
  { value: 'stage_entered',       label: 'Stage entered' },
  { value: 'stage_idle',         label: 'Stage idle' },
  { value: 'submission_received', label: 'Submission received' },
  { value: 'booking_offset',      label: 'Booking offset' },
  { value: 'cart_abandoned',      label: 'Cart abandoned' },
]

function triggerLabel(t: WorkflowTrigger) {
  return TRIGGER_KINDS.find(k => k.value === t.kind)?.label ?? t.kind
}

function nodeLabel(type: NodeType, config: Record<string, unknown>): string {
  if (type === 'send') {
    const text = (config.payload as { text?: string } | undefined)?.text
    return text ? `"${text.slice(0, 28)}${text.length > 28 ? '…' : ''}"` : 'Send Message'
  }
  if (type === 'wait') {
    const ms = config.duration_ms as number | undefined
    if (ms) return `Wait ${fmtMs(ms)}`
  }
  if (type === 'wait_for_reply') {
    const ms = config.timeout_ms as number | undefined
    if (ms) return `Reply within ${fmtMs(ms)}`
  }
  return NODE_META[type]?.label ?? type
}

function fmtMs(ms: number) {
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`
  return `${Math.round(ms / 86_400_000)}d`
}

// ---------------------------------------------------------------------------
// Source-handle map — drives both rendering (per-handle ports) and edge labels.
// connection.sourceHandle becomes WorkflowEdge.label, so handler ids must
// match the labels the executor follows.
// ---------------------------------------------------------------------------

interface PortDef { id: string; label: string; tone?: 'ok' | 'warn' | 'err' | 'neutral' }

const STATIC_PORTS: Record<NodeType, PortDef[]> = {
  send: [
    { id: 'success',        label: 'sent',     tone: 'ok' },
    { id: 'policy_blocked', label: 'blocked',  tone: 'warn' },
    { id: 'error',          label: 'error',    tone: 'err' },
  ],
  set_stage:  [{ id: 'then', label: 'then', tone: 'neutral' }],
  wait_for_reply: [
    { id: 'on_reply',   label: 'on reply',   tone: 'ok' },
    { id: 'on_timeout', label: 'on timeout', tone: 'warn' },
  ],
  wait: [],  // dynamic — see portsForNode
  if: [
    { id: 'then', label: 'then', tone: 'ok' },
    { id: 'else', label: 'else', tone: 'err' },
  ],
  classify_and_route: [
    { id: 'stage_changed',           label: 'stage changed', tone: 'ok' },
    { id: 'action_page_recommended', label: 'action page',   tone: 'ok' },
    { id: 'continue',                label: 'continue',      tone: 'neutral' },
  ],
  request_marketing_optin: [
    { id: 'accepted', label: 'accepted', tone: 'ok' },
    { id: 'declined', label: 'declined', tone: 'err' },
    { id: 'timeout',  label: 'timeout',  tone: 'warn' },
  ],
  request_otn: [
    { id: 'granted',  label: 'granted',  tone: 'ok' },
    { id: 'declined', label: 'declined', tone: 'err' },
    { id: 'timeout',  label: 'timeout',  tone: 'warn' },
  ],
  stop: [],
}

// Wait node: timeout always; one extra port per configured interrupt_on.
function portsForNode(node: WFNode): PortDef[] {
  if (node.type !== 'wait') return STATIC_PORTS[node.type]
  const interrupts = (node.config.interrupt_on as string[] | undefined) ?? []
  const ports: PortDef[] = [{ id: 'timeout', label: 'timeout', tone: 'warn' }]
  if (interrupts.includes('inbound_message')) {
    ports.push({ id: 'interrupted_inbound', label: 'on reply', tone: 'ok' })
  }
  return ports
}

// Distribute N handles evenly across the bottom edge of the node.
function handleLeftPct(index: number, total: number): string {
  if (total <= 1) return '50%'
  const step = 100 / (total + 1)
  return `${step * (index + 1)}%`
}

// ---------------------------------------------------------------------------
// Layout — vertical BFS top-to-bottom
// ---------------------------------------------------------------------------

const XSTEP = 260
const YSTEP = 150

function autoLayout(graph: WorkflowGraph): Map<string, { x: number; y: number }> {
  const children = new Map<string, string[]>()
  for (const e of graph.edges) {
    const list = children.get(e.from) ?? []; list.push(e.to); children.set(e.from, list)
  }
  const depths = new Map<string, number>()
  const q = [graph.start_node_id]; depths.set(graph.start_node_id, 0)
  while (q.length) {
    const cur = q.shift()!; const d = depths.get(cur)!
    for (const c of children.get(cur) ?? []) if (!depths.has(c)) { depths.set(c, d + 1); q.push(c) }
  }
  for (const n of graph.nodes) if (!depths.has(n.id)) depths.set(n.id, 0)
  const byDepth = new Map<number, string[]>()
  for (const [nid, d] of depths) { const l = byDepth.get(d) ?? []; l.push(nid); byDepth.set(d, l) }
  const positions = new Map<string, { x: number; y: number }>()
  for (const [depth, ids] of byDepth) {
    const w = (ids.length - 1) * XSTEP
    ids.forEach((id, i) => positions.set(id, { x: i * XSTEP - w / 2, y: depth * YSTEP }))
  }
  return positions
}

function triggerDefaultPositions(count: number): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  const w = (count - 1) * XSTEP
  for (let i = 0; i < count; i++) {
    positions.set(`__t_${i}`, { x: i * XSTEP - w / 2, y: -YSTEP })
  }
  return positions
}

// ---------------------------------------------------------------------------
// ReactFlow converters
// ---------------------------------------------------------------------------

function toRFNodes(
  graph: WorkflowGraph,
  triggers: WorkflowTrigger[],
  testSteps: SimStep[],
  selectedId: string | null,
  posCached: Map<string, { x: number; y: number }>,
  tPosCached: Map<string, { x: number; y: number }>,
): Node[] {
  const graphPos = posCached.size > 0 ? posCached : autoLayout(graph)
  const tPos = tPosCached.size > 0 ? tPosCached : triggerDefaultPositions(triggers.length)
  const stepMap = new Map(testSteps.map(s => [s.node_id, s]))

  const tNodes: Node[] = triggers.map((t, i) => ({
    id: `__t_${i}`,
    type: 'triggerNode',
    position: tPos.get(`__t_${i}`) ?? { x: i * XSTEP, y: -YSTEP },
    data: { trigger: t, index: i, selected: selectedId === `__t_${i}` },
    selected: selectedId === `__t_${i}`,
  }))

  const gNodes: Node[] = graph.nodes.map((n: WFNode) => {
    const pos = graphPos.get(n.id) ?? { x: 0, y: 0 }
    const step = stepMap.get(n.id)
    let testCls = ''
    if (step) {
      if (step.blocked) testCls = ' test-blocked'
      else if (['done', 'success', 'then'].includes(step.decision)) testCls = ' test-ok'
      else if (['error', 'loop_detected'].includes(step.decision)) testCls = ' test-error'
      else testCls = ' test-warn'
    }
    return {
      id: n.id,
      type: 'workflowNode',
      position: pos,
      data: {
        label: nodeLabel(n.type, n.config),
        nodeType: n.type,
        color: NODE_META[n.type]?.color ?? '#94A3B8',
        isStart: n.id === graph.start_node_id,
        selected: n.id === selectedId,
        testCls,
        testStep: step ?? null,
        ports: portsForNode(n),
      },
      selected: n.id === selectedId,
    }
  })

  return [...tNodes, ...gNodes]
}

function toRFEdges(graph: WorkflowGraph, triggers: WorkflowTrigger[]): Edge[] {
  const tEdges: Edge[] = triggers.map((_, i) => ({
    id: `__te_${i}`,
    source: `__t_${i}`,
    target: graph.start_node_id,
    targetHandle: 'in',
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: '#94A3B8' },
    style: { stroke: '#94A3B8', strokeWidth: 1, strokeDasharray: '4 3' },
  }))

  const portIds = new Map<string, Set<string>>()
  for (const n of graph.nodes) {
    portIds.set(n.id, new Set(portsForNode(n).map(p => p.id)))
  }

  const gEdges: Edge[] = graph.edges.map((e: WFEdge, i: number) => ({
    id: `e-${e.from}-${e.to}-${e.label}-${i}`,
    source: e.from,
    // Only bind to a named source handle if it actually exists on the source
    // node. Otherwise React Flow drops the edge silently. Falls back to the
    // node's default source handle so legacy edges still render.
    ...(portIds.get(e.from)?.has(e.label) ? { sourceHandle: e.label } : {}),
    target: e.to,
    targetHandle: 'in',
    label: e.label,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed, width: 13, height: 13, color: '#94A3B8' },
    style: { stroke: '#CBD5E1', strokeWidth: 1.5 },
    labelStyle: { fontSize: 11, fill: '#94A3B8', fontWeight: 600 },
    labelBgStyle: { fill: '#fff', fillOpacity: 0.9 },
    labelBgPadding: [4, 3] as [number, number],
    labelBgBorderRadius: 4,
  }))

  return [...tEdges, ...gEdges]
}

// ---------------------------------------------------------------------------
// Canvas node components
// ---------------------------------------------------------------------------

function TriggerNodeComponent({ data }: { data: Record<string, unknown> }) {
  const t = data.trigger as WorkflowTrigger
  return (
    <div className={`wfe-node wfe-trigger-node${data.selected ? ' is-selected' : ''}`}
      style={{ '--node-color': '#6366F1' } as React.CSSProperties}>
      <div className="wfe-node-body">
        <div className="wfe-node-icon"><NodeTypeIcon type="trigger" size={13} /></div>
        <div className="wfe-node-text">
          <div className="wfe-node-name">{triggerLabel(t)}</div>
          <div className="wfe-node-sub">Trigger</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="wfe-handle" />
    </div>
  )
}

function WorkflowNodeComponent({ data }: { data: Record<string, unknown> }) {
  const color    = data.color    as string
  const testCls  = data.testCls  as string
  const nodeType = data.nodeType as NodeType
  const ports    = (data.ports   as PortDef[]) ?? []
  const isIf     = nodeType === 'if'

  return (
    <div
      className={`wfe-node${data.selected ? ' is-selected' : ''}${testCls}${isIf ? ' wfe-node-if' : ''}`}
      style={{ '--node-color': color } as React.CSSProperties}
    >
      <Handle type="target" position={Position.Top} id="in" className="wfe-handle wfe-handle-target" />

      <div className="wfe-node-body">
        <div className="wfe-node-icon"><NodeTypeIcon type={nodeType} size={13} /></div>
        <div className="wfe-node-text">
          <div className="wfe-node-name">{data.label as string}</div>
          <div className="wfe-node-sub">{NODE_META[nodeType]?.label ?? nodeType as string}</div>
        </div>
        {Boolean(data.isStart) && <span className="wfe-start-dot" title="Start node" />}
      </div>

      {(data.testStep as SimStep | null) && (
        <div className={`wfe-test-badge${testCls}`}>{(data.testStep as SimStep).decision}</div>
      )}

      {/* One labeled source handle per port */}
      {ports.length > 0 && (
        <div className="wfe-ports">
          {ports.map((p, i) => (
            <span key={p.id} className={`wfe-port-label wfe-port-${p.tone ?? 'neutral'}`}
              style={{ left: handleLeftPct(i, ports.length) }}>
              {p.label}
            </span>
          ))}
        </div>
      )}
      {ports.map((p, i) => (
        <Handle
          key={p.id}
          id={p.id}
          type="source"
          position={Position.Bottom}
          className={`wfe-handle wfe-handle-${p.tone ?? 'neutral'}`}
          style={{ left: handleLeftPct(i, ports.length) }}
        />
      ))}
    </div>
  )
}

const rfNodeTypes = { workflowNode: WorkflowNodeComponent, triggerNode: TriggerNodeComponent }

// ---------------------------------------------------------------------------
// Main editor
// ---------------------------------------------------------------------------

export function WorkflowEditor({ workflow, stages, actionPages, leads }: Props) {
  const router = useRouter()
  const [name, setName]     = useState(workflow.name)
  const [status, setStatus] = useState(workflow.status)
  const [graph, setGraph]   = useState<WorkflowGraph>(workflow.graph)

  // queries.ts always returns a normalized `triggers` array (never empty).
  const [triggers, setTriggers] = useState<WorkflowTrigger[]>(workflow.triggers)

  const [selectedId,   setSelectedId]   = useState<string | null>(null)
  const [saving,       setSaving]       = useState(false)
  const [saved,        setSaved]        = useState(false)
  const [nameEditing,  setNameEditing]  = useState(false)
  const [testMode,     setTestMode]     = useState(false)
  const [testLeadId,   setTestLeadId]   = useState('')
  const [testRunning,  setTestRunning]  = useState(false)
  const [testSteps,    setTestSteps]    = useState<SimStep[]>([])

  const saveTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const posRef       = useRef(new Map<string, { x: number; y: number }>())
  const tPosRef      = useRef(new Map<string, { x: number; y: number }>())
  const idCounter    = useRef(0)

  // Monotonically-unique id generator. Date.now() alone collides when the
  // user clicks the same library button twice in <1ms.
  function nextNodeId(type: NodeType): string {
    idCounter.current += 1
    return `${type}-${Date.now()}-${idCounter.current}`
  }

  const buildRFNodes = useCallback(
    () => toRFNodes(graph, triggers, testSteps, selectedId, posRef.current, tPosRef.current),
    [graph, triggers, testSteps, selectedId],
  )
  const buildRFEdges = useCallback(() => toRFEdges(graph, triggers), [graph, triggers])

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(buildRFNodes())
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(buildRFEdges())

  useEffect(() => { setRfNodes(buildRFNodes()) }, [graph, triggers]) // eslint-disable-line
  useEffect(() => { setRfEdges(buildRFEdges()) }, [graph, triggers]) // eslint-disable-line
  useEffect(() => {
    const stepMap = new Map(testSteps.map(s => [s.node_id, s]))
    setRfNodes(nds => nds.map(n => ({
      ...n,
      data: { ...n.data, testStep: stepMap.get(n.id) ?? null, selected: n.id === selectedId },
    })))
  }, [testSteps, selectedId]) // eslint-disable-line

  const selectedTriggerIndex = selectedId?.startsWith('__t_')
    ? parseInt(selectedId.replace('__t_', ''))
    : -1
  const selectedTrigger  = selectedTriggerIndex >= 0 ? triggers[selectedTriggerIndex] : null
  const selectedNode     = graph.nodes.find(n => n.id === selectedId) ?? null

  // Auto-save
  const scheduleAutosave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void doSave(), 1500)
  }, [graph, name, status, triggers]) // eslint-disable-line

  async function doSave() {
    setSaving(true)
    try {
      await fetch(`/api/workflows/${workflow.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, status,
          trigger: triggers[0],   // backward compat
          triggers,               // multi-trigger forward
          graph,
          version: workflow.version,
        }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally { setSaving(false) }
  }

  // Trigger handlers
  function handleAddTrigger() {
    setTriggers(ts => {
      // Cap the number of triggers — a runaway click loop would otherwise
      // append unbounded entries to the workflow row.
      if (ts.length >= 10) return ts
      return [...ts, { kind: 'stage_entered', config: {} }]
    })
    scheduleAutosave()
  }
  function handleDeleteTrigger(index: number) {
    if (triggers.length <= 1) return
    setTriggers(ts => ts.filter((_, i) => i !== index))
    tPosRef.current.delete(`__t_${index}`)
    setSelectedId(null)
    scheduleAutosave()
  }
  function handleTriggerKind(index: number, kind: WorkflowTrigger['kind']) {
    setTriggers(ts => ts.map((t, i) => i === index ? { kind, config: {} } : t))
    scheduleAutosave()
  }
  function handleTriggerConfig(index: number, key: string, value: unknown) {
    setTriggers(ts => ts.map((t, i) => i === index ? { ...t, config: { ...t.config, [key]: value } } : t))
    scheduleAutosave()
  }

  // Graph handlers
  function handleAddNode(type: NodeType) {
    const id = nextNodeId(type)
    setGraph(g => {
      // Idempotent against double invocations or accidental id collision.
      if (g.nodes.some(n => n.id === id)) return g
      // Place the new node below the current bottom-most node so successive
      // additions don't pile on top of the start node at (0,0).
      const positions = Array.from(posRef.current.values())
      const maxY = positions.length ? Math.max(...positions.map(p => p.y)) : 0
      posRef.current.set(id, { x: 0, y: maxY + YSTEP })
      return { ...g, nodes: [...g.nodes, { id, type, config: {} }] }
    })
    setSelectedId(id)
    scheduleAutosave()
  }
  function handleDeleteNode(nodeId: string) {
    setGraph(g => ({
      ...g,
      nodes: g.nodes.filter(n => n.id !== nodeId),
      edges: g.edges.filter(e => e.from !== nodeId && e.to !== nodeId),
      start_node_id: g.start_node_id === nodeId
        ? (g.nodes.find(n => n.id !== nodeId)?.id ?? '')
        : g.start_node_id,
    }))
    posRef.current.delete(nodeId)
    setSelectedId(null)
    scheduleAutosave()
  }
  function handleNodeConfig(nodeId: string, key: string, value: unknown) {
    setGraph(g => ({ ...g, nodes: g.nodes.map(n => n.id === nodeId ? { ...n, config: { ...n.config, [key]: value } } : n) }))
    scheduleAutosave()
  }
  function handleSetStart(nodeId: string) {
    setGraph(g => ({ ...g, start_node_id: nodeId }))
    scheduleAutosave()
  }
  function handleConnect(conn: Connection) {
    if (!conn.source || !conn.target) return
    if (conn.source.startsWith('__t_') || conn.target.startsWith('__t_')) return
    if (conn.source === conn.target) return
    // sourceHandle id is the edge label (then/else/on_reply/...). Falls back
    // to 'then' if the source somehow has no port (e.g. a stop node).
    const label = (conn.sourceHandle ?? 'then').trim()
    if (!label) return
    setGraph(g => ({
      ...g,
      // One outgoing edge per (source, label) — replace any prior wiring of
      // this port so the user can re-target a branch by dragging again.
      edges: [
        ...g.edges.filter(e => !(e.from === conn.source && e.label === label)),
        { from: conn.source!, to: conn.target!, label },
      ],
    }))
    scheduleAutosave()
  }
  function handleRemoveEdge(edgeId: string) {
    if (edgeId.startsWith('__te_')) return
    setGraph(g => {
      const rfE = toRFEdges(g, triggers).find(e => e.id === edgeId)
      if (!rfE) return g
      return { ...g, edges: g.edges.filter(e => !(e.from === rfE.source && e.to === rfE.target && e.label === rfE.label)) }
    })
    scheduleAutosave()
  }

  function handleNodeClick(_: React.MouseEvent, node: Node) { setSelectedId(node.id) }
  function handlePaneClick() { setSelectedId(null) }

  async function handleRunTest() {
    setTestRunning(true); setTestSteps([])
    try {
      const res = await fetch(`/api/workflows/${workflow.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: testLeadId || null }),
      })
      if (res.ok) setTestSteps(((await res.json()) as { steps: SimStep[] }).steps)
    } finally { setTestRunning(false) }
  }

  async function handleDelete() {
    if (!confirm('Delete this workflow? All run history will be deleted.')) return
    await fetch(`/api/workflows/${workflow.id}`, { method: 'DELETE' })
    router.push('/dashboard/workflows')
  }

  return (
    <div data-workflow-editor>
      {/* Header */}
      <header className="wfe-header">
        <div className="wfe-header-left">
          <button type="button" className="wfe-icon-btn" onClick={() => router.push('/dashboard/workflows')}>
            <ArrowLeftIcon />
          </button>
          <div className="wfe-hdr-sep" />
          <button type="button" className="wfe-icon-btn" disabled title="Undo"><UndoIcon /></button>
          <button type="button" className="wfe-icon-btn" disabled title="Redo"><RedoIcon /></button>
        </div>

        <div className="wfe-header-center">
          <button type="button" className="wfe-breadcrumb-link" onClick={() => router.push('/dashboard/workflows')}>
            Workflows
          </button>
          <span className="wfe-sep">/</span>
          {nameEditing ? (
            <input
              className="wfe-name-input"
              value={name}
              onChange={e => setName(e.target.value)}
              onBlur={() => { setNameEditing(false); scheduleAutosave() }}
              onKeyDown={e => e.key === 'Enter' && setNameEditing(false)}
              autoFocus
            />
          ) : (
            <button type="button" className="wfe-name-btn" onClick={() => setNameEditing(true)}>
              {name || 'Untitled'}
            </button>
          )}
        </div>

        <div className="wfe-header-right">
          <button type="button" className={`wfe-test-btn${testMode ? ' active' : ''}`}
            onClick={() => { setTestMode(m => !m); setTestSteps([]) }}>
            Test
          </button>
          <button type="button" className={`wfe-status-btn wfe-status-${status}`} onClick={() => {
            const next = status === 'active' ? 'paused' : status === 'paused' ? 'active' : 'active'
            setStatus(next as typeof status); scheduleAutosave()
          }}>{status}</button>
          <button type="button" className="wfe-save-btn" onClick={doSave} disabled={saving}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
          </button>
          <button type="button" className="wfe-icon-btn wfe-icon-danger" onClick={handleDelete} title="Delete">
            <TrashIcon />
          </button>
        </div>
      </header>

      {/* 3-column body */}
      <div className="wfe-main">
        {/* Left — library */}
        <aside className="wfe-lib">
          <div className="wfe-lib-hdr">Nodes Library</div>
          <div className="wfe-lib-section-label">Triggers</div>
          <button type="button" className="wfe-lib-item wfe-lib-trigger" onClick={handleAddTrigger}>
            <div className="wfe-lib-icon" style={{ background: 'rgba(99,102,241,0.12)', color: '#6366F1' }}>
              <NodeTypeIcon type="trigger" size={14} />
            </div>
            <div className="wfe-lib-text">
              <div className="wfe-lib-name">Add Trigger</div>
              <div className="wfe-lib-desc">{NODE_DESCRIPTIONS.trigger}</div>
            </div>
          </button>
          <div className="wfe-lib-section-label">Actions</div>
          {(Object.entries(NODE_META) as [NodeType, { label: string; color: string }][]).map(([type, meta]) => (
            <button key={type} type="button" className="wfe-lib-item" onClick={() => handleAddNode(type)}>
              <div className="wfe-lib-icon" style={{ background: `${meta.color}1a`, color: meta.color }}>
                <NodeTypeIcon type={type} size={14} />
              </div>
              <div className="wfe-lib-text">
                <div className="wfe-lib-name">{meta.label}</div>
                <div className="wfe-lib-desc">{NODE_DESCRIPTIONS[type]}</div>
              </div>
            </button>
          ))}
          <div className="wfe-lib-spacer" />
          <div className="wfe-lib-footer">
            <button type="button" className="wfe-lib-footer-btn">Templates</button>
            <button type="button" className="wfe-lib-footer-btn">Help &amp; Support</button>
          </div>
        </aside>

        {/* Center — canvas */}
        <div className="wfe-canvas-wrap">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={rfNodeTypes}
            onNodesChange={changes => {
              onNodesChange(changes)
              setRfNodes(nds => {
                for (const n of nds) {
                  if (n.id.startsWith('__t_')) tPosRef.current.set(n.id, n.position)
                  else posRef.current.set(n.id, n.position)
                }
                return nds
              })
            }}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            onPaneClick={handlePaneClick}
            onConnect={handleConnect}
            onEdgeDoubleClick={(_, e) => handleRemoveEdge(e.id)}
            fitView
            fitViewOptions={{ padding: 0.4 }}
            minZoom={0.2}
            maxZoom={2}
          >
            <Background variant={BackgroundVariant.Dots} color="#D1D5DB" gap={20} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        {/* Right — config */}
        <aside className="wfe-rail">
          {testMode ? (
            <TestPanel
              leads={leads} testLeadId={testLeadId} setTestLeadId={setTestLeadId}
              testRunning={testRunning} testSteps={testSteps} onRun={handleRunTest}
            />
          ) : selectedTrigger ? (
            <TriggerPanel
              trigger={selectedTrigger}
              index={selectedTriggerIndex}
              canDelete={triggers.length > 1}
              stages={stages}
              actionPages={actionPages}
              onKind={kind => handleTriggerKind(selectedTriggerIndex, kind)}
              onConfig={(k, v) => handleTriggerConfig(selectedTriggerIndex, k, v)}
              onDelete={() => handleDeleteTrigger(selectedTriggerIndex)}
            />
          ) : selectedNode ? (
            <NodePanel
              node={selectedNode}
              graph={graph}
              isStart={selectedNode.id === graph.start_node_id}
              stages={stages}
              actionPages={actionPages}
              onChange={handleNodeConfig}
              onDelete={() => handleDeleteNode(selectedNode.id)}
              onSetStart={() => handleSetStart(selectedNode.id)}
            />
          ) : (
            <div className="wfe-rail-empty">
              <p>Select a node or trigger to configure</p>
            </div>
          )}
        </aside>
      </div>

      {/* Health bar */}
      <HealthBar workflow={workflow} testSteps={testSteps} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Panel section (accordion)
// ---------------------------------------------------------------------------

function PanelSection({ title, children, defaultOpen = true }: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="wfe-ps">
      <button type="button" className="wfe-ps-hdr" onClick={() => setOpen(o => !o)}>
        <span>{title}</span>
        <svg className={`wfe-ps-chevron${open ? '' : ' closed'}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 15l-6-6-6 6" />
        </svg>
      </button>
      {open && <div className="wfe-ps-body">{children}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Trigger config panel
// ---------------------------------------------------------------------------

function TriggerPanel({ trigger, index, canDelete, stages, actionPages, onKind, onConfig, onDelete }: {
  trigger: WorkflowTrigger
  index: number
  canDelete: boolean
  stages: Array<{ id: string; name: string }>
  actionPages: Array<{ id: string; title: string }>
  onKind: (kind: WorkflowTrigger['kind']) => void
  onConfig: (key: string, value: unknown) => void
  onDelete: () => void
}) {
  const cfg = trigger.config as Record<string, unknown>
  return (
    <div className="wfe-panel">
      <div className="wfe-panel-hdr" style={{ '--node-color': '#6366F1' } as React.CSSProperties}>
        <div className="wfe-panel-icon"><NodeTypeIcon type="trigger" size={13} /></div>
        <div className="wfe-panel-hdr-text">
          <span className="wfe-panel-title">Trigger {index + 1}</span>
          <span className="wfe-panel-sub-title">{triggerLabel(trigger)}</span>
        </div>
        {canDelete && (
          <button type="button" className="wfe-panel-del" onClick={onDelete}><TrashIcon /></button>
        )}
      </div>

      <PanelSection title="Trigger Settings">
        <div className="wfe-field">
          <label>Type</label>
          <select value={trigger.kind} onChange={e => onKind(e.target.value as WorkflowTrigger['kind'])}>
            {TRIGGER_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </div>

        {(trigger.kind === 'stage_entered' || trigger.kind === 'stage_idle') && (
          <div className="wfe-field">
            <label>Stage</label>
            <select value={(cfg.stage_id as string) ?? ''} onChange={e => onConfig('stage_id', e.target.value || null)}>
              <option value="">Any stage</option>
              {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}

        {trigger.kind === 'stage_idle' && (
          <div className="wfe-field">
            <label>Idle for (minutes)</label>
            <input
              type="number"
              min={1}
              value={
                cfg.min_idle_ms != null
                  ? Math.round((cfg.min_idle_ms as number) / 60_000)
                  : (cfg.min_idle_minutes as number) ?? 60
              }
              onChange={e => {
                const mins = parseInt(e.target.value) || 60
                onConfig('min_idle_ms', mins * 60_000)
              }}
            />
          </div>
        )}

        {trigger.kind === 'submission_received' && (
          <>
            <div className="wfe-field">
              <label>Action page</label>
              <select value={(cfg.action_page_id as string) ?? ''} onChange={e => onConfig('action_page_id', e.target.value || null)}>
                <option value="">Any page</option>
                {actionPages.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
            <div className="wfe-field">
              <label>Outcome (optional)</label>
              <input type="text" placeholder="e.g. booked" value={(cfg.outcome as string) ?? ''}
                onChange={e => onConfig('outcome', e.target.value || null)} />
            </div>
          </>
        )}

        {trigger.kind === 'booking_offset' && (
          <div className="wfe-field">
            <label>Offset</label>
            <select value={(cfg.offset as string) ?? '-2h'} onChange={e => onConfig('offset', e.target.value)}>
              <option value="-3d">3 days before</option>
              <option value="-2d">2 days before</option>
              <option value="-1d">1 day before</option>
              <option value="-2h">2 hours before</option>
              <option value="-1h">1 hour before</option>
              <option value="-20m">20 minutes before</option>
              <option value="-10m">10 minutes before</option>
              <option value="-5m">5 minutes before</option>
            </select>
          </div>
        )}

        {trigger.kind === 'cart_abandoned' && (
          <>
            <div className="wfe-field">
              <label>Idle threshold (minutes)</label>
              <input
                type="number"
                min={1}
                value={
                  cfg.min_idle_minutes != null
                    ? Number(cfg.min_idle_minutes)
                    : cfg.min_idle_ms != null
                      ? Math.round(Number(cfg.min_idle_ms) / 60000)
                      : 30
                }
                onChange={e => {
                  const minutes = Number(e.target.value) || 30
                  onConfig('min_idle_minutes', minutes)
                  onConfig('min_idle_ms', minutes * 60_000)
                }}
              />
              <small>Cart fires this trigger after being idle for this many minutes (default 30).</small>
            </div>
            <div className="wfe-field">
              <label>Source filter (optional)</label>
              <input
                type="text"
                placeholder="e.g. messenger_bot"
                value={(cfg.source as string) ?? ''}
                onChange={e => onConfig('source', e.target.value || undefined)}
              />
              <small>Leave blank to match carts from any source.</small>
            </div>
          </>
        )}
      </PanelSection>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Node config panel
// ---------------------------------------------------------------------------

function NodePanel({ node, graph, isStart, stages, actionPages, onChange, onDelete, onSetStart }: {
  node: WFNode
  graph: WorkflowGraph
  isStart: boolean
  stages: Array<{ id: string; name: string }>
  actionPages: Array<{ id: string; title: string }>
  onChange: (nodeId: string, key: string, value: unknown) => void
  onDelete: () => void
  onSetStart: () => void
}) {
  const meta = NODE_META[node.type] ?? { label: node.type, color: '#94A3B8' }
  const cfg = node.config as Record<string, unknown>
  const set = (k: string, v: unknown) => onChange(node.id, k, v)
  const outEdges = graph.edges.filter(e => e.from === node.id)
  const getNodeLabel = (id: string) => {
    const n = graph.nodes.find(n => n.id === id)
    return n ? (NODE_META[n.type]?.label ?? n.type) : id
  }

  return (
    <div className="wfe-panel">
      <div className="wfe-panel-hdr" style={{ '--node-color': meta.color } as React.CSSProperties}>
        <div className="wfe-panel-icon"><NodeTypeIcon type={node.type} size={13} /></div>
        <div className="wfe-panel-hdr-text">
          <span className="wfe-panel-title">{meta.label}</span>
          <span className="wfe-panel-sub-title">{NODE_DESCRIPTIONS[node.type]}</span>
        </div>
        <button type="button" className="wfe-panel-del" onClick={onDelete}><TrashIcon /></button>
      </div>

      {node.type === 'send' && (
        <PanelSection title="Message">
          <div className="wfe-field">
            <label>Type</label>
            <select value={((cfg.payload as Record<string, unknown>)?.kind as string) ?? 'text'}
              onChange={e => set('payload', { ...((cfg.payload as Record<string, unknown>) ?? {}), kind: e.target.value })}>
              <option value="text">Text</option>
              <option value="button">Button / CTA</option>
            </select>
          </div>
          <div className="wfe-field">
            <label>Message</label>
            <textarea rows={3} placeholder="Type your message…"
              value={((cfg.payload as Record<string, unknown>)?.text as string) ?? ''}
              onChange={e => set('payload', { ...((cfg.payload as Record<string, unknown>) ?? {}), kind: ((cfg.payload as Record<string, unknown>)?.kind as string) ?? 'text', text: e.target.value })} />
          </div>
          {((cfg.payload as Record<string, unknown>)?.kind as string) === 'button' && (<>
            <div className="wfe-field">
              <label>Button label</label>
              <input type="text" placeholder="e.g. Book now"
                value={((cfg.payload as Record<string, unknown>)?.ctaLabel as string) ?? ''}
                onChange={e => set('payload', { ...((cfg.payload as Record<string, unknown>) ?? {}), ctaLabel: e.target.value })} />
            </div>
            <div className="wfe-field">
              <label>Button URL</label>
              <input type="text" placeholder="https://…"
                value={((cfg.payload as Record<string, unknown>)?.url as string) ?? ''}
                onChange={e => set('payload', { ...((cfg.payload as Record<string, unknown>) ?? {}), url: e.target.value })} />
            </div>
          </>)}
          <div className="wfe-field">
            <label>Channel</label>
            <select value={(cfg.kind as string) ?? 'workflow_human_agent'}
              onChange={e => set('kind', e.target.value)}>
              <option value="workflow_human_agent">Human Agent (7-day window)</option>
              <option value="bot">Bot (24-hour window only)</option>
            </select>
            <small>
              Human Agent uses Meta&apos;s 7-day tag — keep messages reviewable, since
              policy expects a real human in the loop. Bot mode pauses the run if
              the lead is outside the 24-hour window.
            </small>
          </div>
        </PanelSection>
      )}

      {node.type === 'set_stage' && (
        <PanelSection title="Stage">
          <div className="wfe-field">
            <label>Target stage</label>
            <select value={(cfg.stage_id as string) ?? ''} onChange={e => set('stage_id', e.target.value)}>
              <option value="">— choose stage —</option>
              {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </PanelSection>
      )}

      {node.type === 'wait' && (
        <PanelSection title="Wait Settings">
          <div className="wfe-field">
            <label>Duration (minutes)</label>
            <input type="number" min={1}
              value={cfg.duration_ms ? Math.round((cfg.duration_ms as number) / 60_000) : ''}
              onChange={e => set('duration_ms', parseInt(e.target.value) * 60_000 || null)} />
          </div>
          <div className="wfe-field">
            <label>Interrupt on</label>
            {(['inbound_message', 'stage_changed', 'submission_received'] as const).map(opt => (
              <label key={opt} className="wfe-checkbox">
                <input type="checkbox"
                  checked={Array.isArray(cfg.interrupt_on) && (cfg.interrupt_on as string[]).includes(opt)}
                  onChange={e => {
                    const cur = (cfg.interrupt_on as string[]) ?? []
                    set('interrupt_on', e.target.checked ? [...cur, opt] : cur.filter(o => o !== opt))
                  }} />
                {opt.replace(/_/g, ' ')}
              </label>
            ))}
          </div>
        </PanelSection>
      )}

      {node.type === 'wait_for_reply' && (
        <PanelSection title="Reply Settings">
          <div className="wfe-field">
            <label>Timeout (minutes)</label>
            <input type="number" min={1}
              value={cfg.timeout_ms ? Math.round((cfg.timeout_ms as number) / 60_000) : ''}
              onChange={e => set('timeout_ms', parseInt(e.target.value) * 60_000 || null)} />
          </div>
        </PanelSection>
      )}

      {node.type === 'if' && (<>
        <PanelSection title="Logic">
          <p className="wfe-hint" style={{ marginBottom: 8 }}>
            Drag from the green <code>then</code> port when conditions pass, or the
            red <code>else</code> port when they fail.
          </p>
          <div className="wfe-field">
            <label>Operator</label>
            <select value={(cfg.logic as string) ?? 'AND'} onChange={e => set('logic', e.target.value)}>
              <option value="AND">AND — all must pass</option>
              <option value="OR">OR — any must pass</option>
            </select>
          </div>
        </PanelSection>
        <PanelSection title="Conditions">
          {((cfg.conditions as Array<Record<string, unknown>>) ?? []).map((cond, i) => (
            <div key={i} className="wfe-condition">
              <select value={(cond.kind as string) ?? 'in_stage'} onChange={e => {
                const cs = [...((cfg.conditions as Array<Record<string, unknown>>) ?? [])]
                cs[i] = { kind: e.target.value, params: {} }; set('conditions', cs)
              }}>
                <option value="in_stage">Lead is in stage</option>
                <option value="replied_within">Replied within 24h</option>
                <option value="submission_outcome_is">Submission outcome is</option>
                <option value="custom_field_eq">Custom field equals</option>
              </select>
              {cond.kind === 'in_stage' && (
                <select value={((cond.params as Record<string, unknown>)?.stage_id as string) ?? ''}
                  onChange={e => {
                    const cs = [...((cfg.conditions as Array<Record<string, unknown>>) ?? [])]
                    cs[i] = { ...cs[i], params: { stage_id: e.target.value } }; set('conditions', cs)
                  }}>
                  <option value="">— stage —</option>
                  {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
              {cond.kind === 'submission_outcome_is' && (
                <input type="text" placeholder="e.g. booked"
                  value={((cond.params as Record<string, unknown>)?.outcome as string) ?? ''}
                  onChange={e => {
                    const cs = [...((cfg.conditions as Array<Record<string, unknown>>) ?? [])]
                    cs[i] = { ...cs[i], params: { outcome: e.target.value } }; set('conditions', cs)
                  }} />
              )}
              <button type="button" className="wfe-rm" onClick={() => {
                const cs = [...((cfg.conditions as Array<Record<string, unknown>>) ?? [])]; cs.splice(i, 1); set('conditions', cs)
              }}>✕</button>
            </div>
          ))}
          <button type="button" className="wfe-add-cond" onClick={() => {
            const cs = [...((cfg.conditions as Array<Record<string, unknown>>) ?? [])]; cs.push({ kind: 'in_stage', params: {} }); set('conditions', cs)
          }}>+ Add condition</button>
        </PanelSection>
      </>)}

      {node.type === 'request_marketing_optin' && (
        <PanelSection title="Opt-in Settings">
          <div className="wfe-field">
            <label>Message</label>
            <textarea rows={3} placeholder="e.g. Reply YES to opt in."
              value={(cfg.message as string) ?? ''} onChange={e => set('message', e.target.value)} />
          </div>
          <div className="wfe-field">
            <label>Timeout (minutes)</label>
            <input type="number" min={1}
              value={cfg.timeout_ms ? Math.round((cfg.timeout_ms as number) / 60_000) : ''}
              onChange={e => set('timeout_ms', parseInt(e.target.value) * 60_000 || null)} />
          </div>
        </PanelSection>
      )}

      {node.type === 'request_otn' && (
        <PanelSection title="OTN Settings">
          <div className="wfe-field">
            <label>Topic</label>
            <input type="text" placeholder="e.g. booking_reminder"
              value={(cfg.topic as string) ?? ''} onChange={e => set('topic', e.target.value)} />
          </div>
          <div className="wfe-field">
            <label>Message</label>
            <textarea rows={3} placeholder="Allow us to send you a reminder."
              value={(cfg.message as string) ?? ''} onChange={e => set('message', e.target.value)} />
          </div>
          <div className="wfe-field">
            <label>Timeout (minutes)</label>
            <input type="number" min={1}
              value={cfg.timeout_ms ? Math.round((cfg.timeout_ms as number) / 60_000) : ''}
              onChange={e => set('timeout_ms', parseInt(e.target.value) * 60_000 || null)} />
          </div>
        </PanelSection>
      )}

      {node.type === 'classify_and_route' && (
        <PanelSection title="AI Routing">
          <p className="wfe-hint">Uses the AI classifier to analyze the last message and apply stage changes.<br />Edges: <code>stage_changed</code> · <code>action_page_recommended</code> · <code>continue</code></p>
        </PanelSection>
      )}

      {node.type === 'stop' && (
        <PanelSection title="Terminal">
          <p className="wfe-hint">End of workflow — this run will complete when it reaches this node.</p>
        </PanelSection>
      )}

      {outEdges.length > 0 && (
        <PanelSection title="Paths" defaultOpen={false}>
          {outEdges.map(e => (
            <div key={`${e.label}-${e.to}`} className="wfe-path-row">
              <code>{e.label}</code>
              <span>→ {getNodeLabel(e.to)}</span>
            </div>
          ))}
        </PanelSection>
      )}

      <div className="wfe-panel-footer">
        {!isStart && (
          <button type="button" className="wfe-btn-ghost" onClick={onSetStart}>Set as start</button>
        )}
        <button type="button" className="wfe-btn-ghost wfe-btn-red" onClick={onDelete}>Delete node</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Test panel
// ---------------------------------------------------------------------------

function TestPanel({ leads, testLeadId, setTestLeadId, testRunning, testSteps, onRun }: {
  leads: Array<{ id: string; name: string | null; email: string | null; phone: string | null }>
  testLeadId: string
  setTestLeadId: (id: string) => void
  testRunning: boolean
  testSteps: SimStep[]
  onRun: () => void
}) {
  return (
    <div className="wfe-panel">
      <div className="wfe-panel-hdr">
        <span className="wfe-panel-title">Test run</span>
      </div>
      <div className="wfe-panel-body">
        <p className="wfe-hint" style={{ marginBottom: 12 }}>No messages sent, no stages changed.</p>
        <div className="wfe-field">
          <label>Lead (optional)</label>
          <select value={testLeadId} onChange={e => setTestLeadId(e.target.value)}>
            <option value="">Generic context</option>
            {leads.map(l => <option key={l.id} value={l.id}>{l.name ?? l.email ?? l.phone ?? l.id.slice(0, 8)}</option>)}
          </select>
        </div>
        <button type="button" className="wfe-run-btn" onClick={onRun} disabled={testRunning}>
          {testRunning ? 'Simulating…' : '▶ Run simulation'}
        </button>
        {testSteps.length > 0 && (
          <div className="wfe-steps">
            <div className="wfe-steps-title">{testSteps.length} steps</div>
            {testSteps.map((s, i) => (
              <div key={i} className={`wfe-step${s.blocked ? ' blocked' : s.decision === 'error' ? ' err' : ''}`}>
                <div className="wfe-step-row">
                  <span className="wfe-step-num">{i + 1}</span>
                  <span className="wfe-step-type">{NODE_META[s.node_type as NodeType]?.label ?? s.node_type}</span>
                  <span className="wfe-step-dec">{s.decision}</span>
                </div>
                <div className="wfe-step-note">{s.note}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Health bar
// ---------------------------------------------------------------------------

function HealthBar({ workflow, testSteps }: { workflow: WorkflowDetail; testSteps: SimStep[] }) {
  const { health } = workflow
  const blocked = testSteps.filter(s => s.blocked)
  if (!health.failed_7d && !health.policy_blocked_7d && !blocked.length) {
    return <div className="wfe-health wfe-health-ok">No issues in the last 7 days</div>
  }
  return (
    <div className="wfe-health wfe-health-warn">
      {health.failed_7d > 0 && <span className="wfe-health-chip err">{health.failed_7d} failed runs (7d)</span>}
      {health.policy_blocked_7d > 0 && <span className="wfe-health-chip warn">{health.policy_blocked_7d} policy-blocked (7d)</span>}
      {blocked.length > 0 && <span className="wfe-health-chip warn">Sim: {blocked.length} sends would be blocked</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tiny icons
// ---------------------------------------------------------------------------
function ArrowLeftIcon() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 5l-7 7 7 7" /></svg> }
function UndoIcon()      { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 102.13-9.36L1 10" /></svg> }
function RedoIcon()      { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></svg> }
function TrashIcon()     { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /></svg> }
