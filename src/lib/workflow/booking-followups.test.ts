import { describe, expect, it } from 'vitest'
import {
  validateTouchpoint,
  validateTouchpoints,
  generateFollowupGraph,
  parseTouchpointsFromWorkflow,
  type FollowupTouchpoint,
} from './booking-followups'

const baseTp = (overrides: Partial<FollowupTouchpoint>): FollowupTouchpoint => ({
  id: 'tp_1',
  enabled: true,
  offset: '-1d',
  template_id: 'tpl_1',
  variables: { '1': { kind: 'lead_field', field: 'name' } },
  ...overrides,
})

describe('validateTouchpoint', () => {
  it('accepts a valid touchpoint', () => {
    expect(validateTouchpoint(baseTp({}))).toBeNull()
  })
  it('rejects unparseable offset', () => {
    expect(validateTouchpoint(baseTp({ offset: 'bad' }))).toContain('offset')
  })
  it('rejects offset beyond plus or minus 30d', () => {
    expect(validateTouchpoint(baseTp({ offset: '-31d' }))).toContain('offset')
  })
  it('rejects empty template_id', () => {
    expect(validateTouchpoint(baseTp({ template_id: '' }))).toContain('template_id')
  })
})

describe('validateTouchpoints', () => {
  it('rejects more than 7', () => {
    const tps = Array.from({ length: 8 }, (_, i) =>
      baseTp({ id: `tp${i}`, offset: `-${i + 1}m` }),
    )
    expect(validateTouchpoints(tps)).toContain('7')
  })
  it('rejects duplicate enabled offsets', () => {
    const tps = [baseTp({ id: 'a', offset: '-1d' }), baseTp({ id: 'b', offset: '-1d' })]
    expect(validateTouchpoints(tps)).toContain('duplicate')
  })
  it('allows duplicate offsets if one is disabled', () => {
    const tps = [
      baseTp({ id: 'a', offset: '-1d', enabled: true }),
      baseTp({ id: 'b', offset: '-1d', enabled: false }),
    ]
    expect(validateTouchpoints(tps)).toBeNull()
  })
})

describe('generateFollowupGraph', () => {
  it('produces N triggers for N enabled touchpoints, each scoped to action_page_id', () => {
    const out = generateFollowupGraph(
      [
        baseTp({ id: 'a', offset: '-1d' }),
        baseTp({ id: 'b', offset: '-10m' }),
        baseTp({ id: 'c', offset: '+0' }),
      ],
      'page_1',
    )
    expect(out.triggers).toHaveLength(3)
    for (const t of out.triggers) {
      expect(t.kind).toBe('booking_offset')
      expect((t.config as { action_page_id?: string }).action_page_id).toBe('page_1')
    }
    const offsets = out.triggers.map((t) => (t.config as { offset?: string }).offset).sort()
    expect(offsets).toEqual(['+0', '-10m', '-1d'])
  })

  it('skips disabled touchpoints', () => {
    const out = generateFollowupGraph(
      [
        baseTp({ id: 'a', offset: '-1d', enabled: true }),
        baseTp({ id: 'b', offset: '-10m', enabled: false }),
      ],
      'page_1',
    )
    expect(out.triggers).toHaveLength(1)
    expect((out.triggers[0].config as { offset?: string }).offset).toBe('-1d')
  })

  it('returns at least a stop node when no enabled touchpoints', () => {
    const out = generateFollowupGraph([baseTp({ enabled: false })], 'page_1')
    expect(out.triggers).toHaveLength(0)
    expect(out.nodes.some((n) => n.type === 'stop')).toBe(true)
    expect(out.start_node_id).toBeDefined()
    expect(out.nodes.some((n) => n.id === out.start_node_id)).toBe(true)
  })

  it('builds chained-if router so each offset reaches its own send node', () => {
    const out = generateFollowupGraph(
      [
        baseTp({ id: 'a', offset: '-1d' }),
        baseTp({ id: 'b', offset: '-10m' }),
      ],
      'page_1',
    )
    const sends = out.nodes.filter((n) => n.type === 'send')
    expect(sends).toHaveLength(2)
    for (const s of sends) {
      expect((s.config as { payload?: { kind?: string } }).payload?.kind).toBe('utility_template')
    }
    expect(out.nodes.some((n) => n.type === 'stop')).toBe(true)
    // The if-condition uses bare key 'offset', not a dotted path
    const ifs = out.nodes.filter((n) => n.type === 'if')
    expect(ifs.length).toBe(2)
    for (const ifNode of ifs) {
      const cfg = ifNode.config as {
        conditions: Array<{ kind: string; params: { field?: string; value?: string } }>
      }
      expect(cfg.conditions[0].kind).toBe('custom_field_eq')
      expect(cfg.conditions[0].params.field).toBe('offset')
    }
  })
})

describe('parseTouchpointsFromWorkflow', () => {
  it('round-trips generateFollowupGraph output', () => {
    const tps: FollowupTouchpoint[] = [
      baseTp({ id: 'a', offset: '-1d', template_id: 'tpl_a' }),
      baseTp({
        id: 'b',
        offset: '-10m',
        template_id: 'tpl_b',
        variables: { '1': { kind: 'static', text: 'Hello' } },
      }),
    ]
    const graph = generateFollowupGraph(tps, 'page_1')
    const parsed = parseTouchpointsFromWorkflow({
      triggers: graph.triggers,
      graph: { nodes: graph.nodes, edges: graph.edges, start_node_id: graph.start_node_id },
    })
    expect(parsed).toHaveLength(2)
    const aOut = parsed.find((p) => p.offset === '-1d')!
    const bOut = parsed.find((p) => p.offset === '-10m')!
    expect(aOut.template_id).toBe('tpl_a')
    expect(bOut.template_id).toBe('tpl_b')
    expect(bOut.variables).toEqual({ '1': { kind: 'static', text: 'Hello' } })
    expect(aOut.enabled).toBe(true)
  })

  it('returns [] when graph has no booking_offset send nodes', () => {
    const parsed = parseTouchpointsFromWorkflow({
      triggers: [{ kind: 'submission_received', config: {} }],
      graph: {
        nodes: [{ id: 'n1', type: 'stop', config: {} }],
        edges: [],
        start_node_id: 'n1',
      },
    })
    expect(parsed).toEqual([])
  })
})
