// These tests exercise the seed logic against a hand-rolled fake admin
// client. They do NOT touch Postgres — the goal is to lock in the call
// sequence (cancel-then-insert), the conversation_kind decision, and the
// snapshot that gets written to lead_followup_schedules.

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('./gates', () => ({ shouldSeed: vi.fn() }))
vi.mock('./settings', async () => {
  const actual = await vi.importActual<typeof import('./settings')>('./settings')
  return {
    ...actual,
    loadFollowupSettings: vi.fn(),
  }
})

import { shouldSeed } from './gates'
import { loadFollowupSettings, DEFAULT_FOLLOWUP_SETTINGS } from './settings'
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

const mockShouldSeed = shouldSeed as unknown as ReturnType<typeof vi.fn>
const mockLoadSettings = loadFollowupSettings as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockShouldSeed.mockReset()
  mockLoadSettings.mockReset()
  mockLoadSettings.mockResolvedValue(DEFAULT_FOLLOWUP_SETTINGS)
})

describe('maybeScheduleFollowup', () => {
  it('cancels existing schedule then inserts new pending row when gates pass', async () => {
    mockShouldSeed.mockResolvedValue({ ok: true, inboundCount: 2 })
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
    expect(inserted.offsets_snapshot).toEqual([
      { offset_ms: 300000,   slot: 0, instruction: 'Quick light hello — just ask if still interested po.' },
      { offset_ms: 3600000,  slot: 1, instruction: 'Friendly nudge — offer to answer any questions.' },
      { offset_ms: 18000000, slot: 2, instruction: 'Share one concrete benefit or social proof — keep it short.' },
      { offset_ms: 28800000, slot: 3, instruction: "Ask one focused question to surface what's blocking them." },
      { offset_ms: 43200000, slot: 4, instruction: 'Light reminder — emphasize convenience and flexibility.' },
      { offset_ms: 64800000, slot: 5, instruction: 'Soft scarcity or a clear call to decide — no pressure.' },
      { offset_ms: 86400000, slot: 6, instruction: 'Last graceful check — invite them to message anytime.' },
    ])
  })

  it('decides conversation_kind=real when inboundCount >= 4', async () => {
    mockShouldSeed.mockResolvedValue({ ok: true, inboundCount: 7 })
    const { admin, captured } = makeAdmin()
    await maybeScheduleFollowup(admin as never, {
      threadId: 't2', leadId: 'l2', userId: 'u1', pageId: 'p1',
      lastInboundAt: new Date().toISOString(),
    })
    const ins = captured.find((c) => c.op === 'insert')!
    expect((ins.values as Record<string, unknown>).conversation_kind).toBe('real')
  })

  it('cancels existing schedule but does not insert when gates fail', async () => {
    mockShouldSeed.mockResolvedValue({ ok: false, reason: 'inbound_count_15' })
    const { admin, captured } = makeAdmin()
    await maybeScheduleFollowup(admin as never, {
      threadId: 't3', leadId: 'l3', userId: 'u1', pageId: 'p1',
      lastInboundAt: new Date().toISOString(),
    })
    expect(captured.find((c) => c.op === 'insert')).toBeUndefined()
    expect(captured.find((c) => c.op === 'update')).toBeDefined()
  })

  it('skips insert when master toggle is off (but still cancels)', async () => {
    mockShouldSeed.mockResolvedValue({ ok: true, inboundCount: 1 })
    mockLoadSettings.mockResolvedValue({ ...DEFAULT_FOLLOWUP_SETTINGS, enabled: false })
    const { admin, captured } = makeAdmin()
    await maybeScheduleFollowup(admin as never, {
      threadId: 't4', leadId: 'l4', userId: 'u1', pageId: 'p1',
      lastInboundAt: new Date().toISOString(),
    })
    expect(captured.find((c) => c.op === 'insert')).toBeUndefined()
    expect(captured.find((c) => c.op === 'update')).toBeDefined()
  })

  it('honors per-touchpoint disable: snapshot contains only enabled rows with original slots', async () => {
    mockShouldSeed.mockResolvedValue({ ok: true, inboundCount: 1 })
    const settings = {
      enabled: true,
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t, idx) => ({
        ...t,
        enabled: idx % 2 === 0, // keep slots 0, 2, 4, 6
      })),
    }
    mockLoadSettings.mockResolvedValue(settings)
    const { admin, captured } = makeAdmin()
    const lastInboundAt = new Date('2026-05-17T10:00:00Z').toISOString()
    await maybeScheduleFollowup(admin as never, {
      threadId: 't5', leadId: 'l5', userId: 'u1', pageId: 'p1', lastInboundAt,
    })
    const ins = captured.find((c) => c.op === 'insert')!.values as Record<string, unknown>
    expect(ins.offsets_snapshot).toEqual([
      { offset_ms: 300000,   slot: 0, instruction: 'Quick light hello — just ask if still interested po.' },
      { offset_ms: 18000000, slot: 2, instruction: 'Share one concrete benefit or social proof — keep it short.' },
      { offset_ms: 43200000, slot: 4, instruction: 'Light reminder — emphasize convenience and flexibility.' },
      { offset_ms: 86400000, slot: 6, instruction: 'Last graceful check — invite them to message anytime.' },
    ])
    // next_run_at uses the first enabled offset (slot 0 = 5m).
    expect(ins.next_run_at).toBe(new Date(Date.parse(lastInboundAt) + 300_000).toISOString())
  })

  it('skips insert when master ON but no rows enabled (defensive)', async () => {
    mockShouldSeed.mockResolvedValue({ ok: true, inboundCount: 1 })
    mockLoadSettings.mockResolvedValue({
      enabled: true,
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t) => ({ ...t, enabled: false })),
    })
    const { admin, captured } = makeAdmin()
    await maybeScheduleFollowup(admin as never, {
      threadId: 't6', leadId: 'l6', userId: 'u1', pageId: 'p1',
      lastInboundAt: new Date().toISOString(),
    })
    expect(captured.find((c) => c.op === 'insert')).toBeUndefined()
  })
})
