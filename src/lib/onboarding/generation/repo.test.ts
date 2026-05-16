import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockFrom = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mockFrom }),
}))

import {
  getJob,
  upsertRunning,
  markDone,
  markFailed,
} from './repo'

function chain(returns: unknown) {
  const obj: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'maybeSingle', 'upsert', 'update', 'is']) {
    obj[m] = vi.fn().mockReturnValue(obj)
  }
  ;(obj as { then?: (cb: (r: unknown) => unknown) => unknown }).then = (cb) => Promise.resolve(cb(returns))
  return obj
}

beforeEach(() => {
  mockFrom.mockReset()
})

describe('getJob', () => {
  it('returns null when no row', async () => {
    const c = chain(null)
    mockFrom.mockReturnValue(c)
    const result = await getJob('p1', 'knowledge')
    expect(result).toBeNull()
    expect(mockFrom).toHaveBeenCalledWith('generation_jobs')
  })
})

describe('upsertRunning', () => {
  it('writes status=running with input_hash and started_at', async () => {
    const c = chain({ data: null, error: null })
    mockFrom.mockReturnValue(c)
    await upsertRunning('p1', 'faqs', 'h123')
    expect(c.upsert).toHaveBeenCalled()
    const payload = (c.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(payload.profile_id).toBe('p1')
    expect(payload.kind).toBe('faqs')
    expect(payload.status).toBe('running')
    expect(payload.input_hash).toBe('h123')
    expect(payload.started_at).toBeDefined()
    expect(payload.result).toBeNull()
    expect(payload.error).toBeNull()
  })
})

describe('markDone', () => {
  it('updates only when input_hash still matches', async () => {
    const c = chain({ data: null, error: null })
    mockFrom.mockReturnValue(c)
    await markDone('p1', 'faqs', 'h123', { ok: true })
    const updateArg = (c.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateArg.status).toBe('done')
    expect(updateArg.result).toEqual({ ok: true })
    expect(updateArg.finished_at).toBeDefined()
    expect(c.eq).toHaveBeenCalledWith('profile_id', 'p1')
    expect(c.eq).toHaveBeenCalledWith('kind', 'faqs')
    expect(c.eq).toHaveBeenCalledWith('input_hash', 'h123')
  })
})

describe('markFailed', () => {
  it('updates with error string and status=failed', async () => {
    const c = chain({ data: null, error: null })
    mockFrom.mockReturnValue(c)
    await markFailed('p1', 'faqs', 'h123', 'boom')
    const updateArg = (c.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateArg.status).toBe('failed')
    expect(updateArg.error).toBe('boom')
  })
})
