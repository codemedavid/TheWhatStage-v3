import { describe, expect, it, vi } from 'vitest'
import {
  loadManagedFollowups,
  saveManagedFollowups,
  resetManualEdit,
} from './booking-followups-persistence'
import type { FollowupTouchpoint } from './booking-followups'

const baseTp: FollowupTouchpoint = {
  id: 'tp_1',
  enabled: true,
  offset: '-1d',
  template_id: 'tpl_1',
  variables: { '1': { kind: 'lead_field', field: 'name' } },
}

interface ExistingRow {
  id: string
  manually_edited: boolean
  version: number
  status: 'draft' | 'active' | 'paused' | 'archived'
  triggers: unknown
  graph: unknown
}

function makeAdmin(opts: { existing?: ExistingRow | null }) {
  const inserts: Array<{ row: Record<string, unknown> }> = []
  const updates: Array<{ where: Record<string, unknown>; values: Record<string, unknown> }> = []

  const buildSelectChain = () => {
    return {
      eq: vi.fn(function eq() {
        return {
          eq: vi.fn(function eq2() {
            return {
              maybeSingle: vi.fn(async () => ({ data: opts.existing ?? null, error: null })),
            }
          }),
        }
      }),
    }
  }

  const from = vi.fn((table: string) => {
    if (table !== 'workflows') throw new Error(`unexpected table ${table}`)
    return {
      select: vi.fn(() => buildSelectChain()),
      insert: vi.fn((row: Record<string, unknown>) => ({
        select: vi.fn(() => ({
          maybeSingle: vi.fn(async () => {
            inserts.push({ row })
            return { data: { id: 'new_wf_id' }, error: null }
          }),
        })),
      })),
      update: vi.fn((values: Record<string, unknown>) => {
        const where: Record<string, unknown> = {}
        return {
          eq(c1: string, v1: unknown) {
            where[c1] = v1
            return {
              eq(c2: string, v2: unknown) {
                where[c2] = v2
                updates.push({ where, values })
                return Promise.resolve({ data: null, error: null })
              },
            }
          },
        }
      }),
    }
  })

  return { admin: { from } as never, inserts, updates }
}

describe('loadManagedFollowups', () => {
  it('returns null when no managed workflow exists', async () => {
    const { admin } = makeAdmin({ existing: null })
    const out = await loadManagedFollowups(admin, 'page_1')
    expect(out).toBeNull()
  })

  it('returns workflowId/manuallyEdited/version/status when present', async () => {
    const { admin } = makeAdmin({
      existing: {
        id: 'wf_1',
        manually_edited: false,
        version: 1,
        status: 'active',
        triggers: [],
        graph: { nodes: [{ id: 'stop', type: 'stop', config: {} }], edges: [], start_node_id: 'stop' },
      },
    })
    const out = await loadManagedFollowups(admin, 'page_1')
    expect(out).not.toBeNull()
    expect(out!.workflowId).toBe('wf_1')
    expect(out!.manuallyEdited).toBe(false)
    expect(out!.touchpoints).toEqual([])
  })
})

describe('saveManagedFollowups', () => {
  it('inserts a new workflow when none exists', async () => {
    const { admin, inserts } = makeAdmin({ existing: null })
    const result = await saveManagedFollowups(admin, {
      userId: 'u1',
      pageId: 'page_1',
      pageTitle: 'My Booking',
      touchpoints: [baseTp],
    })
    expect(result.ok).toBe(true)
    expect(inserts).toHaveLength(1)
    expect(inserts[0].row.managed_kind).toBe('booking_followups')
    expect(inserts[0].row.managed_source_id).toBe('page_1')
    expect(inserts[0].row.user_id).toBe('u1')
    expect(inserts[0].row.status).toBe('active')
  })

  it('refuses when manually_edited=true', async () => {
    const { admin, inserts, updates } = makeAdmin({
      existing: {
        id: 'wf_1',
        manually_edited: true,
        version: 3,
        status: 'active',
        triggers: [],
        graph: { nodes: [{ id: 'stop', type: 'stop', config: {} }], edges: [], start_node_id: 'stop' },
      },
    })
    const result = await saveManagedFollowups(admin, {
      userId: 'u1',
      pageId: 'page_1',
      pageTitle: 'My Booking',
      touchpoints: [baseTp],
    })
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.reason).toBe('manually_edited')
    expect(inserts).toHaveLength(0)
    expect(updates).toHaveLength(0)
  })

  it('rejects when validateTouchpoints fails', async () => {
    const { admin } = makeAdmin({ existing: null })
    const result = await saveManagedFollowups(admin, {
      userId: 'u1',
      pageId: 'page_1',
      pageTitle: 'My Booking',
      touchpoints: [{ ...baseTp, offset: 'garbage' }],
    })
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.reason).toContain('offset')
  })

  it('updates existing workflow when manually_edited=false', async () => {
    const { admin, updates, inserts } = makeAdmin({
      existing: {
        id: 'wf_1',
        manually_edited: false,
        version: 2,
        status: 'active',
        triggers: [],
        graph: { nodes: [{ id: 'stop', type: 'stop', config: {} }], edges: [], start_node_id: 'stop' },
      },
    })
    const result = await saveManagedFollowups(admin, {
      userId: 'u1',
      pageId: 'page_1',
      pageTitle: 'My Booking',
      touchpoints: [baseTp],
    })
    expect(result.ok).toBe(true)
    expect(inserts).toHaveLength(0)
    expect(updates).toHaveLength(1)
    expect(updates[0].values.version).toBe(3)
    expect(updates[0].where.id).toBe('wf_1')
    expect(updates[0].where.manually_edited).toBe(false)
  })
})

describe('resetManualEdit', () => {
  it('flips manually_edited to false for the page', async () => {
    const { admin, updates } = makeAdmin({ existing: null })
    await resetManualEdit(admin, 'page_1')
    expect(updates).toHaveLength(1)
    expect(updates[0].values.manually_edited).toBe(false)
    expect(updates[0].where.managed_kind).toBe('booking_followups')
    expect(updates[0].where.managed_source_id).toBe('page_1')
  })
})
