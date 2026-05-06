import type { SupabaseClient } from '@supabase/supabase-js'
import type { PersonalityTemplate, PersonalityAdoption, GeneratedPersonalityConfig } from './types'

type TemplateRow = {
  id: string
  slug: string
  name: string
  inspired_by: string
  tagline: string
  avatar_emoji: string
  voice_descriptor: string
  sample_persona: string
  sample_do_rules: string[]
  sample_dont_rules: string[]
  signature_phrases: string[]
  tone_axes: Record<string, number>
  best_for: string[]
  visibility: string
  author_user_id: string | null
  is_official: boolean
  created_at: string
  updated_at: string
}

function rowToTemplate(row: TemplateRow): PersonalityTemplate {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    inspiredBy: row.inspired_by,
    tagline: row.tagline,
    avatarEmoji: row.avatar_emoji,
    voiceDescriptor: row.voice_descriptor,
    samplePersona: row.sample_persona,
    sampleDoRules: row.sample_do_rules ?? [],
    sampleDontRules: row.sample_dont_rules ?? [],
    signaturePhrases: row.signature_phrases ?? [],
    toneAxes: {
      assertiveness: row.tone_axes?.assertiveness ?? 0.5,
      warmth: row.tone_axes?.warmth ?? 0.5,
      formality: row.tone_axes?.formality ?? 0.5,
      humor: row.tone_axes?.humor ?? 0.2,
    },
    bestFor: row.best_for ?? [],
    visibility: row.visibility as PersonalityTemplate['visibility'],
    authorUserId: row.author_user_id,
    isOfficial: row.is_official,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listPublicTemplates(supabase: SupabaseClient): Promise<PersonalityTemplate[]> {
  const { data, error } = await supabase
    .from('personality_templates')
    .select('*')
    .eq('visibility', 'public')
    .order('is_official', { ascending: false })
    .order('created_at', { ascending: true })
  if (error) throw new Error(`listPublicTemplates: ${error.message}`)
  return (data as TemplateRow[]).map(rowToTemplate)
}

export async function getTemplateById(supabase: SupabaseClient, id: string): Promise<PersonalityTemplate> {
  const { data, error } = await supabase
    .from('personality_templates')
    .select('*')
    .eq('id', id)
    .single<TemplateRow>()
  if (error) throw new Error(`getTemplateById: ${error.message}`)
  return rowToTemplate(data)
}

export async function createAdoptionDraft(
  supabase: SupabaseClient,
  userId: string,
  templateId: string,
  sourceSnapshot: Record<string, unknown>,
  generatedConfig: GeneratedPersonalityConfig,
  adaptationNotes: string,
): Promise<PersonalityAdoption> {
  // Expire any previous draft for the same template
  await supabase
    .from('chatbot_personality_adoptions')
    .update({ status: 'reverted' })
    .eq('user_id', userId)
    .eq('template_id', templateId)
    .eq('status', 'draft')

  const { data, error } = await supabase
    .from('chatbot_personality_adoptions')
    .insert({
      user_id: userId,
      template_id: templateId,
      status: 'draft',
      source_snapshot: sourceSnapshot,
      generated_config: generatedConfig,
      adaptation_notes: adaptationNotes,
    })
    .select()
    .single()
  if (error) throw new Error(`createAdoptionDraft: ${error.message}`)
  return rowToAdoption(data)
}

export async function applyAdoptionDraft(
  supabase: SupabaseClient,
  userId: string,
  adoptionId: string,
  finalConfig: GeneratedPersonalityConfig,
  templateId: string,
): Promise<void> {
  const { error: adoptError } = await supabase
    .from('chatbot_personality_adoptions')
    .update({ status: 'applied', applied_config: finalConfig })
    .eq('id', adoptionId)
    .eq('user_id', userId)
    .eq('status', 'draft')
  if (adoptError) throw new Error(`applyAdoptionDraft(adoption): ${adoptError.message}`)

  const { error: configError } = await supabase
    .from('chatbot_configs')
    .upsert(
      {
        user_id: userId,
        name: finalConfig.name,
        persona: finalConfig.persona,
        instructions: finalConfig.instructions,
        do_rules: finalConfig.doRules,
        dont_rules: finalConfig.dontRules,
        fallback_message: finalConfig.fallbackMessage,
        temperature: finalConfig.suggestedTemperature,
        active_template_id: templateId,
        personality_source: 'template',
      },
      { onConflict: 'user_id' },
    )
  if (configError) throw new Error(`applyAdoptionDraft(config): ${configError.message}`)
}

export async function revertToSnapshot(
  supabase: SupabaseClient,
  userId: string,
  adoptionId: string,
): Promise<void> {
  const { data, error: fetchError } = await supabase
    .from('chatbot_personality_adoptions')
    .select('source_snapshot')
    .eq('id', adoptionId)
    .eq('user_id', userId)
    .single()
  if (fetchError) throw new Error(`revertToSnapshot(fetch): ${fetchError.message}`)

  const snap = data.source_snapshot as Record<string, unknown>

  const { error: configError } = await supabase
    .from('chatbot_configs')
    .upsert(
      {
        user_id: userId,
        name: snap.name,
        persona: snap.persona,
        instructions: snap.instructions,
        do_rules: snap.do_rules,
        dont_rules: snap.dont_rules,
        fallback_message: snap.fallback_message,
        temperature: snap.temperature,
        max_context: snap.max_context,
        auto_classify_enabled: snap.auto_classify_enabled,
        active_template_id: snap.active_template_id ?? null,
        personality_source: snap.personality_source ?? 'custom',
      },
      { onConflict: 'user_id' },
    )
  if (configError) throw new Error(`revertToSnapshot(config): ${configError.message}`)

  await supabase
    .from('chatbot_personality_adoptions')
    .update({ status: 'reverted' })
    .eq('id', adoptionId)
    .eq('user_id', userId)
}

export async function getLatestAppliedAdoption(
  supabase: SupabaseClient,
  userId: string,
): Promise<PersonalityAdoption | null> {
  const { data, error } = await supabase
    .from('chatbot_personality_adoptions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'applied')
    .order('adopted_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`getLatestAppliedAdoption: ${error.message}`)
  return data ? rowToAdoption(data) : null
}

function rowToAdoption(row: Record<string, unknown>): PersonalityAdoption {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    templateId: row.template_id as string,
    status: row.status as PersonalityAdoption['status'],
    sourceSnapshot: row.source_snapshot as Record<string, unknown>,
    generatedConfig: row.generated_config as GeneratedPersonalityConfig,
    appliedConfig: (row.applied_config as GeneratedPersonalityConfig) ?? null,
    adaptationNotes: (row.adaptation_notes as string) ?? null,
    adoptedAt: row.adopted_at as string,
  }
}
