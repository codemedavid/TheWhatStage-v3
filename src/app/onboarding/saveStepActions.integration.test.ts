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
vi.mock('@/lib/onboarding/generation/repo', () => ({ getJob: vi.fn(), clearJob: vi.fn() }))
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

import {
  saveKnowledgeAction,
  saveFaqsAction,
  savePersonalityAction,
  saveSalesContentAction,
} from './actions'

const goodBasics = {
  name: 'Aling Nena Bakery',
  offer: 'Fresh ensaymada delivered daily',
  business_type: 'ecom',
  audience: 'Tita moms in QC',
  pain: "They want merienda but can't bake",
  tone: 'friendly',
}

function fd(values: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(values)) f.set(k, v)
  return f
}

beforeEach(() => {
  redirectMock.mockClear()
  markStep.mockReset().mockResolvedValue(undefined)
  getUser.mockReset().mockResolvedValue(authUser('u1'))
})

describe('saveKnowledgeAction routes through markStep RPC', () => {
  it('inserts the knowledge_document and calls markStep("knowledge") instead of manual audit append', async () => {
    const onboardingState = chain({ data: { business_basics: goodBasics }, error: null })
    const knowledgeDocs = chain({ data: null, error: null })

    mockFrom.mockReset().mockImplementation(tableRouter({
      onboarding_state: onboardingState,
      knowledge_documents: knowledgeDocs,
    }))

    const formData = fd({
      sections_json: JSON.stringify([{ title: 'About us', body: 'We bake stuff.' }]),
    })

    await expect(saveKnowledgeAction(undefined, formData))
      .rejects.toThrowError(/NEXT_REDIRECT:\/onboarding\/faqs/)

    // Critical: no UPDATE against onboarding_state — the RPC handles it.
    expect(onboardingState.update).not.toHaveBeenCalled()
    expect(knowledgeDocs.insert).toHaveBeenCalledTimes(1)
    expect(markStep).toHaveBeenCalledWith('knowledge')
  })
})

describe('saveFaqsAction routes through markStep RPC', () => {
  it('calls markStep("faqs") and does not manually update onboarding_state', async () => {
    const onboardingState = chain({ data: { ai_generations: [] }, error: null })
    const knowledgeFaqs = chain({ data: null, error: null })

    mockFrom.mockReset().mockImplementation(tableRouter({
      onboarding_state: onboardingState,
      knowledge_faqs: knowledgeFaqs,
    }))

    const formData = fd({
      items_json: JSON.stringify([{ question: 'Q1?', answer: 'A1.' }]),
    })

    await expect(saveFaqsAction(undefined, formData))
      .rejects.toThrowError(/NEXT_REDIRECT:\/onboarding\/personality/)

    expect(onboardingState.update).not.toHaveBeenCalled()
    expect(markStep).toHaveBeenCalledWith('faqs')
  })

  it('still calls markStep even when items list is empty', async () => {
    const onboardingState = chain({ data: { ai_generations: [] }, error: null })
    const knowledgeFaqs = chain({ data: null, error: null })

    mockFrom.mockReset().mockImplementation(tableRouter({
      onboarding_state: onboardingState,
      knowledge_faqs: knowledgeFaqs,
    }))

    await expect(saveFaqsAction(undefined, fd({ items_json: '[]' })))
      .rejects.toThrowError(/NEXT_REDIRECT/)

    expect(knowledgeFaqs.insert).not.toHaveBeenCalled()
    expect(markStep).toHaveBeenCalledWith('faqs')
  })
})

describe('savePersonalityAction routes through markStep RPC', () => {
  it('persists personality_seeds via update, then calls markStep("personality") — no manual audit append', async () => {
    const onboardingState = chain({
      data: { business_basics: goodBasics, ui_language: 'tl' },
      error: null,
    })
    const chatbotConfigs = chain({ data: null, error: null })

    mockFrom.mockReset().mockImplementation(tableRouter({
      onboarding_state: onboardingState,
      chatbot_configs: chatbotConfigs,
    }))

    await expect(savePersonalityAction(undefined, fd({
      vibe_preset: 'friendly_kuya_ate',
      greet: 'Hi there!',
    }))).rejects.toThrowError(/NEXT_REDIRECT:\/onboarding\/goal/)

    // We DO update onboarding_state but only with personality_seeds —
    // no personality_completed_at, no ai_generations rewrite.
    const updateCalls = onboardingState.update.mock.calls
    expect(updateCalls.length).toBe(1)
    const payload = updateCalls[0][0] as Record<string, unknown>
    expect(payload).toHaveProperty('personality_seeds')
    expect(payload).not.toHaveProperty('personality_completed_at')
    expect(payload).not.toHaveProperty('ai_generations')

    expect(markStep).toHaveBeenCalledWith('personality')
  })
})

describe('saveSalesContentAction (Fix 2): does NOT publish the page', () => {
  it('updates config without flipping status to published', async () => {
    const actionPages = chain({ data: { config: {} }, error: null })
    mockFrom.mockReset().mockImplementation(tableRouter({ action_pages: actionPages }))

    await expect(saveSalesContentAction(undefined, fd({
      page_id: '12345678-1234-4123-8456-123456789abc',
      name: 'My product',
      headline: 'Cool thing',
      description: 'Does cool stuff.',
      price_amount: '100',
    }))).rejects.toThrowError(/NEXT_REDIRECT:\/onboarding\/flow/)

    // First update call is the only update — it must NOT include status.
    const updateCalls = actionPages.update.mock.calls
    expect(updateCalls.length).toBe(1)
    const payload = updateCalls[0][0] as Record<string, unknown>
    expect(payload).toHaveProperty('config')
    expect(payload).not.toHaveProperty('status')
    expect(markStep).toHaveBeenCalledWith('goal_content')
  })
})
