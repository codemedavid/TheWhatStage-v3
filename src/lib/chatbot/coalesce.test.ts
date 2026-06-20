import { describe, it, expect } from 'vitest'
import { coalesceInbound, MAX_COALESCED_MESSAGES, type CoalesceRow } from './coalesce'

function row(id: string, body: string | null, createdAt: string): CoalesceRow {
  return { id, body, created_at: createdAt }
}

describe('coalesceInbound', () => {
  it('returns empty result for no rows', () => {
    const result = coalesceInbound([])
    expect(result.combinedText).toBe('')
    expect(result.messageIds).toEqual([])
  })

  it('returns a single message unchanged', () => {
    const result = coalesceInbound([row('a', 'magkano po?', '2026-06-20T10:00:00Z')])
    expect(result.combinedText).toBe('magkano po?')
    expect(result.messageIds).toEqual(['a'])
  })

  it('joins multiple messages with newlines in created_at order', () => {
    const result = coalesceInbound([
      row('a', 'hello po', '2026-06-20T10:00:00Z'),
      row('b', 'interested ako', '2026-06-20T10:00:01Z'),
      row('c', 'magkano?', '2026-06-20T10:00:02Z'),
    ])
    expect(result.combinedText).toBe('hello po\ninterested ako\nmagkano?')
    expect(result.messageIds).toEqual(['a', 'b', 'c'])
  })

  it('sorts out-of-order rows by created_at ascending', () => {
    const result = coalesceInbound([
      row('c', 'magkano?', '2026-06-20T10:00:02Z'),
      row('a', 'hello po', '2026-06-20T10:00:00Z'),
      row('b', 'interested ako', '2026-06-20T10:00:01Z'),
    ])
    expect(result.combinedText).toBe('hello po\ninterested ako\nmagkano?')
    expect(result.messageIds).toEqual(['a', 'b', 'c'])
  })

  it('breaks created_at ties by id for deterministic ordering', () => {
    const result = coalesceInbound([
      row('b', 'second', '2026-06-20T10:00:00Z'),
      row('a', 'first', '2026-06-20T10:00:00Z'),
    ])
    expect(result.combinedText).toBe('first\nsecond')
    expect(result.messageIds).toEqual(['a', 'b'])
  })

  it('excludes empty and whitespace-only bodies from the combined text', () => {
    const result = coalesceInbound([
      row('a', 'hello', '2026-06-20T10:00:00Z'),
      row('b', '   ', '2026-06-20T10:00:01Z'),
      row('c', '', '2026-06-20T10:00:02Z'),
      row('d', 'world', '2026-06-20T10:00:03Z'),
    ])
    expect(result.combinedText).toBe('hello\nworld')
  })

  it('treats a null body as empty', () => {
    const result = coalesceInbound([
      row('a', 'hello', '2026-06-20T10:00:00Z'),
      row('b', null, '2026-06-20T10:00:01Z'),
    ])
    expect(result.combinedText).toBe('hello')
  })

  it('trims surrounding whitespace from each body', () => {
    const result = coalesceInbound([
      row('a', '  hello  ', '2026-06-20T10:00:00Z'),
      row('b', '\nworld\n', '2026-06-20T10:00:01Z'),
    ])
    expect(result.combinedText).toBe('hello\nworld')
  })

  it('keeps only the most recent messages when over the count cap', () => {
    const rows: CoalesceRow[] = []
    for (let i = 0; i < MAX_COALESCED_MESSAGES + 3; i++) {
      const n = String(i).padStart(2, '0')
      rows.push(row(`id-${n}`, `msg ${n}`, `2026-06-20T10:00:${n}Z`))
    }
    const result = coalesceInbound(rows)
    expect(result.messageIds).toHaveLength(MAX_COALESCED_MESSAGES)
    // The earliest 3 are dropped; the most recent window is kept.
    expect(result.messageIds[0]).toBe('id-03')
    expect(result.messageIds.at(-1)).toBe(`id-${String(MAX_COALESCED_MESSAGES + 2).padStart(2, '0')}`)
    expect(result.combinedText.startsWith('msg 03')).toBe(true)
  })
})
