import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_CHATBOT_PERSONA, type ChatbotPersona } from '@/lib/rag/prompt-builder'

export interface ActionPageRecommendationRules {
  rules: string
  requiredSlots: string[]
  confidenceThreshold: number
}

export interface RecommendationRulesMap {
  defaultConfidenceThreshold: number
  perActionPage: Record<string, ActionPageRecommendationRules>
}

export const DEFAULT_RECOMMENDATION_RULES: RecommendationRulesMap = {
  defaultConfidenceThreshold: 0.55,
  perActionPage: {},
}

export type ChatbotConfigRow = {
  user_id: string
  name: string
  persona: string
  instructions: string
  do_rules: string[]
  dont_rules: string[]
  fallback_message: string
  temperature: number
  max_context: number
  auto_classify_enabled: boolean
  active_template_id: string | null
  personality_source: string
  recommendation_rules: unknown
  primary_action_page_id: string | null
  created_at: string
  updated_at: string
}

export type ChatbotConfig = ChatbotPersona & {
  temperature: number
  maxContext: number
  autoClassifyEnabled: boolean
  activeTemplateId: string | null
  personalitySource: 'custom' | 'template'
  recommendationRules: RecommendationRulesMap
  primaryActionPageId: string | null
  updatedAt: string
}

export const DEFAULT_CHATBOT_CONFIG: ChatbotConfig = {
  ...DEFAULT_CHATBOT_PERSONA,
  temperature: 0.4,
  maxContext: 12,
  autoClassifyEnabled: true,
  activeTemplateId: null,
  personalitySource: 'custom',
  recommendationRules: DEFAULT_RECOMMENDATION_RULES,
  primaryActionPageId: null,
  updatedAt: '',
}

export function parseRecommendationRules(raw: unknown): RecommendationRulesMap {
  if (!raw || typeof raw !== 'object') return DEFAULT_RECOMMENDATION_RULES
  const r = raw as { default_confidence_threshold?: unknown; per_action_page?: unknown }
  const threshold =
    typeof r.default_confidence_threshold === 'number' &&
    r.default_confidence_threshold >= 0 &&
    r.default_confidence_threshold <= 1
      ? r.default_confidence_threshold
      : DEFAULT_RECOMMENDATION_RULES.defaultConfidenceThreshold

  const perPage: Record<string, ActionPageRecommendationRules> = {}
  const map = r.per_action_page
  if (map && typeof map === 'object') {
    for (const [pageId, val] of Object.entries(map)) {
      if (!val || typeof val !== 'object') continue
      const v = val as { rules?: unknown; required_slots?: unknown; confidence_threshold?: unknown }
      const rules = typeof v.rules === 'string' ? v.rules.trim() : ''
      const requiredSlots = Array.isArray(v.required_slots)
        ? v.required_slots
            .map((s) => (typeof s === 'string' ? s.trim() : ''))
            .filter((s): s is string => !!s)
        : []
      const conf =
        typeof v.confidence_threshold === 'number' &&
        v.confidence_threshold >= 0 &&
        v.confidence_threshold <= 1
          ? v.confidence_threshold
          : threshold
      if (rules) perPage[pageId] = { rules, requiredSlots, confidenceThreshold: conf }
    }
  }
  return { defaultConfidenceThreshold: threshold, perActionPage: perPage }
}

export function getActionPageRecommendationRules(
  config: ChatbotConfig,
  actionPageId: string | null | undefined,
): ActionPageRecommendationRules | null {
  if (!actionPageId) return null
  return config.recommendationRules.perActionPage[actionPageId] ?? null
}

export function rowToConfig(row: ChatbotConfigRow): ChatbotConfig {
  return {
    name: row.name || DEFAULT_CHATBOT_CONFIG.name,
    persona: row.persona || DEFAULT_CHATBOT_CONFIG.persona,
    instructions: row.instructions ?? '',
    doRules: row.do_rules?.length ? row.do_rules : DEFAULT_CHATBOT_CONFIG.doRules,
    dontRules: row.dont_rules?.length ? row.dont_rules : DEFAULT_CHATBOT_CONFIG.dontRules,
    fallbackMessage: row.fallback_message || DEFAULT_CHATBOT_CONFIG.fallbackMessage,
    temperature: row.temperature ?? DEFAULT_CHATBOT_CONFIG.temperature,
    maxContext: row.max_context ?? DEFAULT_CHATBOT_CONFIG.maxContext,
    autoClassifyEnabled: row.auto_classify_enabled ?? DEFAULT_CHATBOT_CONFIG.autoClassifyEnabled,
    activeTemplateId: row.active_template_id ?? null,
    personalitySource: (row.personality_source as ChatbotConfig['personalitySource']) ?? 'custom',
    recommendationRules: parseRecommendationRules(row.recommendation_rules),
    primaryActionPageId: row.primary_action_page_id ?? null,
    updatedAt: row.updated_at ?? '',
  }
}

export async function getChatbotConfig(
  supabase: SupabaseClient,
  userId: string,
): Promise<ChatbotConfig> {
  const { data, error } = await supabase
    .from('chatbot_configs')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle<ChatbotConfigRow>()
  if (error) throw new Error(`getChatbotConfig: ${error.message}`)
  if (!data) return DEFAULT_CHATBOT_CONFIG
  return rowToConfig(data)
}

export type ChatbotConfigInput = {
  name: string
  persona: string
  instructions: string
  doRules: string[]
  dontRules: string[]
  fallbackMessage: string
  temperature: number
  maxContext: number
  autoClassifyEnabled: boolean
}

export async function upsertChatbotConfig(
  supabase: SupabaseClient,
  userId: string,
  input: ChatbotConfigInput,
): Promise<void> {
  const { error } = await supabase.from('chatbot_configs').upsert(
    {
      user_id: userId,
      name: input.name.trim() || DEFAULT_CHATBOT_CONFIG.name,
      persona: input.persona.trim(),
      instructions: input.instructions.trim(),
      do_rules: input.doRules.map((s) => s.trim()).filter(Boolean),
      dont_rules: input.dontRules.map((s) => s.trim()).filter(Boolean),
      fallback_message: input.fallbackMessage.trim() || DEFAULT_CHATBOT_CONFIG.fallbackMessage,
      temperature: clamp(input.temperature, 0, 1),
      max_context: clamp(Math.round(input.maxContext), 1, 40),
      auto_classify_enabled: !!input.autoClassifyEnabled,
    },
    { onConflict: 'user_id' },
  )
  if (error) throw new Error(`upsertChatbotConfig: ${error.message}`)
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, n))
}

export async function setPrimaryActionPageId(
  supabase: SupabaseClient,
  userId: string,
  actionPageId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('chatbot_configs')
    .upsert(
      { user_id: userId, primary_action_page_id: actionPageId },
      { onConflict: 'user_id' },
    )
  if (error) throw new Error(`setPrimaryActionPageId: ${error.message}`)
}
