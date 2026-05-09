import { describe, expect, it, vi } from 'vitest'

vi.mock('./trigger', () => ({ triggerWorkflowWorker: vi.fn(async () => undefined) }))

import { dispatchBookingOffsets, cancelBookingFollowups } from './dispatcher'

interface Workflow {
  id: string
  version: number
  trigger?: { kind: string; config: Record<string, unknown> }
  triggers?: Array<{ kind: string; config: Record<string, unknown> }>
}

function makeAdmin(opts: { workflows: Workflow[] }) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
  const updates: Array<{
    table: string
    values: Record<string, unknown>
    where: Record<string, unknown>
  }> = []

  const from = vi.fn((table: string) => {
    if (table === 'workflows') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: opts.workflows, error: null })),
          })),
        })),
      }
    }
    if (table === 'workflow_runs') {
      return {
        insert: vi.fn((row: Record<string, unknown>) => ({
          select: vi.fn(() => ({
            maybeSingle: vi.fn(async () => {
              inserts.push({ table, row })
              return { data: { id: `run_${inserts.length}` }, error: null }
            }),
          })),
        })),
        update: vi.fn((values: Record<string, unknown>) => {
          const where: Record<string, unknown> = {}
          const builder = {
            eq: vi.fn((col: string, val: unknown) => {
              where[col] = val
              return builder
            }),
            like: vi.fn((col: string, val: unknown) => {
              where[col] = val
              updates.push({ table, values, where })
              return Promise.resolve({ error: null })
            }),
          }
          return builder
        }),
      }
    }
    if (table === 'workflow_jobs') {
      return {
        insert: vi.fn(async (row: Record<string, unknown>) => {
          inserts.push({ table, row })
          return { error: null }
        }),
      }
    }
    throw new Error(`unexpected table ${table}`)
  })

  return { admin: { from } as never, inserts, updates }
}

const futureEventAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

describe('dispatchBookingOffsets', () => {
  it('schedules one run per offset present in the workflow triggers', async () => {
    const { admin, inserts } = makeAdmin({
      workflows: [
        {
          id: 'wf_1',
          version: 1,
          triggers: [
            { kind: 'booking_offset', config: { offset: '-1d' } },
            { kind: 'booking_offset', config: { offset: '-10m' } },
          ],
        },
      ],
    })

    await dispatchBookingOffsets(admin, {
      userId: 'u1',
      bookingEventId: 'be_1',
      leadId: 'l1',
      threadId: 't1',
      eventAt: futureEventAt,
    })

    const runInserts = inserts.filter((i) => i.table === 'workflow_runs')
    expect(runInserts).toHaveLength(2)
    const offsets = runInserts.map((i) => (i.row.dedup_key as string).split(':').pop())
    expect(offsets.sort()).toEqual(['-10m', '-1d'])
  })

  it('respects action_page_id filter on the trigger', async () => {
    const { admin, inserts } = makeAdmin({
      workflows: [
        {
          id: 'wf_a',
          version: 1,
          triggers: [
            { kind: 'booking_offset', config: { offset: '-1d', action_page_id: 'ap_match' } },
          ],
        },
        {
          id: 'wf_b',
          version: 1,
          triggers: [
            { kind: 'booking_offset', config: { offset: '-1d', action_page_id: 'ap_other' } },
          ],
        },
      ],
    })

    await dispatchBookingOffsets(admin, {
      userId: 'u1',
      bookingEventId: 'be_1',
      leadId: 'l1',
      threadId: 't1',
      eventAt: futureEventAt,
      actionPageId: 'ap_match',
    })

    const runInserts = inserts.filter((i) => i.table === 'workflow_runs')
    expect(runInserts).toHaveLength(1)
    expect(runInserts[0].row.dedup_key as string).toContain('wf_a')
  })

  it('matches workflows with no action_page_id (back-compat)', async () => {
    const { admin, inserts } = makeAdmin({
      workflows: [
        {
          id: 'wf_unfiltered',
          version: 1,
          triggers: [{ kind: 'booking_offset', config: { offset: '-1d' } }],
        },
      ],
    })

    await dispatchBookingOffsets(admin, {
      userId: 'u1',
      bookingEventId: 'be_1',
      leadId: 'l1',
      threadId: 't1',
      eventAt: futureEventAt,
      actionPageId: 'ap_anything',
    })

    expect(inserts.filter((i) => i.table === 'workflow_runs')).toHaveLength(1)
  })

  it('skips offsets that resolve into the past', async () => {
    const justAhead = new Date(Date.now() + 60_000).toISOString()
    const { admin, inserts } = makeAdmin({
      workflows: [
        {
          id: 'wf_1',
          version: 1,
          triggers: [
            { kind: 'booking_offset', config: { offset: '-1d' } },
            { kind: 'booking_offset', config: { offset: '+1h' } },
          ],
        },
      ],
    })

    await dispatchBookingOffsets(admin, {
      userId: 'u1',
      bookingEventId: 'be_1',
      leadId: 'l1',
      threadId: 't1',
      eventAt: justAhead,
    })

    const runInserts = inserts.filter((i) => i.table === 'workflow_runs')
    expect(runInserts).toHaveLength(1)
    expect(runInserts[0].row.dedup_key as string).toContain(':+1h')
  })

  it('ignores triggers with unparseable offsets', async () => {
    const { admin, inserts } = makeAdmin({
      workflows: [
        {
          id: 'wf_1',
          version: 1,
          triggers: [
            { kind: 'booking_offset', config: { offset: 'garbage' } },
            { kind: 'booking_offset', config: { offset: '-1d' } },
          ],
        },
      ],
    })

    await dispatchBookingOffsets(admin, {
      userId: 'u1',
      bookingEventId: 'be_1',
      leadId: 'l1',
      threadId: 't1',
      eventAt: futureEventAt,
    })

    const runInserts = inserts.filter((i) => i.table === 'workflow_runs')
    expect(runInserts).toHaveLength(1)
  })
})

describe('cancelBookingFollowups', () => {
  it('updates waiting runs matching the dedup_key pattern', async () => {
    const { admin, updates } = makeAdmin({ workflows: [] })
    await cancelBookingFollowups(admin, 'be_1')

    const cancelUpdates = updates.filter((u) => u.table === 'workflow_runs')
    expect(cancelUpdates).toHaveLength(1)
    expect(cancelUpdates[0].values.status).toBe('cancelled')
    expect(cancelUpdates[0].values.cancel_reason).toBe('booking_cancelled')
    expect(cancelUpdates[0].where.status).toBe('waiting')
    expect(cancelUpdates[0].where.dedup_key).toContain('be_1')
  })
})
