// These tests exercise the seed logic against a hand-rolled fake admin
// client. They do NOT touch Postgres — the goal is to lock in the call
// sequence (cancel-then-insert) and the conversation_kind decision.

import { describe, expect, it, vi } from 'vitest'

vi.mock('./gates', () => ({
  shouldSeed: vi.fn(),
}))

import { shouldSeed } from './gates'
import { maybeScheduleFollowup } from './seed'

type Captured = { table: string; op: string; values?: unknown; match?: unknown }

function makeAdmin(): { admin: unknown; captured: Captured[] } {
  const captured: Captured[] = []
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      chain.update = (values: unknown) => {
        captured.push({ table, op: 'update', values })
        return chain
      }
      chain.insert = (values: unknown) => {
        captured.push({ table, op: 'insert', values })
        return Promise.resolve({ data: null, error: null })
      }
      chain.eq = (col: string, val: unknown) => {
        captured.push({ table, op: 'eq', match: { col, val } })
        return chain
      }
      chain.in = () => chain
      chain.select = () => chain
      return chain
    },
  }
  return { admin, captured }
}

describe('maybeScheduleFollowup', () => {
  it('cancels existing schedule then inserts new pending row when gates pass', async () => {
    ;(shouldSeed as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      inboundCount: 2,
    })
    const { admin, captured } = makeAdmin()
    const lastInboundAt = new Date('2026-05-17T10:00:00Z').toISOString()

    await maybeScheduleFollowup(admin as never, {
      threadId: 't1', leadId: 'l1', userId: 'u1', pageId: 'p1', lastInboundAt,
    })

    const ops = captured.filter((c) => c.op === 'update' || c.op === 'insert')
    expect(ops[0]).toMatchObject({ table: 'lead_followup_schedules', op: 'update' })
    expect(ops[ops.length - 1]).toMatchObject({ table: 'lead_followup_schedules', op: 'insert' })
    const inserted = ops[ops.length - 1].values as Record<string, unknown>
    expect(inserted.conversation_kind).toBe('generic')
    expect(inserted.next_offset_idx).toBe(0)
    expect(inserted.started_at).toBe(lastInboundAt)
    expect(inserted.next_run_at).toBe(new Date(Date.parse(lastInboundAt) + 5 * 60_000).toISOString())
  })

  it('decides conversation_kind=real when inboundCount >= 4', async () => {
    ;(shouldSeed as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      inboundCount: 7,
    })
    const { admin, captured } = makeAdmin()
    await maybeScheduleFollowup(admin as never, {
      threadId: 't2', leadId: 'l2', userId: 'u1', pageId: 'p1',
      lastInboundAt: new Date().toISOString(),
    })
    const ins = captured.find((c) => c.op === 'insert')!
    expect((ins.values as Record<string, unknown>).conversation_kind).toBe('real')
  })

  it('cancels existing schedule but does not insert when gates fail', async () => {
    ;(shouldSeed as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      reason: 'inbound_count_15',
    })
    const { admin, captured } = makeAdmin()
    await maybeScheduleFollowup(admin as never, {
      threadId: 't3', leadId: 'l3', userId: 'u1', pageId: 'p1',
      lastInboundAt: new Date().toISOString(),
    })
    expect(captured.find((c) => c.op === 'insert')).toBeUndefined()
    expect(captured.find((c) => c.op === 'update')).toBeDefined()
  })
})
