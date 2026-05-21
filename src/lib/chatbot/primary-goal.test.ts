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
    // URL must NOT leak into the prompt — the bot routes via action_page id,
    // not by pasting links into the reply.
    expect(out).not.toContain('https://app.example.com/a/demo')
    expect(out).not.toContain('/a/demo')
    expect(out).toContain('Offer when curiosity is high.')
    expect(out).toMatch(/action_page\.action_page_id/)
    expect(out).toMatch(/do not force/i)
  })

  it('omits the trigger line when bot_send_instructions is empty', async () => {
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
    expect(out).not.toMatch(/matches this trigger/i)
    expect(out).toContain('Book a demo')
  })

  it('includes the ONCE QUALIFIED instruction when bot_send_instructions is set', async () => {
    const c = mockClient(
      { primary_action_page_id: 'page-1' },
      {
        title: 'Booking',
        slug: 'book',
        bot_send_instructions: 'Ask budget first.',
        status: 'published',
      },
    )
    const out = await loadPrimaryGoalInstruction(c, 'user-1')
    expect(out).toContain('Once every prerequisite above has been answered')
    expect(out).toContain('you MUST set `action_page.action_page_id`')
    expect(out).toContain('Do not stall')
  })

  it('does NOT include the ONCE QUALIFIED instruction when bot_send_instructions is empty', async () => {
    const c = mockClient(
      { primary_action_page_id: 'page-1' },
      { title: 'Booking', slug: 'book', bot_send_instructions: '', status: 'published' },
    )
    const out = await loadPrimaryGoalInstruction(c, 'user-1')
    expect(out).not.toContain('Once every prerequisite above has been answered')
  })
})
