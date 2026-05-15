'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import {
  completeOnboarding as completeOnboardingState,
  dismissOnboarding as dismissOnboardingState,
  markStep,
  setOnboardingLanguage,
  saveBusinessBasicsToState,
  getBusinessBasics,
} from '@/lib/onboarding/state'
import { BusinessBasicsSchema } from '@/lib/onboarding/business-basics'
import { LANG_COOKIE } from '@/lib/onboarding/i18n'
import { ONBOARDING_STEPS, type OnboardingLang, type OnboardingStep } from '@/lib/onboarding/types'
import { nextStepRoute } from '@/lib/onboarding/steps'
import { generateKnowledge, type GeneratedKnowledge } from '@/lib/onboarding/ai/knowledge'
import { generateFaqs, type GeneratedFaqs } from '@/lib/onboarding/ai/faqs'
import { generatePersonality, VIBE_PRESETS, type VibePreset } from '@/lib/onboarding/ai/personality'

function isStep(value: unknown): value is OnboardingStep {
  return typeof value === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(value)
}

export async function setLangAction(formData: FormData): Promise<void> {
  const raw = formData.get('lang')
  const lang: OnboardingLang = raw === 'en' ? 'en' : 'tl'
  const jar = await cookies()
  jar.set(LANG_COOKIE, lang, { path: '/', maxAge: 60 * 60 * 24 * 365 })
  await setOnboardingLanguage(lang, 'both')
  revalidatePath('/onboarding')
  revalidatePath('/dashboard')
}

export async function skipStepAction(formData: FormData): Promise<void> {
  const step = formData.get('step')
  if (!isStep(step)) throw new Error('invalid step')
  await markStep(step, { skipped: true })
  redirect(nextStepRoute(step))
}

export async function dismissOnboardingAction(): Promise<void> {
  await dismissOnboardingState()
  redirect('/dashboard')
}

export async function completeOnboardingAction(): Promise<void> {
  await completeOnboardingState()
  redirect('/dashboard')
}

export type BusinessBasicsFormState = {
  fieldErrors?: Record<string, string>
  formError?: string
}

export async function saveBusinessBasicsAction(
  _prev: BusinessBasicsFormState,
  formData: FormData,
): Promise<BusinessBasicsFormState> {
  const parsed = BusinessBasicsSchema.safeParse({
    name: formData.get('name'),
    offer: formData.get('offer'),
    business_type: formData.get('business_type'),
    audience: formData.get('audience'),
    pain: formData.get('pain'),
    tone: formData.get('tone'),
  })

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]?.toString() ?? '_'
      if (!fieldErrors[key]) fieldErrors[key] = issue.message
    }
    return { fieldErrors }
  }

  try {
    await saveBusinessBasicsToState(parsed.data)
    await markStep('business')
  } catch (err) {
    console.error('[saveBusinessBasicsAction] save error', err)
    return { formError: 'Could not save. Please try again.' }
  }
  redirect('/onboarding/knowledge')
}

const EditedKnowledgeSchema = z.object({
  sections: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(120),
        body: z.string().trim().min(1).max(4000),
      }),
    )
    .min(1)
    .max(10),
})

export type KnowledgeStepError = 'no_basics' | 'generation_failed' | 'save_failed'

/** Generate-only (does not save). Used to render the preview. */
export async function generateKnowledgeAction(): Promise<
  | { ok: true; data: GeneratedKnowledge }
  | { ok: false; error: KnowledgeStepError }
> {
  const basics = await getBusinessBasics()
  if (!basics) return { ok: false, error: 'no_basics' }
  try {
    const { createClient } = await import('@/lib/supabase/server')
    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) return { ok: false, error: 'generation_failed' }
    const { data: state } = await supabase
      .from('onboarding_state')
      .select('ui_language')
      .eq('profile_id', auth.user.id)
      .maybeSingle()
    const lang = state?.ui_language === 'en' ? 'en' : 'tl'
    const data = await generateKnowledge({ basics, lang })
    return { ok: true, data }
  } catch (err) {
    console.error('[generateKnowledgeAction]', err)
    return { ok: false, error: 'generation_failed' }
  }
}

export async function saveKnowledgeAction(
  _prev: { error?: KnowledgeStepError } | undefined,
  formData: FormData,
): Promise<{ error?: KnowledgeStepError }> {
  const rawSections = formData.get('sections_json')
  let parsed: unknown
  try {
    parsed = JSON.parse(String(rawSections ?? '[]'))
  } catch {
    return { error: 'save_failed' }
  }
  const result = EditedKnowledgeSchema.safeParse({ sections: parsed })
  if (!result.success) {
    return { error: 'save_failed' }
  }

  const basics = await getBusinessBasics()
  if (!basics) return { error: 'no_basics' }

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { error: 'save_failed' }

  const text = result.data.sections
    .map((s) => `${s.title}\n\n${s.body}`)
    .join('\n\n---\n\n')
  const html = result.data.sections
    .map((s) => `<h3>${escapeHtml(s.title)}</h3><p>${escapeHtml(s.body).replace(/\n/g, '<br>')}</p>`)
    .join('')

  const { error: insertErr } = await supabase.from('knowledge_documents').insert({
    user_id: auth.user.id,
    title: `About ${basics.name}`,
    content_text: text,
    content_html: html,
    content_json: { sections: result.data.sections, source: 'onboarding' },
    has_unsaved_changes: false,
    version: 1,
    published_at: new Date().toISOString(),
    embedding_status: 'pending',
  })
  if (insertErr) {
    console.error('[saveKnowledgeAction] insert error', insertErr)
    return { error: 'save_failed' }
  }

  await markStep('knowledge')
  redirect('/onboarding/faqs')
}

export type FaqsStepError = 'no_basics' | 'generation_failed' | 'save_failed'

export async function generateFaqsAction(): Promise<
  | { ok: true; data: GeneratedFaqs }
  | { ok: false; error: FaqsStepError }
> {
  const basics = await getBusinessBasics()
  if (!basics) return { ok: false, error: 'no_basics' }
  try {
    const { createClient } = await import('@/lib/supabase/server')
    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) return { ok: false, error: 'generation_failed' }
    const { data: state } = await supabase
      .from('onboarding_state')
      .select('ui_language')
      .eq('profile_id', auth.user.id)
      .maybeSingle()
    const lang = state?.ui_language === 'en' ? 'en' : 'tl'
    const data = await generateFaqs({ basics, lang })
    return { ok: true, data }
  } catch (err) {
    console.error('[generateFaqsAction]', err)
    return { ok: false, error: 'generation_failed' }
  }
}

const FaqsPayloadSchema = z.object({
  items: z
    .array(
      z.object({
        question: z.string().trim().min(1).max(300),
        answer: z.string().trim().min(1).max(4000),
      }),
    )
    .max(20),
})

export async function saveFaqsAction(
  _prev: { error?: FaqsStepError } | undefined,
  formData: FormData,
): Promise<{ error?: FaqsStepError }> {
  const raw = formData.get('items_json')
  let parsed: unknown
  try {
    parsed = JSON.parse(String(raw ?? '[]'))
  } catch {
    return { error: 'save_failed' }
  }
  const result = FaqsPayloadSchema.safeParse({ items: parsed })
  if (!result.success) return { error: 'save_failed' }

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { error: 'save_failed' }

  if (result.data.items.length > 0) {
    const rows = result.data.items.map((it, i) => ({
      user_id: auth.user!.id,
      question: it.question,
      answer: it.answer,
      position: i,
      is_published: true,
      version: 1,
      embedding_status: 'pending',
    }))
    const { error: insertErr } = await supabase.from('knowledge_faqs').insert(rows)
    if (insertErr) {
      console.error('[saveFaqsAction] insert', insertErr)
      return { error: 'save_failed' }
    }
  }

  await markStep('faqs')
  redirect('/onboarding/personality')
}

const PersonalitySeedsSchema = z.object({
  vibe_preset: z.enum(VIBE_PRESETS).optional(),
  greet: z.string().trim().max(300).optional(),
  must_use: z.string().trim().max(300).optional(),
  must_not: z.string().trim().max(300).optional(),
})

export type PersonalityStepError = 'no_basics' | 'generation_failed' | 'save_failed'
export type PersonalityFormState = { error?: PersonalityStepError }

export async function savePersonalityAction(
  _prev: PersonalityFormState | undefined,
  formData: FormData,
): Promise<PersonalityFormState> {
  const seedsParsed = PersonalitySeedsSchema.safeParse({
    vibe_preset: (formData.get('vibe_preset') || undefined) as VibePreset | undefined,
    greet: formData.get('greet') || undefined,
    must_use: formData.get('must_use') || undefined,
    must_not: formData.get('must_not') || undefined,
  })
  if (!seedsParsed.success) return { error: 'save_failed' }

  const basics = await getBusinessBasics()
  if (!basics) return { error: 'no_basics' }

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { error: 'save_failed' }

  const { data: state } = await supabase
    .from('onboarding_state')
    .select('ui_language')
    .eq('profile_id', auth.user.id)
    .maybeSingle()
  const lang = state?.ui_language === 'en' ? 'en' : 'tl'

  let generated
  try {
    generated = await generatePersonality({
      basics,
      seeds: seedsParsed.data,
      lang,
    })
  } catch (err) {
    console.error('[savePersonalityAction] generate', err)
    return { error: 'generation_failed' }
  }

  await supabase
    .from('onboarding_state')
    .update({ personality_seeds: seedsParsed.data })
    .eq('profile_id', auth.user.id)

  const { error: upsertErr } = await supabase.from('chatbot_configs').upsert(
    {
      user_id: auth.user.id,
      name: generated.name,
      persona: generated.persona,
      do_rules: generated.do_rules,
      dont_rules: generated.dont_rules,
      fallback_message: generated.fallback_message,
      personality_source: 'custom',
    },
    { onConflict: 'user_id' },
  )
  if (upsertErr) {
    console.error('[savePersonalityAction] upsert', upsertErr)
    return { error: 'save_failed' }
  }

  await markStep('personality')
  redirect('/onboarding/goal')
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
