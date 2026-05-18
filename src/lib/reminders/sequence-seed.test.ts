import { describe, expect, it, vi, beforeEach } from 'vitest'

const { generateMock } = vi.hoisted(() => ({
  generateMock: vi.fn<() => Promise<string | null>>(),
}))

vi.mock('./sequence-generate', () => ({
  generateSequenceMessage: generateMock,
}))

import { seedReminderSequence } from './sequence-seed'

type Captured = { table: string; op: string; values?: unknown; match?: Record<string, unknown> }

function makeAdmin(opts?: { sequenceInsertId?: string; existingActiveId?: string | null }) {
  const captured: Captured[] = []
  const sequenceInsertId = opts?.sequenceInsertId ?? 'seq-1'
  const existingActiveId = opts?.existingActiveId ?? null
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
      chain.maybeSingle = async () => {
        if (table === 'lead_reminder_sequences' && pendingMatch.status === 'active') {
          return existingActiveId
            ? { data: { id: existingActiveId }, error: null }
            : { data: null, error: null }
        }
        return { data: null, error: null }
      }
      chain.single = async () => {
        if (table === 'lead_reminder_sequences') return { data: { id: sequenceInsertId }, error: null }
        return { data: null, error: null }
      }
      chain.update = (values: unknown) => {
        pendingUpdate = values
        return chain
      }
      chain.insert = (values: unknown) => {
        captured.push({ table, op: 'insert', values })
        return {
          ...chain,
          select: () => chain,
        }
      }
      chain.then = (resolve: (r: { data: unknown[]; error: null }) => void) => {
        if (pendingUpdate !== null) {
          captured.push({ table, op: 'update', values: pendingUpdate, match: pendingMatch })
        }
        resolve({ data: [], error: null })
      }
      return chain
    },
  }
  return { admin, captured }
}

beforeEach(() => {
  generateMock.mockReset()
})

describe('seedReminderSequence', () => {
  const baseArgs = {
    userId: 'u1',
    leadId: 'l1',
    threadId: 't1',
    anchor: new Date('2026-08-12T06:00:00.000Z'),
    topic: 'pricing for the 3BR unit',
    leadName: 'Maria',
    personalityBlock: 'warm Taglish sales tone',
    sourceMessageId: 'msg-1',
    now: new Date('2026-08-10T06:00:00.000Z'),
  }

  it('inserts 1 sequence row and 7 touchpoints with monotonic scheduled_at', async () => {
    generateMock.mockResolvedValue('hi maria, message body')
    const { admin, captured } = makeAdmin()

    const result = await seedReminderSequence(admin as never, baseArgs)
    expect(result.ok).toBe(true)

    const seqInserts = captured.filter((c) => c.table === 'lead_reminder_sequences' && c.op === 'insert')
    expect(seqInserts.length).toBe(1)
    const reminderInserts = captured.filter((c) => c.table === 'lead_reminders' && c.op === 'insert')
    expect(reminderInserts.length).toBe(7)
    const times = reminderInserts.map((r) => new Date((r.values as Record<string, unknown>).scheduled_at as string).getTime())
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1])
  })

  it('marks any existing active sequence cancelled with rescheduled reason', async () => {
    generateMock.mockResolvedValue('msg')
    const { admin, captured } = makeAdmin({ existingActiveId: 'seq-old' })
    await seedReminderSequence(admin as never, baseArgs)
    const cancel = captured.find(
      (c) =>
        c.table === 'lead_reminder_sequences' &&
        c.op === 'update' &&
        (c.values as Record<string, unknown>).status === 'cancelled',
    )
    expect(cancel).toBeDefined()
    expect((cancel!.values as Record<string, unknown>).resolved_reason).toBe('rescheduled')
  })

  it('sets auto_send=true and sequence_position 0..6 on every touchpoint', async () => {
    generateMock.mockResolvedValue('msg')
    const { admin, captured } = makeAdmin()
    await seedReminderSequence(admin as never, baseArgs)
    const inserts = captured.filter((c) => c.table === 'lead_reminders' && c.op === 'insert')
    const positions = inserts.map((r) => (r.values as Record<string, unknown>).sequence_position as number)
    expect([...positions].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6])
    for (const r of inserts) {
      expect((r.values as Record<string, unknown>).auto_send).toBe(true)
    }
  })

  it('writes pre_generated_text when LLM returns content, NULL when it fails', async () => {
    let callIndex = 0
    generateMock.mockImplementation(async () => {
      callIndex += 1
      return callIndex % 2 === 0 ? 'generated copy' : null
    })
    const { admin, captured } = makeAdmin()
    await seedReminderSequence(admin as never, baseArgs)
    const rows = captured
      .filter((c) => c.table === 'lead_reminders' && c.op === 'insert')
      .map((r) => r.values as Record<string, unknown>)
    const withPregen = rows.filter((r) => r.pre_generated_text !== null)
    expect(withPregen.length).toBeGreaterThan(0)
    expect(withPregen.length).toBeLessThan(7)
    for (const r of rows) expect(r.fallback_text).toBeTruthy()
  })

  it('still inserts the sequence + touchpoints if every LLM call rejects', async () => {
    generateMock.mockResolvedValue(null)
    const { admin, captured } = makeAdmin()
    const result = await seedReminderSequence(admin as never, baseArgs)
    expect(result.ok).toBe(true)
    expect(captured.filter((c) => c.table === 'lead_reminders' && c.op === 'insert').length).toBe(7)
  })
})
