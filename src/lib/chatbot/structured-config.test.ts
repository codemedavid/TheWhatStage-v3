import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CHATBOT_CONFIG,
  rowToConfig,
  MIN_REPLY_MAX_SENTENCES,
  MAX_REPLY_MAX_SENTENCES,
  DEFAULT_REPLY_MAX_SENTENCES,
  coerceStructuredLayout,
  type ChatbotConfigRow,
} from './config'

const baseRow = (over: Partial<ChatbotConfigRow>): ChatbotConfigRow =>
  ({
    user_id: 'u1',
    name: 'Bot',
    persona: 'p',
    instructions: '',
    do_rules: [],
    dont_rules: [],
    fallback_message: 'fb',
    temperature: 0.4,
    max_context: 6,
    auto_classify_enabled: true,
    active_template_id: null,
    personality_source: 'custom',
    recommendation_rules: null,
    followup_settings: null,
    primary_action_page_id: null,
    pause_ai_instructions: '',
    human_takeover_minutes: 60,
    message_debounce_seconds: 6,
    created_at: '',
    updated_at: '',
    ...over,
  }) as ChatbotConfigRow

describe('structured-messages config', () => {
  it('ships structured OFF, single layout, with the length limit ON at the default cap', () => {
    expect(DEFAULT_CHATBOT_CONFIG.structuredMessagesEnabled).toBe(false)
    expect(DEFAULT_CHATBOT_CONFIG.structuredMessageLayout).toBe('single')
    expect(DEFAULT_CHATBOT_CONFIG.replyLengthLimitEnabled).toBe(true)
    expect(DEFAULT_CHATBOT_CONFIG.replyMaxSentences).toBe(DEFAULT_REPLY_MAX_SENTENCES)
  })

  it('maps an enabled bubbles row through rowToConfig', () => {
    const cfg = rowToConfig(
      baseRow({ structured_messages_enabled: true, structured_message_layout: 'bubbles' }),
    )
    expect(cfg.structuredMessagesEnabled).toBe(true)
    expect(cfg.structuredMessageLayout).toBe('bubbles')
  })

  it('treats missing structured fields on legacy rows as OFF / single', () => {
    const cfg = rowToConfig(baseRow({}))
    expect(cfg.structuredMessagesEnabled).toBe(false)
    expect(cfg.structuredMessageLayout).toBe('single')
  })

  it('coerces an unknown layout value to single', () => {
    expect(coerceStructuredLayout('bubbles')).toBe('bubbles')
    expect(coerceStructuredLayout('single')).toBe('single')
    expect(coerceStructuredLayout('garbage')).toBe('single')
    expect(coerceStructuredLayout(null)).toBe('single')
  })

  it('maps reply-length fields, treating a missing limit flag as ON', () => {
    const on = rowToConfig(baseRow({ reply_length_limit_enabled: true, reply_max_sentences: 3 }))
    expect(on.replyLengthLimitEnabled).toBe(true)
    expect(on.replyMaxSentences).toBe(3)

    const off = rowToConfig(baseRow({ reply_length_limit_enabled: false }))
    expect(off.replyLengthLimitEnabled).toBe(false)

    const legacy = rowToConfig(baseRow({}))
    expect(legacy.replyLengthLimitEnabled).toBe(true)
    expect(legacy.replyMaxSentences).toBe(DEFAULT_REPLY_MAX_SENTENCES)
  })

  it('clamps reply_max_sentences into the allowed range', () => {
    expect(rowToConfig(baseRow({ reply_max_sentences: 99 })).replyMaxSentences).toBe(
      MAX_REPLY_MAX_SENTENCES,
    )
    expect(rowToConfig(baseRow({ reply_max_sentences: 0 })).replyMaxSentences).toBe(
      MIN_REPLY_MAX_SENTENCES,
    )
  })
})
