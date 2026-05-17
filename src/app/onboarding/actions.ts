'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { runGeneration } from '@/lib/onboarding/generation/runner'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import {
  completeOnboarding as completeOnboardingState,
  dismissOnboarding as dismissOnboardingState,
  ensureOnboardingState,
  markStep,
  setOnboardingLanguage,
  saveBusinessBasicsToState,
  getBusinessBasics,
} from '@/lib/onboarding/state'
import { isActionPageKind, KIND_REGISTRY, type ActionPageKind } from '@/lib/action-pages/kinds'
import { isGenerationKind, type GenerationKind } from '@/lib/onboarding/generation/types'
import { BusinessBasicsSchema } from '@/lib/onboarding/business-basics'
import { LANG_COOKIE, t } from '@/lib/onboarding/i18n'
import {
  ONBOARDING_STEPS,
  type OnboardingLang,
  type OnboardingStep,
} from '@/lib/onboarding/types'
import { nextStepRoute } from '@/lib/onboarding/steps'
import { uniqueSlug } from './slug'
import { generateKnowledge, type GeneratedKnowledge } from '@/lib/onboarding/ai/knowledge'
import { generateFaqs, type GeneratedFaqs } from '@/lib/onboarding/ai/faqs'
import { VIBE_PRESETS, type VibePreset } from '@/lib/onboarding/ai/personality'
import type { GeneratedPersonality } from '@/lib/onboarding/ai/personality-shared'
import { clearJob, getJob } from '@/lib/onboarding/generation/repo'
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

/**
 * Re-enqueue a failed generation. Wired to the "Retry" form rendered by the
 * gate pages when status='failed'. Re-resolves inputs from server state so a
 * stale tab does not pass forged parameters.
 */
export async function retryGenerationAction(formData: FormData): Promise<void> {
  const kindRaw = formData.get('kind')
  if (!isGenerationKind(kindRaw)) redirect('/onboarding/welcome')
  const kind = kindRaw

  const { createClient: createSupabaseServerClient } = await import('@/lib/supabase/server')
  const supabase = await createSupabaseServerClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect('/login')
  const profileId = auth.user.id

  const basics = await getBusinessBasics()
  if (!basics) redirect('/onboarding/business')

  const { data: stateRow } = await supabase
    .from('onboarding_state')
    .select('ui_language, personality_seeds, flow_description')
    .eq('profile_id', profileId)
    .maybeSingle()
  const lang: OnboardingLang = stateRow?.ui_language === 'en' ? 'en' : 'tl'

  // Clear the existing job row so the enqueue RPC actually re-runs the
  // generator. Without this, a 'done' row with a matching input hash makes the
  // RPC short-circuit with 'already_done' and the user sees the same result —
  // making the Regenerate CTA a no-op.
  await clearJob(profileId, kind)

  if (kind === 'knowledge' || kind === 'faqs') {
    after(async () => {
      await runGeneration(profileId, kind, { basics, lang })
    })
  } else if (kind === 'personality_seed') {
    const seeds = (stateRow?.personality_seeds ?? {}) as {
      vibe_preset?: VibePreset
      greet?: string
      must_use?: string
      must_not?: string
    }
    after(async () => {
      await runGeneration(profileId, 'personality_seed', { basics, seeds, lang })
    })
  } else if (kind === 'form_fields') {
    const page = await getPrimaryActionPage()
    const formKind: 'form' | 'qualification' | null =
      page?.kind === 'form' ? 'form' : page?.kind === 'qualification' ? 'qualification' : null
    if (!formKind) redirect('/onboarding/goal')
    after(async () => {
      await runGeneration(profileId, 'form_fields', { basics, kind: formKind, lang })
    })
  } else if (kind === 'bot_instructions') {
    const page = await getPrimaryActionPage()
    const flowDescription = (stateRow?.flow_description ?? '').trim()
    if (!page || flowDescription.length < 20) redirect('/onboarding/flow')
    const cfg = (page.config as Record<string, unknown> | null) ?? {}
    const cta = cfg.cta as { primary_label?: string } | undefined
    const ctaLabel = cta?.primary_label ?? page.title
    after(async () => {
      await runGeneration(profileId, 'bot_instructions', {
        basics,
        goal: page.kind as ActionPageKind,
        actionPage: { title: page.title, ctaLabel, slug: page.slug },
        flowDescription,
        lang,
      })
    })
  }

  const routeByKind: Record<GenerationKind, string> = {
    knowledge: '/onboarding/knowledge',
    faqs: '/onboarding/faqs',
    personality_seed: '/onboarding/personality',
    form_fields: '/onboarding/goal-content',
    bot_instructions: '/onboarding/flow',
  }
  redirect(routeByKind[kind])
}

export async function skipStepAction(step: OnboardingStep): Promise<void> {
  if (!isStep(step)) throw new Error('invalid step')
  await markStep(step, { skipped: true })
  redirect(nextStepRoute(step))
}

export async function dismissOnboardingAction(): Promise<void> {
  try {
    await dismissOnboardingState()
  } catch (err) {
    // Session expired or row missing — don't blank the page on an error
    // boundary. Send the user somewhere sensible instead.
    console.error('[dismissOnboardingAction]', err)
    redirect('/login')
  }
  redirect('/dashboard')
}

export async function completeOnboardingAction(): Promise<void> {
  await completeOnboardingState()
  redirect('/dashboard')
}

export type BusinessBasicsFormState = {
  fieldErrors?: Record<string, string>
  formError?: string
  /** Echoed back on validation/save failure so the form re-renders with the
   * user's input instead of wiping it. */
  values?: {
    name?: string
    offer?: string
    business_type?: string
    audience?: string
    pain?: string
    tone?: string
  }
}

export async function saveBusinessBasicsAction(
  _prev: BusinessBasicsFormState,
  formData: FormData,
): Promise<BusinessBasicsFormState> {
  const raw = {
    name: String(formData.get('name') ?? ''),
    offer: String(formData.get('offer') ?? ''),
    business_type: String(formData.get('business_type') ?? ''),
    audience: String(formData.get('audience') ?? ''),
    pain: String(formData.get('pain') ?? ''),
    tone: String(formData.get('tone') ?? ''),
  }
  const parsed = BusinessBasicsSchema.safeParse(raw)

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]?.toString() ?? '_'
      if (!fieldErrors[key]) fieldErrors[key] = issue.message
    }
    return { fieldErrors, values: raw }
  }

  try {
    // Defensively ensure the state row exists. If signup-time init silently
    // failed, every step-save would otherwise update zero rows and appear stuck.
    await ensureOnboardingState()
    await saveBusinessBasicsToState(parsed.data)
    await markStep('business')
  } catch (err) {
    console.error('[saveBusinessBasicsAction] save error', err)
    return {
      formError: 'Could not save. Please try again.',
      values: raw,
    }
  }

  // Fire-and-forget generations for downstream steps.
  try {
    const { createClient: createSupabaseServerClient } = await import('@/lib/supabase/server')
    const supabase = await createSupabaseServerClient()
    const { data: auth } = await supabase.auth.getUser()
    if (auth.user) {
      const profileId = auth.user.id
      const { data: stateRow } = await supabase
        .from('onboarding_state')
        .select('ui_language')
        .eq('profile_id', profileId)
        .maybeSingle()
      const lang = stateRow?.ui_language === 'en' ? 'en' : 'tl'
      const basics = parsed.data
      after(async () => {
        await Promise.allSettled([
          runGeneration(profileId, 'knowledge', { basics, lang }),
          runGeneration(profileId, 'faqs', { basics, lang }),
        ])
      })
    }
  } catch (err) {
    console.error('[saveBusinessBasicsAction] schedule-generation', err)
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

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { error: 'save_failed' }
  const userId = auth.user.id

  const { data: stateRow } = await supabase
    .from('onboarding_state')
    .select('business_basics, ui_language')
    .eq('profile_id', userId)
    .maybeSingle()

  const basicsParsed = BusinessBasicsSchema.safeParse(stateRow?.business_basics)
  if (!basicsParsed.success) return { error: 'no_basics' }
  const basics = basicsParsed.data
  const lang: OnboardingLang = stateRow?.ui_language === 'en' ? 'en' : 'tl'

  const text = result.data.sections
    .map((s) => `${s.title}\n\n${s.body}`)
    .join('\n\n---\n\n')
  const html = result.data.sections
    .map((s) => `<h3>${escapeHtml(s.title)}</h3><p>${escapeHtml(s.body).replace(/\n/g, '<br>')}</p>`)
    .join('')

  // Tiptap-compatible ProseMirror doc so the dashboard editor renders the
  // sections instead of falling into an empty editor (the old shape stored a
  // `{sections,source}` object that Tiptap silently rejected).
  const tiptapDoc = {
    type: 'doc',
    content: result.data.sections.flatMap((s) => [
      {
        type: 'heading',
        attrs: { level: 3, textAlign: 'left' },
        content: [{ type: 'text', text: s.title }],
      },
      {
        type: 'paragraph',
        attrs: { textAlign: 'left' },
        content: [{ type: 'text', text: s.body }],
      },
    ]),
  }

  const { error: insertErr } = await supabase.from('knowledge_documents').insert({
    user_id: userId,
    title: t('knowledge.doc_title', lang, { name: basics.name }),
    content_text: text,
    content_html: html,
    content_json: tiptapDoc,
    has_unsaved_changes: false,
    version: 1,
    published_at: new Date().toISOString(),
    embedding_status: 'pending',
  })
  if (insertErr) {
    console.error('[saveKnowledgeAction] insert error', insertErr)
    return { error: 'save_failed' }
  }

  try {
    await markStep('knowledge')
  } catch (err) {
    console.error('[saveKnowledgeAction] markStep', err)
  }

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
  const userId = auth.user.id

  if (result.data.items.length > 0) {
    const rows = result.data.items.map((it, i) => ({
      user_id: userId,
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

  try {
    await markStep('faqs')
  } catch (err) {
    console.error('[saveFaqsAction] markStep', err)
  }

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
  const seeds = seedsParsed.data

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { error: 'save_failed' }
  const userId = auth.user.id

  const { data: stateRow } = await supabase
    .from('onboarding_state')
    .select('business_basics, ui_language')
    .eq('profile_id', userId)
    .maybeSingle()

  const basicsParsed = BusinessBasicsSchema.safeParse(stateRow?.business_basics)
  if (!basicsParsed.success) return { error: 'no_basics' }
  const basics = basicsParsed.data
  const lang = stateRow?.ui_language === 'en' ? 'en' : 'tl'

  // Persist seeds + ensure a chatbot_configs row exists so downstream steps
  // (goal, flow) can attach to it even before generation finishes.
  const { error: upsertErr } = await supabase.from('chatbot_configs').upsert(
    { user_id: userId, personality_source: 'custom' },
    { onConflict: 'user_id' },
  )
  if (upsertErr) {
    console.error('[savePersonalityAction] upsert chatbot_configs', upsertErr)
    return { error: 'save_failed' }
  }

  const { error: stateErr } = await supabase
    .from('onboarding_state')
    .update({ personality_seeds: seeds })
    .eq('profile_id', userId)
  if (stateErr) console.error('[savePersonalityAction] state update', stateErr)

  try {
    await markStep('personality')
  } catch (err) {
    console.error('[savePersonalityAction] markStep', err)
  }

  // Generate the persona in the background — the user moves on immediately.
  // Routed through runGeneration so we get a generation_jobs row (visibility,
  // status, retry, idempotency) instead of an inline LLM call that swallows
  // failures. After the job completes we copy the result into chatbot_configs.
  after(async () => {
    await runGeneration(userId, 'personality_seed', { basics, seeds, lang })
    const job = await getJob(userId, 'personality_seed')
    if (job?.status !== 'done') return
    const result = job.result as GeneratedPersonality | null
    if (!result || typeof result.name !== 'string') return
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const admin = createAdminClient()
    const { error } = await admin.from('chatbot_configs').upsert(
      {
        user_id: userId,
        name: result.name,
        persona: result.persona,
        do_rules: result.do_rules,
        dont_rules: result.dont_rules,
        fallback_message: result.fallback_message,
        personality_source: 'custom',
      },
      { onConflict: 'user_id' },
    )
    if (error) console.error('[savePersonalityAction] persona upsert', error)
  })

  redirect('/onboarding/goal')
}

export type GoalStepError = 'invalid_kind' | 'save_failed'
export type GoalFormState = { error?: GoalStepError }

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

  // Fire-and-forget form_fields generation if applicable.
  try {
    if (basics && (kind === 'form' || kind === 'qualification')) {
      const profileId = auth.user.id
      const { data: stateRow } = await supabase
        .from('onboarding_state')
        .select('ui_language')
        .eq('profile_id', profileId)
        .maybeSingle()
      const lang = stateRow?.ui_language === 'en' ? 'en' : 'tl'
      const formKind: 'form' | 'qualification' = kind
      after(async () => {
        await runGeneration(profileId, 'form_fields', { basics, kind: formKind, lang })
      })
    }
  } catch (err) {
    console.error('[saveGoalAction] schedule-generation', err)
  }

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
      slug: uniqueSlug(p.title, 'item'),
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
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { error: 'save_failed' }
  const { data: page } = await supabase
    .from('action_pages')
    .select('config')
    .eq('id', parsed.data.pageId)
    .eq('user_id', auth.user.id)
    .maybeSingle()
  if (!page) return { error: 'save_failed' }
  const config = (page.config as Record<string, unknown>) ?? {}
  const product = { ...(config.product as object ?? {}), name: parsed.data.name, headline: parsed.data.headline ?? '', description: parsed.data.description ?? '' }
  const price = { ...(config.price as object ?? {}), amount: parsed.data.price_amount }
  const newConfig = { ...config, product, price }

  const { error } = await supabase
    .from('action_pages')
    .update({ config: newConfig })
    .eq('id', parsed.data.pageId)
    .eq('user_id', auth.user.id)
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
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { error: 'save_failed' }
  const { data: page } = await supabase
    .from('action_pages')
    .select('config')
    .eq('id', parsed.data.pageId)
    .eq('user_id', auth.user.id)
    .maybeSingle()
  if (!page) return { error: 'save_failed' }
  const config = (page.config as Record<string, unknown>) ?? {}
  const appointment = { ...(config.appointment as object ?? {}), duration_min: parsed.data.duration_min }
  const newConfig = { ...config, appointment }

  const { error } = await supabase
    .from('action_pages')
    .update({ config: newConfig })
    .eq('id', parsed.data.pageId)
    .eq('user_id', auth.user.id)
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

  const slug = uniqueSlug(parsed.data.title, 'property')

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
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { error: 'save_failed' }
  const { data: page } = await supabase
    .from('action_pages')
    .select('config')
    .eq('id', parsed.data.pageId)
    .eq('user_id', auth.user.id)
    .maybeSingle()
  if (!page) return { error: 'save_failed' }
  const config = (page.config as Record<string, unknown>) ?? {}
  const newConfig = { ...config, blocks }

  const { error } = await supabase
    .from('action_pages')
    .update({ config: newConfig })
    .eq('id', parsed.data.pageId)
    .eq('user_id', auth.user.id)
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

const StartFlowSchema = z.object({
  flow_description: z.string().trim().min(20).max(2000),
})

/**
 * Saves the flow description and kicks off bot_instructions generation in the
 * background. The user is redirected back to /onboarding/flow, which then
 * gates on the job status until the result is ready for review.
 */
export async function startFlowGenerationAction(formData: FormData): Promise<{ error?: FlowStepError }> {
  const parsed = StartFlowSchema.safeParse({ flow_description: formData.get('flow_description') })
  if (!parsed.success) return { error: 'save_failed' }

  const basics = await getBusinessBasics()
  if (!basics) return { error: 'no_basics' }
  const page = await getPrimaryActionPage()
  if (!page) return { error: 'no_goal' }

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { error: 'save_failed' }

  const { data: stateRow } = await supabase
    .from('onboarding_state')
    .select('ui_language')
    .eq('profile_id', auth.user.id)
    .maybeSingle()
  const lang = stateRow?.ui_language === 'en' ? 'en' : 'tl'

  await supabase
    .from('onboarding_state')
    .update({ flow_description: parsed.data.flow_description })
    .eq('profile_id', auth.user.id)

  const cfg = (page.config as Record<string, unknown> | null) ?? {}
  const cta = cfg.cta as { primary_label?: string } | undefined
  const ctaLabel = cta?.primary_label ?? page.title

  const profileId = auth.user.id
  after(async () => {
    await runGeneration(profileId, 'bot_instructions', {
      basics,
      goal: page.kind as ActionPageKind,
      actionPage: { title: page.title, ctaLabel, slug: page.slug },
      flowDescription: parsed.data.flow_description,
      lang,
    })
  })

  redirect('/onboarding/flow')
}

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
      action_page: { title: page.title, cta_label: ctaLabel, slug: page.slug },
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

  // Need the slug so we can inject `!actionpage:<slug>` into the chatbot's
  // global instructions — that token is the only way the messenger runtime
  // knows which page to send during a conversation.
  const { data: pageRow, error: pageFetchErr } = await supabase
    .from('action_pages')
    .select('slug, title')
    .eq('id', parsed.data.pageId)
    .eq('user_id', auth.user.id)
    .maybeSingle()
  if (pageFetchErr || !pageRow) {
    console.error('[saveFlowAction] action_pages fetch', pageFetchErr)
    return { error: 'save_failed' }
  }

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
    .select('recommendation_rules, instructions')
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

  // Merge the action-page reference into the chatbot's global instructions
  // so the messenger runtime resolves `!actionpage:<slug>` and the bot can
  // actually send the page mid-conversation. Idempotent: replaces any prior
  // block delimited by the marker comments below.
  const slug = pageRow.slug as string
  const pageTitle = (pageRow.title as string) ?? slug
  const ruleBlock = [
    `<!-- whatstage:action-page:${slug} -->`,
    `Primary action page: "${pageTitle}".`,
    `When the conversation reaches the send moment, include the token !actionpage:${slug} in your reply so the page link is attached.`,
    parsed.data.bot_send_instructions.trim(),
    `<!-- /whatstage:action-page:${slug} -->`,
  ].join('\n')

  const existingInstr = typeof cfgRow?.instructions === 'string' ? cfgRow.instructions : ''
  const blockRe = new RegExp(
    `<!-- whatstage:action-page:${slug.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')} -->[\\s\\S]*?<!-- /whatstage:action-page:${slug.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')} -->`,
    'g',
  )
  const mergedInstr = blockRe.test(existingInstr)
    ? existingInstr.replace(blockRe, ruleBlock)
    : `${existingInstr ? existingInstr.trim() + '\n\n' : ''}${ruleBlock}`

  const { error: cfgErr } = await supabase
    .from('chatbot_configs')
    .upsert(
      {
        user_id: auth.user.id,
        recommendation_rules: next,
        instructions: mergedInstr,
      },
      { onConflict: 'user_id' },
    )
  if (cfgErr) {
    console.error('[saveFlowAction] chatbot_configs', cfgErr)
    return { error: 'save_failed' }
  }

  await markStep('flow')
  redirect('/onboarding/done')
}
