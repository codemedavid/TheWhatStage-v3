import { describe, it, expect, vi, beforeEach } from 'vitest'

// after() runs deferred work; for tests, invoke the callback synchronously so we
// can assert the write happened. recordUsage swallows its own errors.
vi.mock('next/server', () => ({ after: (fn: () => unknown) => { void fn() } }))
const captureMessage = vi.fn()
vi.mock('@sentry/nextjs', () => ({ captureMessage: (...a: unknown[]) => captureMessage(...a) }))

import { recordUsage, recordUsageDeferred } from './recordUsage'

const DEEPSEEK = 'deepseek/deepseek-v4-flash'

function makeSupabase() {
  const upsert = vi.fn().mockResolvedValue({ error: null })
  const from = vi.fn(() => ({ upsert }))
  return { client: { from } as never, upsert, from }
}

const usage = {
  promptTokens: 1000,
  cachedPromptTokens: 200,
  cacheMissPromptTokens: 800,
  completionTokens: 50,
  totalTokens: 1050,
}

describe('recordUsage', () => {
  beforeEach(() => captureMessage.mockClear())

  it('builds a scoped idempotency event_key and upserts ignoring duplicates', async () => {
    const { client, upsert } = makeSupabase()
    await recordUsage(client, 'user-1', 'chatbot.answer', { model: DEEPSEEK, usage }, 'thread-1', 'msg-42')

    expect(upsert).toHaveBeenCalledTimes(1)
    const [row, opts] = upsert.mock.calls[0]
    expect(row).toMatchObject({
      user_id: 'user-1',
      scope: 'chatbot.answer',
      model: DEEPSEEK,
      thread_id: 'thread-1',
      event_key: 'msg-42:chatbot.answer',
      priced: true,
    })
    expect(opts).toEqual({ onConflict: 'event_key', ignoreDuplicates: true })
  })

  it('keeps event_key null (always-insert) when no idempotency key is given', async () => {
    const { client, upsert } = makeSupabase()
    await recordUsage(client, 'user-1', 'chatbot.answer', { model: DEEPSEEK, usage })
    expect(upsert.mock.calls[0][0].event_key).toBeNull()
  })

  it('distinct scopes from the same turn yield distinct event_keys (no false dedup)', async () => {
    const { client, upsert } = makeSupabase()
    await recordUsage(client, 'u', 'chatbot.classify', { model: DEEPSEEK, usage }, null, 'msg-7')
    await recordUsage(client, 'u', 'chatbot.answer.fallback', { model: DEEPSEEK, usage }, null, 'msg-7')
    expect(upsert.mock.calls[0][0].event_key).toBe('msg-7:chatbot.classify')
    expect(upsert.mock.calls[1][0].event_key).toBe('msg-7:chatbot.answer.fallback')
  })

  it('flags priced=false and alerts once for an unpriced model', async () => {
    const { client, upsert } = makeSupabase()
    await recordUsage(client, 'u', 'chatbot.answer', { model: 'mystery/model-xyz', usage }, null, 'k1')
    await recordUsage(client, 'u', 'chatbot.answer', { model: 'mystery/model-xyz', usage }, null, 'k2')
    expect(upsert.mock.calls[0][0].priced).toBe(false)
    expect(upsert.mock.calls[0][0].cost_micros).toBe(0)
    // Deduped: only the first unpriced sighting alerts.
    expect(captureMessage).toHaveBeenCalledTimes(1)
  })

  it('prefers the provider-reported usage.cost over the estimated price map', async () => {
    const { client, upsert } = makeSupabase()
    // $0.000089 reported by the provider — must win over costMicros() estimate.
    await recordUsage(
      client,
      'u',
      'chatbot.classify',
      { model: DEEPSEEK, usage: { ...usage, costUsd: 0.000089 } },
      null,
      'k',
    )
    expect(upsert.mock.calls[0][0].cost_micros).toBe(89) // round(0.000089 * 1e6)
    expect(upsert.mock.calls[0][0].priced).toBe(true)
  })

  it('treats a row with a provider cost as priced even for an unmapped model (no alert)', async () => {
    const { client, upsert } = makeSupabase()
    await recordUsage(
      client,
      'u',
      'chatbot.answer',
      { model: 'mystery/model-xyz', usage: { ...usage, costUsd: 0.0005 } },
      null,
      'k',
    )
    expect(upsert.mock.calls[0][0].cost_micros).toBe(500)
    expect(upsert.mock.calls[0][0].priced).toBe(true)
    expect(captureMessage).not.toHaveBeenCalled()
  })

  it('skips entirely when the provider reported no usage', async () => {
    const { client, upsert } = makeSupabase()
    await recordUsage(client, 'u', 'chatbot.answer', { model: DEEPSEEK, usage: null }, null, 'k')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('never throws when the insert fails', async () => {
    const upsert = vi.fn().mockRejectedValue(new Error('db down'))
    const client = { from: vi.fn(() => ({ upsert })) } as never
    await expect(
      recordUsage(client, 'u', 'chatbot.answer', { model: DEEPSEEK, usage }, null, 'k'),
    ).resolves.toBeUndefined()
  })
})

describe('recordUsageDeferred', () => {
  it('defers the write but still records it', async () => {
    const { client, upsert } = makeSupabase()
    recordUsageDeferred(client, 'u', 'chatbot.answer', { model: DEEPSEEK, usage }, 't', 'k')
    await Promise.resolve() // flush the deferred microtask
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0][0].event_key).toBe('k:chatbot.answer')
  })
})
