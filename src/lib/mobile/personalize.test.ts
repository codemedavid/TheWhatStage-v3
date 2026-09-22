import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { personalizeForLead } from './personalize'

/** Minimal admin-client stub: one leads row behind .select().eq().eq().maybeSingle(). */
function adminStub(lead: { name: string | null } | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: lead })
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }),
  }))
  return { client: { from } as unknown as SupabaseClient, from, maybeSingle }
}

describe('personalizeForLead', () => {
  it('substitutes name tags with the lead name', async () => {
    const { client } = adminStub({ name: 'Juan Dela Cruz' })

    const out = await personalizeForLead(client, 'u1', 'lead-1', 'Hi [first_name], ready?')

    expect(out).toBe('Hi Juan, ready?')
  })

  it('skips the lead read when the text has no tags', async () => {
    const { client, from } = adminStub({ name: 'Juan' })

    const out = await personalizeForLead(client, 'u1', 'lead-1', 'Plain reply')

    expect(out).toBe('Plain reply')
    expect(from).not.toHaveBeenCalled()
  })

  it('falls back to a readable greeting when the lead has no name', async () => {
    const { client } = adminStub({ name: null })

    const out = await personalizeForLead(client, 'u1', 'lead-1', 'Hi [first_name]!')

    expect(out).toBe('Hi there!')
  })

  it('never leaves a literal tag when the lead row is missing', async () => {
    const { client } = adminStub(null)

    const out = await personalizeForLead(client, 'u1', 'gone', 'Hi [name], welcome')

    expect(out).toBe('Hi there, welcome')
  })

  it('leaves bracketed prose that is not a name tag alone', async () => {
    const { client } = adminStub({ name: 'Juan' })

    const out = await personalizeForLead(client, 'u1', 'lead-1', 'Ask about [budget]')

    expect(out).toBe('Ask about [budget]')
  })
})
