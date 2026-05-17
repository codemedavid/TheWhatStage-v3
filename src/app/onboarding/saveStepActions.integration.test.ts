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
  saveCatalogProductsAction,
} from './actions'
import { stepForGenerationKind } from './_components/GenerationGate'

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

describe('saveCatalogProductsAction (B1): links products to the primary action_page', () => {
  it('includes action_page_id in every business_items insert', async () => {
    const businessItems = chain({ data: null, error: null })
    mockFrom.mockReset().mockImplementation(tableRouter({ business_items: businessItems }))

    const state = await import('@/lib/onboarding/state')
    ;(state.getPrimaryActionPage as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'page-uuid-1',
      kind: 'catalog',
      slug: 'shop',
      title: 'Shop',
      config: {},
    })

    await expect(saveCatalogProductsAction(undefined, fd({
      products_json: JSON.stringify([
        { title: 'Ensaymada', price_amount: 50, summary: 'Soft and buttery' },
        { title: 'Pandesal', price_amount: null },
      ]),
    }))).rejects.toThrowError(/NEXT_REDIRECT:\/onboarding\/flow/)

    expect(businessItems.insert).toHaveBeenCalledTimes(1)
    const rows = businessItems.insert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r.action_page_id).toBe('page-uuid-1')
      expect(r.user_id).toBe('u1')
    }
    expect(markStep).toHaveBeenCalledWith('goal_content')
  })

  it('redirects to /onboarding/goal when no primary action_page exists (defensive)', async () => {
    const businessItems = chain({ data: null, error: null })
    mockFrom.mockReset().mockImplementation(tableRouter({ business_items: businessItems }))

    const state = await import('@/lib/onboarding/state')
    ;(state.getPrimaryActionPage as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    await expect(saveCatalogProductsAction(undefined, fd({
      products_json: JSON.stringify([{ title: 'X', price_amount: 1 }]),
    }))).rejects.toThrowError(/NEXT_REDIRECT:\/onboarding\/goal/)

    expect(businessItems.insert).not.toHaveBeenCalled()
  })
})

describe('savePersonalityAction (B2): seeds-based chatbot_configs upsert is enriched', () => {
  it('writes persona/do_rules/dont_rules derived from seeds, not just personality_source', async () => {
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
      vibe_preset: 'hype_closer',
      greet: 'Yo, what is up!',
      must_use: 'Always mention free shipping.',
      must_not: 'Never discuss competitors.',
    }))).rejects.toThrowError(/NEXT_REDIRECT:\/onboarding\/goal/)

    expect(chatbotConfigs.upsert).toHaveBeenCalled()
    const upsertPayload = chatbotConfigs.upsert.mock.calls[0][0] as Record<string, unknown>
    expect(upsertPayload.user_id).toBe('u1')
    expect(upsertPayload.personality_source).toBe('custom')
    expect(typeof upsertPayload.persona).toBe('string')
    expect((upsertPayload.persona as string).toLowerCase()).toContain('closer')
    expect(upsertPayload.do_rules).toEqual(['Always mention free shipping.'])
    expect(upsertPayload.dont_rules).toEqual(['Never discuss competitors.'])
  })
})

describe('stepForGenerationKind (B3): every generation kind maps to its owning step', () => {
  it('maps each kind to the step whose skipStepAction sets the right *_completed_at', () => {
    expect(stepForGenerationKind('knowledge')).toBe('knowledge')
    expect(stepForGenerationKind('faqs')).toBe('faqs')
    expect(stepForGenerationKind('personality_seed')).toBe('personality')
    expect(stepForGenerationKind('form_fields')).toBe('goal_content')
    expect(stepForGenerationKind('bot_instructions')).toBe('flow')
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
