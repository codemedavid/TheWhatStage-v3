import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ tag: 'admin' }) }))
vi.mock('@/lib/projects/sequences/seed', () => ({
  seedProjectSequenceRun: vi.fn(async () => undefined),
  cancelActiveProjectSequenceRuns: vi.fn(async () => undefined),
}))
vi.mock('@/lib/messenger/reset-counters', () => ({ resetThreadCountersByLead: vi.fn(async () => undefined) }))

import { seedProjectSequenceRun, cancelActiveProjectSequenceRuns } from '@/lib/projects/sequences/seed'
import { resetThreadCountersByLead } from '@/lib/messenger/reset-counters'
import { createProjectFor, moveProjectFor, updateProjectFor } from './mutations'

type Op = { table: string; op: string; values?: unknown; filters: Array<[string, unknown]> }

// Minimal chainable fake: every query resolves with the next scripted response
// for its table, and records the op + filters so tests can assert scoping.
function makeSupabase(script: Record<string, unknown[]>) {
  const ops: Op[] = []
  const queue = Object.fromEntries(Object.entries(script).map(([k, v]) => [k, [...v]]))
  const supabase = {
    from(table: string) {
      const op: Op = { table, op: 'select', filters: [] }
      ops.push(op)
      const respond = async () => {
        const next = queue[table]?.shift()
        return next ?? { data: null, error: null }
      }
      const chain: Record<string, unknown> = {}
      const self = () => chain
      for (const m of ['eq', 'is', 'order', 'limit', 'in']) {
        chain[m] = (col: string, val?: unknown) => { if (m === 'eq' || m === 'is') op.filters.push([col, val]); return chain }
      }
      chain.select = () => chain
      chain.insert = (values: unknown) => { op.op = 'insert'; op.values = values; return chain }
      chain.update = (values: unknown) => { op.op = 'update'; op.values = values; return chain }
      chain.maybeSingle = respond
      chain.single = respond
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => respond().then(res, rej)
      void self
      return chain
    },
  }
  return { supabase: supabase as never, ops }
}

const LEAD = '11111111-1111-4111-8111-111111111111'
const STAGE = '22222222-2222-4222-8222-222222222222'
const STAGE2 = '33333333-3333-4333-8333-333333333333'
const PROJECT = '44444444-4444-4444-8444-444444444444'

beforeEach(() => {
  vi.mocked(seedProjectSequenceRun).mockClear()
  vi.mocked(cancelActiveProjectSequenceRuns).mockClear()
  vi.mocked(resetThreadCountersByLead).mockClear()
})

describe('createProjectFor', () => {
  it('rejects invalid input before touching the database', async () => {
    const { supabase, ops } = makeSupabase({})
    await expect(createProjectFor(supabase, 'u1', { lead_id: 'nope', stage_id: STAGE, title: 'x' })).rejects.toThrow()
    expect(ops).toHaveLength(0)
  })

  it('throws when the lead is not owned by the caller', async () => {
    const { supabase, ops } = makeSupabase({ leads: [{ data: null, error: null }] })
    await expect(createProjectFor(supabase, 'u1', { lead_id: LEAD, stage_id: STAGE, title: 'x' })).rejects.toThrow('Lead not found')
    expect(ops[0].filters).toContainEqual(['user_id', 'u1'])
  })

  it('inserts with the stage workspace, default currency, next position, then seeds + resets counters', async () => {
    const { supabase, ops } = makeSupabase({
      leads: [{ data: { id: LEAD }, error: null }],
      project_stages: [{ data: { workspace_id: 'ws1' }, error: null }],
      business_profiles: [{ data: { default_currency: 'USD' }, error: null }],
      projects: [{ data: { position: 4 }, error: null }, { data: { id: PROJECT }, error: null }],
    })

    const id = await createProjectFor(supabase, 'u1', { lead_id: LEAD, stage_id: STAGE, title: 'Roof job' })

    expect(id).toBe(PROJECT)
    const insert = ops.find((o) => o.table === 'projects' && o.op === 'insert')
    expect(insert?.values).toMatchObject({ user_id: 'u1', workspace_id: 'ws1', currency: 'USD', position: 5, title: 'Roof job' })
    expect(seedProjectSequenceRun).toHaveBeenCalledWith({ tag: 'admin' }, { userId: 'u1', projectId: PROJECT, leadId: LEAD, stageId: STAGE })
    expect(resetThreadCountersByLead).toHaveBeenCalledWith(supabase, LEAD, { resetMissed: true }, 'u1')
  })
})

describe('updateProjectFor', () => {
  it('returns false and skips the write when nothing changes', async () => {
    const { supabase, ops } = makeSupabase({})
    expect(await updateProjectFor(supabase, 'u1', PROJECT, {})).toBe(false)
    expect(ops).toHaveLength(0)
  })

  it('writes only defined fields, scoped by owner', async () => {
    const { supabase, ops } = makeSupabase({ projects: [{ data: null, error: null }] })
    expect(await updateProjectFor(supabase, 'u1', PROJECT, { title: 'New', notes: undefined })).toBe(true)
    expect(ops[0]).toMatchObject({ op: 'update', values: { title: 'New' } })
    expect(ops[0].filters).toEqual([['id', PROJECT], ['user_id', 'u1']])
  })
})

describe('moveProjectFor', () => {
  it('records a stage event with the reason and reseeds when the stage changes', async () => {
    const { supabase, ops } = makeSupabase({
      projects: [{ data: { stage_id: STAGE, lead_id: LEAD }, error: null }, { data: null, error: null }],
      project_stage_events: [{ data: null, error: null }],
    })

    const out = await moveProjectFor(supabase, 'u1', PROJECT, STAGE2, 0, { reason: 'customer paid' })

    expect(out).toEqual({ stageChanged: true })
    const evt = ops.find((o) => o.table === 'project_stage_events')
    expect(evt?.values).toMatchObject({ project_id: PROJECT, user_id: 'u1', from_stage_id: STAGE, to_stage_id: STAGE2, source: 'user', reason: 'customer paid' })
    expect(cancelActiveProjectSequenceRuns).toHaveBeenCalledOnce()
    expect(seedProjectSequenceRun).toHaveBeenCalledWith({ tag: 'admin' }, { userId: 'u1', projectId: PROJECT, leadId: LEAD, stageId: STAGE2 })
  })

  it('does not write an event when only the position changes', async () => {
    const { supabase, ops } = makeSupabase({
      projects: [{ data: { stage_id: STAGE, lead_id: LEAD }, error: null }, { data: null, error: null }],
    })
    const out = await moveProjectFor(supabase, 'u1', PROJECT, STAGE, 3)
    expect(out).toEqual({ stageChanged: false })
    expect(ops.some((o) => o.table === 'project_stage_events')).toBe(false)
    expect(seedProjectSequenceRun).not.toHaveBeenCalled()
  })
})
