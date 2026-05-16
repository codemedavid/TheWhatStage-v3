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
import { isActionPageKind, KIND_REGISTRY, type ActionPageKind } from '@/lib/action-pages/kinds'
import { BusinessBasicsSchema } from '@/lib/onboarding/business-basics'
import { LANG_COOKIE } from '@/lib/onboarding/i18n'
import { ONBOARDING_STEPS, type OnboardingLang, type OnboardingStep } from '@/lib/onboarding/types'
import { nextStepRoute } from '@/lib/onboarding/steps'
import { generateKnowledge, type GeneratedKnowledge } from '@/lib/onboarding/ai/knowledge'
import { generateFaqs, type GeneratedFaqs } from '@/lib/onboarding/ai/faqs'
import { generatePersonality, VIBE_PRESETS, type VibePreset } from '@/lib/onboarding/ai/personality'
import { generateFormFields, type SuggestedBlock } from '@/lib/onboarding/ai/form-fields'
import { generateBotInstructions, type GeneratedBotInstructions } from '@/lib/onboarding/ai/bot-instructions'
import { getPrimaryActionPage } from '@/lib/onboarding/state'

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

export async function skipStepAction(step: OnboardingStep): Promise<void> {
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

export type GoalStepError = 'invalid_kind' | 'save_failed'
export type GoalFormState = { error?: GoalStepError }

function uniqueSlug(seed: string): string {
  const base = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'page'
  return `${base}-${Math.random().toString(36).slice(2, 8)}`
}

export async function saveGoalAction(
  _prev: GoalFormState | undefined,
  formData: FormData,
): Promise<GoalFormState> {
  const raw = formData.get('kind')
  if (!isActionPageKind(raw)) return { error: 'invalid_kind' }
  const kind: ActionPageKind = raw

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { error: 'save_failed' }

  const meta = KIND_REGISTRY[kind]
  const basics = await getBusinessBasics()
  const title = basics ? `${basics.name} — ${meta.label}` : meta.label
  const slug = uniqueSlug(basics?.name ?? meta.label)

  const { data: page, error: insertErr } = await supabase
    .from('action_pages')
    .insert({
      user_id: auth.user.id,
      kind,
      slug,
      title,
      description: meta.blurb,
      status: meta.defaultStatusOnCreate,
      config: meta.defaultConfig,
      pipeline_rules: meta.defaultPipelineRules,
      notification_template: { text: meta.defaultNotificationText },
      bot_send_instructions: meta.defaultBotSendInstructions,
      cta_label: meta.defaultCtaLabel,
    })
    .select('id')
    .single()
  if (insertErr || !page) {
    console.error('[saveGoalAction] insert action_page', insertErr)
    return { error: 'save_failed' }
  }

  const { error: upsertErr } = await supabase.from('chatbot_configs').upsert(
    { user_id: auth.user.id, primary_action_page_id: page.id },
    { onConflict: 'user_id' },
  )
  if (upsertErr) {
    console.error('[saveGoalAction] upsert chatbot_configs', upsertErr)
    return { error: 'save_failed' }
  }

  await markStep('goal')
  redirect('/onboarding/goal-content')
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

const SaveCatalogProductsSchema = z.object({
  products: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(160),
        price_amount: z.number().nonnegative().nullable(),
        summary: z.string().trim().max(280).optional(),
      }),
    )
    .max(5),
})

export async function saveCatalogProductsAction(
  _prev: { error?: 'save_failed' } | undefined,
  formData: FormData,
): Promise<{ error?: 'save_failed' }> {
  const raw = formData.get('products_json')
  let parsed: unknown
  try { parsed = JSON.parse(String(raw ?? '[]')) } catch { return { error: 'save_failed' } }
  const result = SaveCatalogProductsSchema.safeParse({ products: parsed })
  if (!result.success) return { error: 'save_failed' }

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { error: 'save_failed' }

  if (result.data.products.length > 0) {
    const rows = result.data.products.map((p) => ({
      user_id: auth.user!.id,
      kind: 'product' as const,
      status: 'published' as const,
      title: p.title,
      slug: `${p.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40) || 'item'}-${Math.random().toString(36).slice(2,7)}`,
      summary: p.summary ?? null,
      price_amount: p.price_amount,
      currency: 'PHP',
      pricing_model: p.price_amount == null ? 'quote' as const : 'fixed' as const,
    }))
    const { error } = await supabase.from('business_items').insert(rows)
    if (error) {
      console.error('[saveCatalogProductsAction]', error)
      return { error: 'save_failed' }
    }
  }

  await markStep('goal_content')
  redirect('/onboarding/flow')
}

const SaveSalesSchema = z.object({
  pageId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  headline: z.string().trim().max(240).optional(),
  description: z.string().trim().max(4000).optional(),
  price_amount: z.number().nonnegative().nullable(),
})

export async function saveSalesContentAction(
  _prev: { error?: 'save_failed' } | undefined,
  formData: FormData,
): Promise<{ error?: 'save_failed' }> {
  const parsed = SaveSalesSchema.safeParse({
    pageId: formData.get('page_id'),
    name: formData.get('name'),
    headline: formData.get('headline') || undefined,
    description: formData.get('description') || undefined,
    price_amount: formData.get('price_amount') ? Number(formData.get('price_amount')) : null,
  })
  if (!parsed.success) return { error: 'save_failed' }

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: page } = await supabase.from('action_pages').select('config').eq('id', parsed.data.pageId).maybeSingle()
  if (!page) return { error: 'save_failed' }
  const config = (page.config as Record<string, unknown>) ?? {}
  const product = { ...(config.product as object ?? {}), name: parsed.data.name, headline: parsed.data.headline ?? '', description: parsed.data.description ?? '' }
  const price = { ...(config.price as object ?? {}), amount: parsed.data.price_amount }
  const newConfig = { ...config, product, price }

  const { error } = await supabase.from('action_pages').update({ config: newConfig, status: 'published' }).eq('id', parsed.data.pageId)
  if (error) {
    console.error('[saveSalesContentAction]', error)
    return { error: 'save_failed' }
  }
  await markStep('goal_content')
  redirect('/onboarding/flow')
}

const SaveBookingSchema = z.object({
  pageId: z.string().uuid(),
  duration_min: z.coerce.number().int().min(5).max(480),
})

export async function saveBookingContentAction(
  _prev: { error?: 'save_failed' } | undefined,
  formData: FormData,
): Promise<{ error?: 'save_failed' }> {
  const parsed = SaveBookingSchema.safeParse({
    pageId: formData.get('page_id'),
    duration_min: formData.get('duration_min'),
  })
  if (!parsed.success) return { error: 'save_failed' }

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: page } = await supabase.from('action_pages').select('config').eq('id', parsed.data.pageId).maybeSingle()
  if (!page) return { error: 'save_failed' }
  const config = (page.config as Record<string, unknown>) ?? {}
  const appointment = { ...(config.appointment as object ?? {}), duration_min: parsed.data.duration_min }
  const newConfig = { ...config, appointment }

  const { error } = await supabase.from('action_pages').update({ config: newConfig }).eq('id', parsed.data.pageId)
  if (error) {
    console.error('[saveBookingContentAction]', error)
    return { error: 'save_failed' }
  }
  await markStep('goal_content')
  redirect('/onboarding/flow')
}

const SaveRealestateSchema = z.object({
  title: z.string().trim().min(1).max(160),
  price_amount: z.number().nonnegative().nullable(),
  location: z.string().trim().max(280).optional(),
})

export async function saveRealestatePropertyAction(
  _prev: { error?: 'save_failed' } | undefined,
  formData: FormData,
): Promise<{ error?: 'save_failed' }> {
  const parsed = SaveRealestateSchema.safeParse({
    title: formData.get('title'),
    price_amount: formData.get('price_amount') ? Number(formData.get('price_amount')) : null,
    location: formData.get('location') || undefined,
  })
  if (!parsed.success) return { error: 'save_failed' }

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { error: 'save_failed' }

  const slug = `${parsed.data.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40) || 'property'}-${Math.random().toString(36).slice(2,7)}`

  const { error } = await supabase.from('business_items').insert({
    user_id: auth.user.id,
    kind: 'property' as const,
    status: 'published' as const,
    title: parsed.data.title,
    slug,
    summary: parsed.data.location ?? null,
    price_amount: parsed.data.price_amount,
    currency: 'PHP',
    pricing_model: parsed.data.price_amount == null ? 'quote' as const : 'fixed' as const,
  })
  if (error) {
    console.error('[saveRealestatePropertyAction]', error)
    return { error: 'save_failed' }
  }
  await markStep('goal_content')
  redirect('/onboarding/flow')
}

const SaveFormFieldsSchema = z.object({
  pageId: z.string().uuid(),
  blocks_json: z.string(),
})

export async function saveFormFieldsAction(
  _prev: { error?: 'save_failed' } | undefined,
  formData: FormData,
): Promise<{ error?: 'save_failed' }> {
  const parsed = SaveFormFieldsSchema.safeParse({
    pageId: formData.get('page_id'),
    blocks_json: formData.get('blocks_json'),
  })
  if (!parsed.success) return { error: 'save_failed' }

  let blocks: unknown
  try { blocks = JSON.parse(parsed.data.blocks_json) } catch { return { error: 'save_failed' } }
  if (!Array.isArray(blocks)) return { error: 'save_failed' }

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: page } = await supabase.from('action_pages').select('config').eq('id', parsed.data.pageId).maybeSingle()
  if (!page) return { error: 'save_failed' }
  const config = (page.config as Record<string, unknown>) ?? {}
  const newConfig = { ...config, blocks }

  const { error } = await supabase.from('action_pages').update({ config: newConfig }).eq('id', parsed.data.pageId)
  if (error) {
    console.error('[saveFormFieldsAction]', error)
    return { error: 'save_failed' }
  }
  await markStep('goal_content')
  redirect('/onboarding/flow')
}

export async function generateFormFieldsAction(kind: 'form' | 'qualification'): Promise<
  | { ok: true; blocks: SuggestedBlock[] }
  | { ok: false; error: 'no_basics' | 'generation_failed' }
> {
  const basics = await getBusinessBasics()
  if (!basics) return { ok: false, error: 'no_basics' }
  try {
    const { createClient } = await import('@/lib/supabase/server')
    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) return { ok: false, error: 'generation_failed' }
    const { data: state } = await supabase.from('onboarding_state').select('ui_language').eq('profile_id', auth.user.id).maybeSingle()
    const lang = state?.ui_language === 'en' ? 'en' : 'tl'
    const { blocks } = await generateFormFields({ basics, kind, lang })
    return { ok: true, blocks }
  } catch (err) {
    console.error('[generateFormFieldsAction]', err)
    return { ok: false, error: 'generation_failed' }
  }
}

const FlowPayloadSchema = z.object({
  flow_description: z.string().trim().min(20).max(2000),
})

export type FlowStepError = 'no_goal' | 'no_basics' | 'generation_failed' | 'save_failed'

export async function generateFlowAction(
  formData: FormData,
): Promise<
  | { ok: true; data: GeneratedBotInstructions; pageId: string }
  | { ok: false; error: FlowStepError }
> {
  const parsed = FlowPayloadSchema.safeParse({ flow_description: formData.get('flow_description') })
  if (!parsed.success) return { ok: false, error: 'save_failed' }

  const basics = await getBusinessBasics()
  if (!basics) return { ok: false, error: 'no_basics' }
  const page = await getPrimaryActionPage()
  if (!page) return { ok: false, error: 'no_goal' }

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { ok: false, error: 'generation_failed' }

  const { data: state } = await supabase.from('onboarding_state').select('ui_language').eq('profile_id', auth.user.id).maybeSingle()
  const lang = state?.ui_language === 'en' ? 'en' : 'tl'

  await supabase.from('onboarding_state').update({ flow_description: parsed.data.flow_description }).eq('profile_id', auth.user.id)

  const cfg = (page.config as Record<string, unknown> | null) ?? {}
  const cta = cfg.cta as { primary_label?: string } | undefined
  const ctaLabel = cta?.primary_label ?? page.title

  try {
    const data = await generateBotInstructions({
      basics,
      goal: page.kind as ActionPageKind,
      action_page: { title: page.title, cta_label: ctaLabel },
      flow_description: parsed.data.flow_description,
      lang,
    })
    return { ok: true, data, pageId: page.id }
  } catch (err) {
    console.error('[generateFlowAction]', err)
    return { ok: false, error: 'generation_failed' }
  }
}

const SaveFlowSchema = z.object({
  pageId: z.string().uuid(),
  bot_send_instructions: z.string().trim().min(10).max(2000),
  recommendation_rules: z.string().trim().min(10).max(2000),
  required_slots: z.array(z.string().trim().min(1).max(60)).max(10),
  confidence_threshold: z.number().min(0).max(1),
})

export async function saveFlowAction(
  _prev: { error?: FlowStepError } | undefined,
  formData: FormData,
): Promise<{ error?: FlowStepError }> {
  const slotsRaw = formData.get('required_slots_json')
  let slots: string[] = []
  try { slots = JSON.parse(String(slotsRaw ?? '[]')) } catch { /* keep empty */ }

  const parsed = SaveFlowSchema.safeParse({
    pageId: formData.get('page_id'),
    bot_send_instructions: formData.get('bot_send_instructions'),
    recommendation_rules: formData.get('recommendation_rules'),
    required_slots: slots,
    confidence_threshold: Number(formData.get('confidence_threshold') ?? 0.55),
  })
  if (!parsed.success) return { error: 'save_failed' }

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { error: 'save_failed' }

  const { error: pageErr } = await supabase
    .from('action_pages')
    .update({ bot_send_instructions: parsed.data.bot_send_instructions })
    .eq('id', parsed.data.pageId)
    .eq('user_id', auth.user.id)
  if (pageErr) {
    console.error('[saveFlowAction] action_pages', pageErr)
    return { error: 'save_failed' }
  }

  const { data: cfgRow } = await supabase
    .from('chatbot_configs')
    .select('recommendation_rules')
    .eq('user_id', auth.user.id)
    .maybeSingle()
  const existing = (cfgRow?.recommendation_rules as Record<string, unknown> | null) ?? {}
  const per = (existing.perActionPage as Record<string, unknown> | undefined) ?? {}
  const next = {
    defaultConfidenceThreshold: (existing.defaultConfidenceThreshold as number | undefined) ?? 0.55,
    perActionPage: {
      ...per,
      [parsed.data.pageId]: {
        rules: parsed.data.recommendation_rules,
        requiredSlots: parsed.data.required_slots,
        confidenceThreshold: parsed.data.confidence_threshold,
      },
    },
  }

  const { error: cfgErr } = await supabase
    .from('chatbot_configs')
    .upsert({ user_id: auth.user.id, recommendation_rules: next }, { onConflict: 'user_id' })
  if (cfgErr) {
    console.error('[saveFlowAction] chatbot_configs', cfgErr)
    return { error: 'save_failed' }
  }

  await markStep('flow')
  redirect('/onboarding/done')
}
