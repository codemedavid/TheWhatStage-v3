import 'server-only'
import { cache } from 'react'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { STEP_ORDER } from './steps'
import type {
  OnboardingState,
  OnboardingStep,
} from './types'

const TABLE = 'onboarding_state'

type Row = {
  profile_id: string
  business_completed_at: string | null
  knowledge_completed_at: string | null
  faqs_completed_at: string | null
  personality_completed_at: string | null
  goal_completed_at: string | null
  goal_content_completed_at: string | null
  flow_completed_at: string | null
  completed_at: string | null
  dismissed_at: string | null
  business_basics: unknown
  faq_seeds: unknown
  personality_seeds: unknown
  flow_description: string | null
  ai_generations: unknown
  ui_language: 'tl' | 'en'
  customer_language: 'tl' | 'en'
  created_at: string
  updated_at: string
}

function rowToState(row: Row): OnboardingState {
  return {
    profileId: row.profile_id,
    business_completed_at: row.business_completed_at,
    knowledge_completed_at: row.knowledge_completed_at,
    faqs_completed_at: row.faqs_completed_at,
    personality_completed_at: row.personality_completed_at,
    goal_completed_at: row.goal_completed_at,
    goal_content_completed_at: row.goal_content_completed_at,
    flow_completed_at: row.flow_completed_at,
    completed_at: row.completed_at,
    dismissed_at: row.dismissed_at,
    business_basics: row.business_basics,
    faq_seeds: row.faq_seeds,
    personality_seeds: row.personality_seeds,
    flow_description: row.flow_description,
    ai_generations: row.ai_generations ?? [],
    ui_language: row.ui_language,
    customer_language: row.customer_language,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/** Read the onboarding row for the signed-in user. Returns null if none exists.
 * Wrapped in React cache() so multiple lib helpers (getBusinessBasics,
 * getPrimaryActionPage, action-side ensures) share a single SELECT per render. */
export const getOnboardingState = cache(async (): Promise<OnboardingState | null> => {
  const user = await getAuthUser()
  if (!user) return null
  const supabase = await createClient()
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('profile_id', user.id)
    .maybeSingle()
  if (error || !data) return null
  return rowToState(data as Row)
})

/** Insert an onboarding_state row for a freshly signed-up user. Idempotent.
 * Retries once on FK violation: the handle_new_user trigger that creates the
 * profile row sometimes hasn't committed by the time we get here, and inserting
 * the FK target before it exists yields code 23503. */
export async function initOnboardingForProfile(profileId: string): Promise<void> {
  const admin = createAdminClient()
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await admin
      .from(TABLE)
      .upsert({ profile_id: profileId }, { onConflict: 'profile_id', ignoreDuplicates: true })
    if (!error) return
    if (error.code === '23503' && attempt === 0) {
      await new Promise((r) => setTimeout(r, 200))
      continue
    }
    throw new Error(`init_onboarding_failed: ${error.code ?? '?'} ${error.message}`)
  }
}

/** Ensure a state row exists for the current user. Called defensively from
 * save actions so a failed signup-time init doesn't leave the user with
 * step-saves that silently update zero rows. */
export async function ensureOnboardingState(): Promise<void> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('not authenticated')
  await initOnboardingForProfile(auth.user.id)
}

/** Mark a step completed (or skipped) for the current user. Single Postgres
 * round-trip via the onboarding_mark_step RPC: column update + audit append
 * in one statement, server-side jsonb || so concurrent step saves can't
 * race-clobber the audit array. */
export async function markStep(
  step: OnboardingStep,
  opts: { skipped?: boolean } = {},
): Promise<void> {
  const supabase = await createClient()
  const user = await getAuthUser()
  if (!user) throw new Error('not authenticated')
  const { error } = await supabase.rpc('onboarding_mark_step', {
    p_profile_id: user.id,
    p_step: step,
    p_skipped: !!opts.skipped,
  })
  if (error) throw error
}

export async function dismissOnboarding(): Promise<void> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('not authenticated')
  await supabase
    .from(TABLE)
    .update({ dismissed_at: new Date().toISOString() })
    .eq('profile_id', auth.user.id)
}

export async function completeOnboarding(): Promise<void> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('not authenticated')
  await supabase
    .from(TABLE)
    .update({ completed_at: new Date().toISOString() })
    .eq('profile_id', auth.user.id)
}

export async function setOnboardingLanguage(
  lang: 'tl' | 'en',
  which: 'ui' | 'customer' | 'both' = 'ui',
): Promise<void> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('not authenticated')
  const patch: Record<string, unknown> = {}
  if (which === 'ui' || which === 'both') patch.ui_language = lang
  if (which === 'customer' || which === 'both') patch.customer_language = lang
  await supabase.from(TABLE).update(patch).eq('profile_id', auth.user.id)
}

/** Pure helper: 0..1 progress fraction. Used by progress bar + tests. */
export function progressFraction(state: OnboardingState): number {
  const done = STEP_ORDER.filter((s) => s.isComplete(state)).length
  return done / STEP_ORDER.length
}

import type { BusinessBasics } from './business-basics'
import { BusinessBasicsSchema } from './business-basics'

/** Persist the typed business_basics JSON for the current user. */
export async function saveBusinessBasicsToState(basics: BusinessBasics): Promise<void> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('not authenticated')
  const { error } = await supabase
    .from(TABLE)
    .update({ business_basics: basics })
    .eq('profile_id', auth.user.id)
  if (error) throw error
}

/** Read the typed business_basics JSON; returns null if missing or malformed. */
export async function getBusinessBasics(): Promise<BusinessBasics | null> {
  const state = await getOnboardingState()
  if (!state?.business_basics) return null
  const r = BusinessBasicsSchema.safeParse(state.business_basics)
  return r.success ? r.data : null
}

export interface PrimaryActionPageBrief {
  id: string
  kind: string
  title: string
  config: unknown
}

export const getPrimaryActionPage = cache(async (): Promise<PrimaryActionPageBrief | null> => {
  const user = await getAuthUser()
  if (!user) return null
  const supabase = await createClient()
  const { data: cfg } = await supabase
    .from('chatbot_configs')
    .select('primary_action_page_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!cfg?.primary_action_page_id) return null
  const { data: page } = await supabase
    .from('action_pages')
    .select('id, kind, title, config')
    .eq('id', cfg.primary_action_page_id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!page) return null
  return { id: page.id, kind: page.kind, title: page.title, config: page.config }
})
