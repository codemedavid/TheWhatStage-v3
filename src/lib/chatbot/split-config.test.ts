import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CHATBOT_CONFIG,
  rowToConfig,
  MIN_SPLIT_MAX_BUBBLES,
  MAX_SPLIT_MAX_BUBBLES,
  type ChatbotConfigRow,
} from './config'
import { DEFAULT_SPLIT_MAX_BUBBLES } from './reply-segments'

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

describe('split-messages config', () => {
  it('defaults to disabled with the conservative bubble cap', () => {
    expect(DEFAULT_CHATBOT_CONFIG.splitMessagesEnabled).toBe(false)
    expect(DEFAULT_CHATBOT_CONFIG.splitMaxBubbles).toBe(DEFAULT_SPLIT_MAX_BUBBLES)
  })

  it('maps an enabled row through rowToConfig', () => {
    const cfg = rowToConfig(baseRow({ split_messages_enabled: true, split_max_bubbles: 4 }))
    expect(cfg.splitMessagesEnabled).toBe(true)
    expect(cfg.splitMaxBubbles).toBe(4)
  })

  it('treats a missing split flag on legacy rows as disabled', () => {
    const cfg = rowToConfig(baseRow({}))
    expect(cfg.splitMessagesEnabled).toBe(false)
    expect(cfg.splitMaxBubbles).toBe(DEFAULT_SPLIT_MAX_BUBBLES)
  })

  it('clamps the bubble cap into the allowed range', () => {
    expect(rowToConfig(baseRow({ split_max_bubbles: 99 })).splitMaxBubbles).toBe(
      MAX_SPLIT_MAX_BUBBLES,
    )
    expect(rowToConfig(baseRow({ split_max_bubbles: 1 })).splitMaxBubbles).toBe(
      MIN_SPLIT_MAX_BUBBLES,
    )
  })
})
