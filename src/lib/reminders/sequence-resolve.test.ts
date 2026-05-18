import { describe, expect, it, vi, beforeEach } from 'vitest'

const { resolveTopicsMock } = vi.hoisted(() => ({
  resolveTopicsMock: vi.fn<(text: string, items: Array<{ id: string; topic: string }>) => Promise<string[]>>(),
}))

vi.mock('./resolve', () => ({
  resolveTopics: resolveTopicsMock,
}))

import { resolveActiveSequence } from './sequence-resolve'

type Captured = { table: string; op: string; values?: unknown; match?: Record<string, unknown> }

function makeAdmin(active: { id: string; topic: string } | null) {
  const captured: Captured[] = []
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      let pendingMatch: Record<string, unknown> = {}
      let pendingUpdate: unknown = null
      chain.select = () => chain
      chain.eq = (col: string, val: unknown) => {
        pendingMatch = { ...pendingMatch, [col]: val }
        return chain
      }
      chain.maybeSingle = async () => ({ data: active, error: null })
      chain.update = (values: unknown) => {
        pendingUpdate = values
        return chain
      }
      chain.then = (resolve: (r: { data: unknown; error: null }) => void) => {
        if (pendingUpdate !== null) {
          captured.push({ table, op: 'update', values: pendingUpdate, match: pendingMatch })
        }
        resolve({ data: null, error: null })
      }
      return chain
    },
  }
  return { admin, captured }
}

beforeEach(() => resolveTopicsMock.mockReset())

describe('resolveActiveSequence', () => {
  it('returns false when no active sequence exists', async () => {
    const { admin, captured } = makeAdmin(null)
    const ok = await resolveActiveSequence(admin as never, {
      leadId: 'l1',
      inboundText: 'ok send pricing now',
    })
    expect(ok).toBe(false)
    expect(captured.find((c) => c.op === 'update')).toBeUndefined()
    expect(resolveTopicsMock).not.toHaveBeenCalled()
  })

  it('marks sequence resolved when resolveTopics returns its id', async () => {
    resolveTopicsMock.mockResolvedValue(['seq-1'])
    const { admin, captured } = makeAdmin({ id: 'seq-1', topic: 'pricing' })
    const ok = await resolveActiveSequence(admin as never, {
      leadId: 'l1',
      inboundText: 'ok send pricing now',
    })
    expect(ok).toBe(true)
    const upd = captured.find((c) => c.op === 'update' && c.table === 'lead_reminder_sequences')!
    expect((upd.values as Record<string, unknown>).status).toBe('resolved')
    expect((upd.values as Record<string, unknown>).resolved_reason).toBe('topic_addressed')
  })

  it('leaves the sequence alone when resolveTopics returns nothing', async () => {
    resolveTopicsMock.mockResolvedValue([])
    const { admin, captured } = makeAdmin({ id: 'seq-1', topic: 'pricing' })
    const ok = await resolveActiveSequence(admin as never, {
      leadId: 'l1',
      inboundText: 'haha thanks',
    })
    expect(ok).toBe(false)
    expect(captured.find((c) => c.op === 'update')).toBeUndefined()
  })
})
