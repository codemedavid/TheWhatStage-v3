import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_CHATBOT_PERSONA, type ChatbotPersona } from '@/lib/rag/prompt-builder'

export type ChatbotConfigRow = {
  user_id: string
  name: string
  persona: string
  do_rules: string[]
  dont_rules: string[]
  fallback_message: string
  temperature: number
  max_context: number
  auto_classify_enabled: boolean
  created_at: string
  updated_at: string
}

export type ChatbotConfig = ChatbotPersona & {
  temperature: number
  maxContext: number
  autoClassifyEnabled: boolean
}

export const DEFAULT_CHATBOT_CONFIG: ChatbotConfig = {
  ...DEFAULT_CHATBOT_PERSONA,
  temperature: 0.4,
  maxContext: 12,
  autoClassifyEnabled: false,
}

export function rowToConfig(row: ChatbotConfigRow): ChatbotConfig {
  return {
    name: row.name || DEFAULT_CHATBOT_CONFIG.name,
    persona: row.persona || DEFAULT_CHATBOT_CONFIG.persona,
    doRules: row.do_rules?.length ? row.do_rules : DEFAULT_CHATBOT_CONFIG.doRules,
    dontRules: row.dont_rules?.length ? row.dont_rules : DEFAULT_CHATBOT_CONFIG.dontRules,
    fallbackMessage: row.fallback_message || DEFAULT_CHATBOT_CONFIG.fallbackMessage,
    temperature: row.temperature ?? DEFAULT_CHATBOT_CONFIG.temperature,
    maxContext: row.max_context ?? DEFAULT_CHATBOT_CONFIG.maxContext,
    autoClassifyEnabled: row.auto_classify_enabled ?? DEFAULT_CHATBOT_CONFIG.autoClassifyEnabled,
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
