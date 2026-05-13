import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadPrimaryGoalInstruction } from './primary-goal'

function mockClient(
  configRow: { primary_action_page_id: string | null } | null,
  pageRow: {
    title: string
    slug: string
    bot_send_instructions: string | null
    status: string
  } | null,
) {
  const from = vi.fn((table: string) => {
    if (table === 'chatbot_configs') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: configRow, error: null }),
          }),
        }),
      }
    }
    if (table === 'action_pages') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: pageRow, error: null }),
            }),
          }),
        }),
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
  return { from } as unknown as Parameters<typeof loadPrimaryGoalInstruction>[0]
}

describe('loadPrimaryGoalInstruction', () => {
  const userId = 'user-1'
  const origEnv = process.env.NEXT_PUBLIC_APP_URL

  beforeAll(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
  })
  afterAll(() => {
    process.env.NEXT_PUBLIC_APP_URL = origEnv
  })

  it('returns null when no config row', async () => {
    const c = mockClient(null, null)
    expect(await loadPrimaryGoalInstruction(c, userId)).toBeNull()
  })

  it('returns null when primary_action_page_id is null', async () => {
    const c = mockClient({ primary_action_page_id: null }, null)
    expect(await loadPrimaryGoalInstruction(c, userId)).toBeNull()
  })

  it('returns null when page is not published', async () => {
    const c = mockClient(
      { primary_action_page_id: 'page-1' },
      null, // query filtered by status='published' returns null for draft/archived
    )
    expect(await loadPrimaryGoalInstruction(c, userId)).toBeNull()
  })

  it('returns formatted block when page is published and has instructions', async () => {
    const c = mockClient(
      { primary_action_page_id: 'page-1' },
      {
        title: 'Book a demo',
        slug: 'demo',
        bot_send_instructions: 'Offer when curiosity is high.',
        status: 'published',
      },
    )
    const out = await loadPrimaryGoalInstruction(c, userId)
    expect(out).toContain('Book a demo')
    expect(out).toContain('https://app.example.com/a/demo')
    expect(out).toContain('Offer when curiosity is high.')
    expect(out).toMatch(/Do not force/i)
  })

  it('omits the instructions line when bot_send_instructions is empty', async () => {
    const c = mockClient(
      { primary_action_page_id: 'page-1' },
      {
        title: 'Book a demo',
        slug: 'demo',
        bot_send_instructions: null,
        status: 'published',
      },
    )
    const out = await loadPrimaryGoalInstruction(c, userId)
    expect(out).not.toContain('When to send / what to say')
    expect(out).toContain('Book a demo')
  })
})
