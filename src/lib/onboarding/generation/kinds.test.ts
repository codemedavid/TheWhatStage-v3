import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/onboarding/ai/knowledge', () => ({
  generateKnowledge: vi.fn(async () => ({ sections: [{ title: 't', body: 'b' }] })),
}))
vi.mock('@/lib/onboarding/ai/faqs', () => ({
  generateFaqs: vi.fn(async () => ({ suggestions: [] })),
}))
vi.mock('@/lib/onboarding/ai/personality', () => ({
  generatePersonality: vi.fn(async () => ({
    name: 'Bot', persona: 'helpful', do_rules: ['a', 'b'], dont_rules: ['c', 'd'],
    fallback_message: 'sorry',
  })),
  VIBE_PRESETS: ['friendly_kuya_ate', 'professional_consultant'],
}))
vi.mock('@/lib/onboarding/ai/form-fields', () => ({
  generateFormFields: vi.fn(async () => ({ blocks: [] })),
}))
vi.mock('@/lib/onboarding/ai/bot-instructions', () => ({
  generateBotInstructions: vi.fn(async () => ({ instructions: 'ok' })),
}))

import { KINDS } from './kinds'

const basics = {
  name: 'X', offer: 'Y', business_type: 'service' as const,
  audience: 'a', pain: 'p', tone: 'friendly' as const,
}

describe('KINDS registry', () => {
  it('has one entry per generation kind', () => {
    expect(Object.keys(KINDS).sort()).toEqual(
      ['bot_instructions', 'faqs', 'form_fields', 'knowledge', 'personality_seed'].sort(),
    )
  })

  it('knowledge.run forwards basics + lang', async () => {
    const out = await KINDS.knowledge.run({ basics, lang: 'tl' })
    expect(out).toEqual({ sections: [{ title: 't', body: 'b' }] })
  })

  it('faqs.run forwards basics + lang', async () => {
    await KINDS.faqs.run({ basics, lang: 'en' })
  })

  it('personality_seed.run forwards basics + seeds + lang', async () => {
    await KINDS.personality_seed.run({
      basics,
      seeds: { vibe_preset: 'friendly_kuya_ate' },
      lang: 'tl',
    })
  })

  it('form_fields.run forwards kind', async () => {
    await KINDS.form_fields.run({ basics, kind: 'form', lang: 'tl' })
  })

  it('bot_instructions.run translates camelCase props to snake_case', async () => {
    const { generateBotInstructions } = await import('@/lib/onboarding/ai/bot-instructions')
    await KINDS.bot_instructions.run({
      basics,
      goal: 'form',
      actionPage: { title: 'My page', ctaLabel: 'Book', slug: 'my-page' },
      flowDescription: 'Greet then ask name',
      lang: 'tl',
    })
    expect(generateBotInstructions).toHaveBeenCalledWith({
      basics,
      goal: 'form',
      action_page: { title: 'My page', cta_label: 'Book', slug: 'my-page' },
      flow_description: 'Greet then ask name',
      lang: 'tl',
    })
  })
})
