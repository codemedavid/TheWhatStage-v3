import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest'

beforeAll(() => {
  process.env.FB_APP_SECRET = 'test-secret'
})

afterEach(() => {
  vi.useRealTimers()
})

describe('facebook/state', () => {
  it('round-trips sign/verify for the same userId', async () => {
    const { signState, verifyState } = await import('./state')
    const raw = signState('user-123')
    expect(verifyState(raw, 'user-123')).toBe(true)
  })

  it('rejects a different userId', async () => {
    const { signState, verifyState } = await import('./state')
    const raw = signState('user-123')
    expect(verifyState(raw, 'someone-else')).toBe(false)
  })

  it('rejects a tampered signature', async () => {
    const { signState, verifyState } = await import('./state')
    const raw = signState('user-123')
    const tampered = raw.slice(0, -2) + 'aa'
    expect(verifyState(tampered, 'user-123')).toBe(false)
  })

  it('rejects state older than 10 minutes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-29T00:00:00Z'))
    const { signState, verifyState } = await import('./state')
    const raw = signState('user-123')
    vi.setSystemTime(new Date('2026-04-29T00:11:00Z'))
    expect(verifyState(raw, 'user-123')).toBe(false)
  })
})
