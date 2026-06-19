import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { inboundPreview, bumpThreadOnInbound } from './inbound-counters'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('inboundPreview', () => {
  it('passes short text through unchanged', () => {
    expect(inboundPreview('hello there')).toBe('hello there')
  })

  it('truncates to 200 characters', () => {
    const long = 'x'.repeat(500)
    expect(inboundPreview(long)).toHaveLength(200)
  })

  it('falls back to an attachment marker for empty text', () => {
    expect(inboundPreview('')).toBe('[attachment]')
  })
})

describe('bumpThreadOnInbound', () => {
  function fakeAdmin(result: { error: unknown }) {
    const rpc = vi.fn().mockResolvedValue(result)
    return { admin: { rpc } as unknown as SupabaseClient, rpc }
  }

  it('calls the increment RPC with the thread id and computed preview', async () => {
    const { admin, rpc } = fakeAdmin({ error: null })
    await bumpThreadOnInbound(admin, 'thread-1', 'hi there')
    expect(rpc).toHaveBeenCalledWith('increment_thread_counters', {
      p_thread_id: 'thread-1',
      p_preview: 'hi there',
    })
  })

  it('does not throw when the RPC returns an error (best-effort), and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { admin } = fakeAdmin({ error: { message: 'boom' } })
    await expect(bumpThreadOnInbound(admin, 'thread-2', 'x')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
  })
})
