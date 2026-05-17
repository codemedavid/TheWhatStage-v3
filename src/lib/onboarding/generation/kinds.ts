import 'server-only'
import { generateKnowledge } from '@/lib/onboarding/ai/knowledge'
import { generateFaqs } from '@/lib/onboarding/ai/faqs'
import { generatePersonality } from '@/lib/onboarding/ai/personality'
import { generateFormFields } from '@/lib/onboarding/ai/form-fields'
import { generateBotInstructions } from '@/lib/onboarding/ai/bot-instructions'
import type { BusinessBasics } from '@/lib/onboarding/business-basics'
import type { OnboardingLang } from '@/lib/onboarding/types'
import type { PersonalitySeeds } from '@/lib/onboarding/ai/personality-shared'
import type { ActionPageKind } from '@/lib/action-pages/kinds'
import type { GenerationKind } from './types'

export interface KnowledgeInput { basics: BusinessBasics; lang: OnboardingLang }
export interface FaqsInput { basics: BusinessBasics; lang: OnboardingLang }
export interface PersonalitySeedInput {
  basics: BusinessBasics
  seeds: PersonalitySeeds
  lang: OnboardingLang
}
export interface FormFieldsInput {
  basics: BusinessBasics
  kind: 'form' | 'qualification'
  lang: OnboardingLang
}
export interface BotInstructionsInput {
  basics: BusinessBasics
  goal: ActionPageKind
  actionPage: { title: string; ctaLabel: string; slug: string }
  flowDescription: string
  lang: OnboardingLang
}

interface KindHandler<I> {
  run(input: I): Promise<unknown>
}

export const KINDS: {
  knowledge: KindHandler<KnowledgeInput>
  faqs: KindHandler<FaqsInput>
  personality_seed: KindHandler<PersonalitySeedInput>
  form_fields: KindHandler<FormFieldsInput>
  bot_instructions: KindHandler<BotInstructionsInput>
} = {
  knowledge: { run: ({ basics, lang }) => generateKnowledge({ basics, lang }) },
  faqs: { run: ({ basics, lang }) => generateFaqs({ basics, lang }) },
  personality_seed: {
    run: ({ basics, seeds, lang }) => generatePersonality({ basics, seeds, lang }),
  },
  form_fields: {
    run: ({ basics, kind, lang }) => generateFormFields({ basics, kind, lang }),
  },
  bot_instructions: {
    run: ({ basics, goal, actionPage, flowDescription, lang }) =>
      generateBotInstructions({
        basics,
        goal,
        action_page: { title: actionPage.title, cta_label: actionPage.ctaLabel, slug: actionPage.slug },
        flow_description: flowDescription,
        lang,
      }),
  },
}

export type KindInputMap = {
  knowledge: KnowledgeInput
  faqs: FaqsInput
  personality_seed: PersonalitySeedInput
  form_fields: FormFieldsInput
  bot_instructions: BotInstructionsInput
}

export type KindInput<K extends GenerationKind> = KindInputMap[K]
