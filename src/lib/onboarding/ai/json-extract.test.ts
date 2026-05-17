import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { extractJson, withJsonRetry } from './json-extract'

describe('extractJson', () => {
  it('parses raw JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('parses ```json ... ``` fenced output', () => {
    const raw = '```json\n{"name":"Nena","items":[1,2]}\n```'
    expect(extractJson(raw)).toEqual({ name: 'Nena', items: [1, 2] })
  })

  it('parses ``` ... ``` (unmarked) fenced output', () => {
    expect(extractJson('```\n{"ok":true}\n```')).toEqual({ ok: true })
  })

  it('strips leading/trailing prose around a JSON object', () => {
    const raw = 'Sure, here you go:\n{"q":"x","a":"y"}\nLet me know if you need more.'
    expect(extractJson(raw)).toEqual({ q: 'x', a: 'y' })
  })

  it('falls back to slicing the largest {...} substring when prose contains braces', () => {
    const raw = 'Reply: {"answer":"42"} -- thanks!'
    expect(extractJson(raw)).toEqual({ answer: '42' })
  })

  it('throws invalid_json when there is no parseable object', () => {
    expect(() => extractJson('totally not json')).toThrowError(/invalid_json/)
  })

  it('throws on a truncated object', () => {
    // brace-slice fallback produces "{" which JSON.parse throws on directly
    expect(() => extractJson('{"a":1')).toThrow()
  })
})

describe('withJsonRetry', () => {
  it('returns the first-call result when it succeeds', async () => {
    const fn = vi.fn(async () => 'ok')
    await expect(withJsonRetry(fn)).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries once on invalid_json and returns the retry value', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('invalid_json'))
      .mockResolvedValueOnce('recovered')
    await expect(withJsonRetry(fn)).resolves.toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries once on schema_mismatch and returns the retry value', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('schema_mismatch: missing field'))
      .mockResolvedValueOnce({ ok: true })
    await expect(withJsonRetry(fn)).resolves.toEqual({ ok: true })
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries once on llm_call transport errors', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('generation_failed: llm_call'))
      .mockResolvedValueOnce('recovered')
    await expect(withJsonRetry(fn)).resolves.toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries on rate_limit', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('rate_limit exceeded'))
      .mockResolvedValueOnce('recovered')
    await expect(withJsonRetry(fn)).resolves.toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('rethrows when all attempts fail', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('invalid_json'))
      .mockRejectedValueOnce(new Error('invalid_json'))
      .mockRejectedValueOnce(new Error('invalid_json'))
    await expect(withJsonRetry(fn)).rejects.toThrowError(/invalid_json/)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('recovers on the third attempt', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('invalid_json'))
      .mockRejectedValueOnce(new Error('schema_mismatch'))
      .mockResolvedValueOnce('recovered')
    await expect(withJsonRetry(fn)).resolves.toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('does not retry on unrelated errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('something_else'))
    await expect(withJsonRetry(fn)).rejects.toThrowError(/something_else/)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does not retry on non-Error throws', async () => {
    const fn = vi.fn().mockRejectedValue('a string')
    await expect(withJsonRetry(fn)).rejects.toBe('a string')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
