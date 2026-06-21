import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_CHATBOT_PERSONA, type ChatbotPersona } from '@/lib/rag/prompt-builder'
import {
  DEFAULT_FOLLOWUP_SETTINGS,
  FOLLOWUP_SETTINGS_SCHEMA,
  type FollowupSettings,
} from '@/lib/followups/settings'

export interface ActionPageRecommendationRules {
  rules: string
  requiredSlots: string[]
  confidenceThreshold: number
}

export interface RecommendationRulesMap {
  defaultConfidenceThreshold: number
  perActionPage: Record<string, ActionPageRecommendationRules>
}

/** Upper bound on stored pause-rule text — bounds per-turn prompt growth.
 *  Pause rules are short by nature; this is a generous ceiling, not a target. */
export const MAX_PAUSE_AI_INSTRUCTIONS_LENGTH = 2000

/**
 * Output-token ceilings for customer-reply generation.
 *
 * These were once cut to 600/400 as a cost optimization ("the old 1600 ceiling
 * was 4× what we ever actually emit"), which truncated longer replies
 * mid-sentence — and Graph delivers the cut text to the customer, so the lead
 * sees a message that stops abruptly. Output is billed per token actually
 * generated, so a generous ceiling costs nothing on the common short reply and
 * only spends more on the exact turns that need the room. The send layer chunks
 * anything past Messenger's 2000-char limit, so a fuller reply still arrives.
 *
 * REPLY_MAX_TOKENS               — plain reply generation (answer() + fallback).
 * REPLY_WITH_STRUCTURE_MAX_TOKENS — combined call whose JSON also carries
 *   stage_change / action_page / recommend_* fields, so it needs more headroom
 *   than the reply text alone (and a truncated JSON here fails to parse, costing
 *   a second fallback LLM call).
 */
export const REPLY_MAX_TOKENS = 800
export const REPLY_WITH_STRUCTURE_MAX_TOKENS = 1024

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
  followup_settings: unknown
  primary_action_page_id: string | null
  pause_ai_instructions: string
  human_takeover_minutes: number
  /** Quiet-window (seconds) the webhook waits before the bot replies, so a
   *  burst of rapid customer messages is coalesced into one reply. 0 = off. */
  message_debounce_seconds: number
  /** How the bot reacts to detected proceed-intent: 'off'|'suggest'|'auto'.
   *  Optional: older rows / partial selects may omit it (coerced to 'suggest'). */
  virtual_submission_mode?: string | null
  created_at: string
  updated_at: string
}

/** How the bot reacts to a detected proceed-intent in chat (see
 *  virtual-submission.ts). Defined here because it is a per-tenant config value.
 *  - off     = never record a chat-implied submission
 *  - suggest = record the submission as an operator review flag (no stage move)
 *  - auto    = record AND advance the lead's stage forward */
export type VirtualSubmissionMode = 'off' | 'suggest' | 'auto'

export function coerceVirtualSubmissionMode(raw: unknown): VirtualSubmissionMode {
  return raw === 'off' || raw === 'suggest' || raw === 'auto' ? raw : 'suggest'
}

export type ChatbotConfig = ChatbotPersona & {
  temperature: number
  maxContext: number
  autoClassifyEnabled: boolean
  activeTemplateId: string | null
  personalitySource: 'custom' | 'template'
  recommendationRules: RecommendationRulesMap
  followupSettings: FollowupSettings
  primaryActionPageId: string | null
  /** Pause-window duration (minutes) reused for AI self-pause handoffs. */
  humanTakeoverMinutes: number
  /** Quiet-window (seconds) before the bot replies, coalescing rapid bursts. */
  messageDebounceSeconds: number
  /** How the bot reacts to detected proceed-intent in chat. */
  virtualSubmissionMode: VirtualSubmissionMode
  updatedAt: string
}

/** Max debounce window. Kept below the worker's DRAIN_WAIT_MAX_MS (20s) so a
 *  warm worker still picks the job up without falling through to the 1-min cron. */
export const MAX_MESSAGE_DEBOUNCE_SECONDS = 15
export const DEFAULT_MESSAGE_DEBOUNCE_SECONDS = 6

export const DEFAULT_CHATBOT_CONFIG: ChatbotConfig = {
  ...DEFAULT_CHATBOT_PERSONA,
  temperature: 0.4,
  // Trimmed from 20 → 6. Each retrieved chunk is up to ~1024 tokens, so the
  // old default could spend ~20k prompt tokens just on context. 6 covers the
  // top-quality grader output for the typical Filipino SMB knowledge base
  // without bleeding into ambiguous fillers. Existing per-user stored values
  // are unaffected — this only changes the fallback for new configs.
  maxContext: 6,
  autoClassifyEnabled: true,
  activeTemplateId: null,
  personalitySource: 'custom',
  recommendationRules: DEFAULT_RECOMMENDATION_RULES,
  followupSettings: DEFAULT_FOLLOWUP_SETTINGS,
  primaryActionPageId: null,
  // Mirrors the DB default in 20260604000000_human_takeover.sql.
  humanTakeoverMinutes: 60,
  messageDebounceSeconds: DEFAULT_MESSAGE_DEBOUNCE_SECONDS,
  virtualSubmissionMode: 'suggest',
  updatedAt: '',
}

export function parseRecommendationRules(raw: unknown): RecommendationRulesMap {
  if (!raw || typeof raw !== 'object') return DEFAULT_RECOMMENDATION_RULES
  // Accept BOTH key casings. The onboarding writer (saveFlowAction) historically
  // persisted camelCase (`per_action_page` → `perActionPage`, `required_slots`
  // → `requiredSlots`, etc.), while this parser was written for snake_case. The
  // mismatch silently dropped every configured rule, which disabled the
  // `recommend_*` routing entirely (the bot would describe products/properties
  // in prose instead of sending the card). Reading both casings recovers all
  // already-saved rows without a migration.
  const r = raw as {
    default_confidence_threshold?: unknown
    defaultConfidenceThreshold?: unknown
    per_action_page?: unknown
    perActionPage?: unknown
  }
  const rawThreshold =
    typeof r.default_confidence_threshold === 'number'
      ? r.default_confidence_threshold
      : typeof r.defaultConfidenceThreshold === 'number'
        ? r.defaultConfidenceThreshold
        : undefined
  const threshold =
    typeof rawThreshold === 'number' && rawThreshold >= 0 && rawThreshold <= 1
      ? rawThreshold
      : DEFAULT_RECOMMENDATION_RULES.defaultConfidenceThreshold

  const perPage: Record<string, ActionPageRecommendationRules> = {}
  const map = r.per_action_page ?? r.perActionPage
  if (map && typeof map === 'object') {
    for (const [pageId, val] of Object.entries(map)) {
      if (!val || typeof val !== 'object') continue
      const v = val as {
        rules?: unknown
        required_slots?: unknown
        requiredSlots?: unknown
        confidence_threshold?: unknown
        confidenceThreshold?: unknown
      }
      const rules = typeof v.rules === 'string' ? v.rules.trim() : ''
      const slotsRaw = Array.isArray(v.required_slots)
        ? v.required_slots
        : Array.isArray(v.requiredSlots)
          ? v.requiredSlots
          : []
      const requiredSlots = slotsRaw
        .map((s) => (typeof s === 'string' ? s.trim() : ''))
        .filter((s): s is string => !!s)
      const confRaw =
        typeof v.confidence_threshold === 'number'
          ? v.confidence_threshold
          : typeof v.confidenceThreshold === 'number'
            ? v.confidenceThreshold
            : undefined
      const conf =
        typeof confRaw === 'number' && confRaw >= 0 && confRaw <= 1 ? confRaw : threshold
      if (rules) perPage[pageId] = { rules, requiredSlots, confidenceThreshold: conf }
    }
  }
  return { defaultConfidenceThreshold: threshold, perActionPage: perPage }
}

export function parseFollowupSettings(raw: unknown): FollowupSettings {
  const parsed = FOLLOWUP_SETTINGS_SCHEMA.safeParse(raw)
  return parsed.success ? parsed.data : DEFAULT_FOLLOWUP_SETTINGS
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
    pauseAiInstructions: row.pause_ai_instructions ?? '',
    humanTakeoverMinutes: row.human_takeover_minutes ?? DEFAULT_CHATBOT_CONFIG.humanTakeoverMinutes,
    messageDebounceSeconds: clamp(
      Math.round(row.message_debounce_seconds ?? DEFAULT_MESSAGE_DEBOUNCE_SECONDS),
      0,
      MAX_MESSAGE_DEBOUNCE_SECONDS,
    ),
    doRules: row.do_rules?.length ? row.do_rules : DEFAULT_CHATBOT_CONFIG.doRules,
    dontRules: row.dont_rules?.length ? row.dont_rules : DEFAULT_CHATBOT_CONFIG.dontRules,
    fallbackMessage: row.fallback_message || DEFAULT_CHATBOT_CONFIG.fallbackMessage,
    temperature: row.temperature ?? DEFAULT_CHATBOT_CONFIG.temperature,
    maxContext: row.max_context ?? DEFAULT_CHATBOT_CONFIG.maxContext,
    autoClassifyEnabled: row.auto_classify_enabled ?? DEFAULT_CHATBOT_CONFIG.autoClassifyEnabled,
    activeTemplateId: row.active_template_id ?? null,
    personalitySource: (row.personality_source as ChatbotConfig['personalitySource']) ?? 'custom',
    recommendationRules: parseRecommendationRules(row.recommendation_rules),
    followupSettings: parseFollowupSettings(row.followup_settings),
    primaryActionPageId: row.primary_action_page_id ?? null,
    virtualSubmissionMode: coerceVirtualSubmissionMode(row.virtual_submission_mode),
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
  pauseAiInstructions: string
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
      pause_ai_instructions: input.pauseAiInstructions.trim().slice(0, MAX_PAUSE_AI_INSTRUCTIONS_LENGTH),
      do_rules: input.doRules.map((s) => s.trim()).filter(Boolean),
      dont_rules: input.dontRules.map((s) => s.trim()).filter(Boolean),
      fallback_message: input.fallbackMessage.trim() || DEFAULT_CHATBOT_CONFIG.fallbackMessage,
      temperature: clamp(input.temperature, 0, 1),
      max_context: clamp(Math.round(input.maxContext), 1, 40),
    },
    { onConflict: 'user_id' },
  )
  if (error) throw new Error(`upsertChatbotConfig: ${error.message}`)
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, n))
}

export async function setAutoClassifyEnabled(
  supabase: SupabaseClient,
  userId: string,
  enabled: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('chatbot_configs')
    .upsert(
      { user_id: userId, auto_classify_enabled: !!enabled },
      { onConflict: 'user_id' },
    )
  if (error) throw new Error(`setAutoClassifyEnabled: ${error.message}`)
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
