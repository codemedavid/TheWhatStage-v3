import { describe, expect, it, vi, beforeEach } from 'vitest'
import { chain, tableRouter, authUser } from '@/lib/onboarding/__test-helpers__/supabase-mock'

vi.mock('server-only', () => ({}))

const redirectMock = vi.hoisted(() => vi.fn((url: string) => {
  const err = new Error(`NEXT_REDIRECT:${url}`) as Error & { digest: string }
  err.digest = `NEXT_REDIRECT;${url}`
  throw err
}))
vi.mock('next/navigation', () => ({ redirect: redirectMock }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: vi.fn(async (cb: () => unknown) => { await cb() }) }))
vi.mock('@/lib/onboarding/generation/runner', () => ({ runGeneration: vi.fn(async () => {}) }))
vi.mock('@/lib/onboarding/generation/repo', () => ({ getJob: vi.fn() }))
vi.mock('@/lib/rag', () => ({ HfRouterLlm: vi.fn() }))

const markStep = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/onboarding/state', () => ({
  markStep,
  ensureOnboardingState: vi.fn(async () => {}),
  saveBusinessBasicsToState: vi.fn(),
  setOnboardingLanguage: vi.fn(),
  completeOnboarding: vi.fn(),
  dismissOnboarding: vi.fn(),
  getBusinessBasics: vi.fn(),
  getPrimaryActionPage: vi.fn(),
  getOnboardingState: vi.fn(),
  initOnboardingForProfile: vi.fn(),
}))

const getUser = vi.hoisted(() => vi.fn())
const mockFrom = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser }, from: mockFrom }),
  getAuthUser: async () => (await getUser()).data.user,
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: mockFrom }) }))

import { saveFlowAction } from './actions'

// Zod v4's UUID regex enforces version 1-8 in the third group; a fully zero
// UUID is allowed as a special nil-uuid case, but other all-zero variants are
// rejected. Use a valid v4 UUID for the page id.
const PAGE_ID = '12345678-1234-4123-8456-123456789abc'

let actionPages: ReturnType<typeof chain>
let chatbotConfigs: ReturnType<typeof chain>

beforeEach(() => {
  redirectMock.mockClear()
  markStep.mockReset().mockResolvedValue(undefined)
  getUser.mockReset().mockResolvedValue(authUser('u1'))

  actionPages = chain({ data: { slug: 'my-page', title: 'My Page' }, error: null })
  chatbotConfigs = chain({ data: { recommendation_rules: null, instructions: '' }, error: null })

  mockFrom.mockReset().mockImplementation(tableRouter({
    action_pages: actionPages,
    chatbot_configs: chatbotConfigs,
  }))
})

function fd(values: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(values)) f.set(k, v)
  return f
}

describe('saveFlowAction', () => {
  it('updates action_pages.bot_send_instructions scoped to user_id, upserts chatbot_configs, marks flow, redirects to /done', async () => {
    await expect(saveFlowAction(undefined, fd({
      page_id: PAGE_ID,
      bot_send_instructions: 'Greet warmly, then guide to the form.',
      recommendation_rules: 'Recommend booking if user mentions schedule.',
      required_slots_json: JSON.stringify(['name', 'phone']),
      confidence_threshold: '0.7',
    }))).rejects.toThrowError(/NEXT_REDIRECT:\/onboarding\/done/)

    const apUpdate = actionPages.update.mock.calls[0][0]
    expect(apUpdate).toEqual({ bot_send_instructions: 'Greet warmly, then guide to the form.' })
    expect(actionPages.eq).toHaveBeenCalledWith('id', PAGE_ID)
    expect(actionPages.eq).toHaveBeenCalledWith('user_id', 'u1')

    const cfgUpsert = chatbotConfigs.upsert.mock.calls[0][0]
    expect(cfgUpsert.user_id).toBe('u1')
    // Canonical snake_case shape — must match what parseRecommendationRules reads.
    expect(cfgUpsert.recommendation_rules.per_action_page[PAGE_ID]).toEqual({
      rules: 'Recommend booking if user mentions schedule.',
      required_slots: ['name', 'phone'],
      confidence_threshold: 0.7,
    })
    expect(cfgUpsert.recommendation_rules.default_confidence_threshold).toBe(0.55)

    expect(markStep).toHaveBeenCalledWith('flow')
    expect(redirectMock).toHaveBeenCalledWith('/onboarding/done')
  })

  it('preserves existing perActionPage entries instead of overwriting them', async () => {
    chatbotConfigs = chain({
      data: {
        recommendation_rules: {
          defaultConfidenceThreshold: 0.6,
          perActionPage: { 'other-page-id': { rules: 'keep me', requiredSlots: [], confidenceThreshold: 0.5 } },
        },
        instructions: '',
      },
      error: null,
    })
    mockFrom.mockImplementation(tableRouter({ action_pages: actionPages, chatbot_configs: chatbotConfigs }))

    await expect(saveFlowAction(undefined, fd({
      page_id: PAGE_ID,
      bot_send_instructions: 'Ten chars +',
      recommendation_rules: 'Ten chars +',
      required_slots_json: '[]',
      confidence_threshold: '0.55',
    }))).rejects.toThrowError(/NEXT_REDIRECT/)

    // Existing row is legacy camelCase; the writer reads either casing, preserves
    // the prior entry verbatim, and writes back the canonical snake_case shape.
    const next = chatbotConfigs.upsert.mock.calls[0][0].recommendation_rules
    expect(next.default_confidence_threshold).toBe(0.6)
    expect(next.per_action_page['other-page-id']).toEqual({ rules: 'keep me', requiredSlots: [], confidenceThreshold: 0.5 })
    expect(next.per_action_page[PAGE_ID]).toBeDefined()
  })

  it('returns save_failed when bot_send_instructions is too short', async () => {
    const res = await saveFlowAction(undefined, fd({
      page_id: PAGE_ID,
      bot_send_instructions: 'short',
      recommendation_rules: 'Ten chars +',
      required_slots_json: '[]',
      confidence_threshold: '0.55',
    }))
    expect(res.error).toBe('save_failed')
    expect(markStep).not.toHaveBeenCalled()
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it('NEGATIVE: still accepts an empty required_slots_json (documents missing min-1 rule)', async () => {
    await expect(saveFlowAction(undefined, fd({
      page_id: PAGE_ID,
      bot_send_instructions: 'Ten chars +',
      recommendation_rules: 'Ten chars +',
      required_slots_json: '[]',
      confidence_threshold: '0.55',
    }))).rejects.toThrowError(/NEXT_REDIRECT:\/onboarding\/done/)
  })

  it('returns save_failed and does not mark step when action_pages update errors', async () => {
    actionPages = chain({ data: null, error: { message: 'rls denied' } })
    mockFrom.mockImplementation(tableRouter({ action_pages: actionPages, chatbot_configs: chatbotConfigs }))
    const res = await saveFlowAction(undefined, fd({
      page_id: PAGE_ID,
      bot_send_instructions: 'Ten chars +',
      recommendation_rules: 'Ten chars +',
      required_slots_json: '[]',
      confidence_threshold: '0.55',
    }))
    expect(res.error).toBe('save_failed')
    expect(markStep).not.toHaveBeenCalled()
  })
})
