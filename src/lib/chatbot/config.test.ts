import { describe, it, expect, vi } from 'vitest'
import {
  MAX_PAUSE_AI_INSTRUCTIONS_LENGTH,
  MAX_VIRTUAL_SUBMISSION_INSTRUCTIONS_LENGTH,
  REPLY_MAX_TOKENS,
  REPLY_WITH_STRUCTURE_MAX_TOKENS,
  rowToConfig,
  upsertChatbotConfig,
  type ChatbotConfigRow,
} from './config'

const baseRow = (overrides: Partial<ChatbotConfigRow> = {}): ChatbotConfigRow => ({
  user_id: 'u1',
  name: 'Assistant',
  persona: 'p',
  instructions: 'do stuff',
  do_rules: ['a'],
  dont_rules: ['b'],
  fallback_message: 'fb',
  temperature: 0.4,
  max_context: 6,
  auto_classify_enabled: true,
  active_template_id: null,
  personality_source: 'custom',
  recommendation_rules: null,
  followup_settings: null,
  primary_action_page_id: null,
  pause_ai_instructions: 'pause when angry',
  virtual_submission_instructions: 'always note their contact number',
  human_takeover_minutes: 90,
  message_debounce_seconds: 6,
  created_at: '',
  updated_at: '',
  ...overrides,
})

// Regression guard: the reply token budget was once cut from 1600 -> 600/400
// as a cost optimization, which truncated longer replies mid-sentence (Graph
// delivers the cut text to the customer). You only pay for tokens actually
// generated, so a generous ceiling costs nothing on short replies. These floors
// stop a future cost pass from silently re-introducing the truncation.
describe('reply token budgets', () => {
  it('keeps the plain reply budget above the truncation floor', () => {
    expect(REPLY_MAX_TOKENS).toBeGreaterThanOrEqual(700)
  })

  it('gives the combined reply+structure call more headroom than the plain reply', () => {
    expect(REPLY_WITH_STRUCTURE_MAX_TOKENS).toBeGreaterThanOrEqual(900)
    expect(REPLY_WITH_STRUCTURE_MAX_TOKENS).toBeGreaterThan(REPLY_MAX_TOKENS)
  })
})

describe('rowToConfig — pause + takeover fields', () => {
  it('maps pause_ai_instructions and human_takeover_minutes', () => {
    const cfg = rowToConfig(baseRow())
    expect(cfg.pauseAiInstructions).toBe('pause when angry')
    expect(cfg.humanTakeoverMinutes).toBe(90)
  })

  it('defaults pauseAiInstructions to empty string when null/missing', () => {
    const cfg = rowToConfig(baseRow({ pause_ai_instructions: null as unknown as string }))
    expect(cfg.pauseAiInstructions).toBe('')
  })

  it('maps virtual_submission_instructions', () => {
    const cfg = rowToConfig(baseRow())
    expect(cfg.virtualSubmissionInstructions).toBe('always note their contact number')
  })

  it('defaults virtualSubmissionInstructions to empty string when null/missing', () => {
    const cfg = rowToConfig(
      baseRow({ virtual_submission_instructions: null as unknown as string }),
    )
    expect(cfg.virtualSubmissionInstructions).toBe('')
  })

  it('defaults humanTakeoverMinutes to 60 when null/missing', () => {
    const cfg = rowToConfig(baseRow({ human_takeover_minutes: null as unknown as number }))
    expect(cfg.humanTakeoverMinutes).toBe(60)
  })

  it('maps message_debounce_seconds', () => {
    const cfg = rowToConfig(baseRow({ message_debounce_seconds: 8 }))
    expect(cfg.messageDebounceSeconds).toBe(8)
  })

  it('defaults messageDebounceSeconds to 6 when null/missing', () => {
    const cfg = rowToConfig(baseRow({ message_debounce_seconds: null as unknown as number }))
    expect(cfg.messageDebounceSeconds).toBe(6)
  })

  it('clamps messageDebounceSeconds into the [0, 15] warm-worker window', () => {
    expect(rowToConfig(baseRow({ message_debounce_seconds: 99 })).messageDebounceSeconds).toBe(15)
    expect(rowToConfig(baseRow({ message_debounce_seconds: -4 })).messageDebounceSeconds).toBe(0)
  })
})

describe('upsertChatbotConfig — pause field persistence', () => {
  it('writes a trimmed pause_ai_instructions to the row', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const supabase = { from: vi.fn().mockReturnValue({ upsert }) } as never

    await upsertChatbotConfig(supabase, 'u1', {
      name: 'Assistant',
      persona: 'p',
      instructions: 'i',
      doRules: [],
      dontRules: [],
      fallbackMessage: 'fb',
      temperature: 0.4,
      maxContext: 6,
      pauseAiInstructions: '  pause if refund > 5000  ',
    })

    expect(upsert).toHaveBeenCalledTimes(1)
    const payload = upsert.mock.calls[0][0] as Record<string, unknown>
    expect(payload.pause_ai_instructions).toBe('pause if refund > 5000')
  })

  it('clamps pause_ai_instructions to the max length to bound prompt growth', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const supabase = { from: vi.fn().mockReturnValue({ upsert }) } as never

    await upsertChatbotConfig(supabase, 'u1', {
      name: 'Assistant',
      persona: 'p',
      instructions: 'i',
      doRules: [],
      dontRules: [],
      fallbackMessage: 'fb',
      temperature: 0.4,
      maxContext: 6,
      pauseAiInstructions: 'x'.repeat(5000),
    })

    const payload = upsert.mock.calls[0][0] as Record<string, string>
    expect(payload.pause_ai_instructions.length).toBe(MAX_PAUSE_AI_INSTRUCTIONS_LENGTH)
  })
})

describe('upsertChatbotConfig — virtual_submission_instructions persistence', () => {
  const baseInput = {
    name: 'Assistant',
    persona: 'p',
    instructions: 'i',
    doRules: [],
    dontRules: [],
    fallbackMessage: 'fb',
    temperature: 0.4,
    maxContext: 6,
    pauseAiInstructions: '',
  }

  it('writes trimmed virtual_submission_instructions to the row', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const supabase = { from: vi.fn().mockReturnValue({ upsert }) } as never

    await upsertChatbotConfig(supabase, 'u1', {
      ...baseInput,
      virtualSubmissionInstructions: '  note their contact number  ',
    })

    const payload = upsert.mock.calls[0][0] as Record<string, unknown>
    expect(payload.virtual_submission_instructions).toBe('note their contact number')
  })

  it('clamps virtual_submission_instructions to the max length', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const supabase = { from: vi.fn().mockReturnValue({ upsert }) } as never

    await upsertChatbotConfig(supabase, 'u1', {
      ...baseInput,
      virtualSubmissionInstructions: 'x'.repeat(5000),
    })

    const payload = upsert.mock.calls[0][0] as Record<string, string>
    expect(payload.virtual_submission_instructions.length).toBe(
      MAX_VIRTUAL_SUBMISSION_INSTRUCTIONS_LENGTH,
    )
  })

  it('omits the column entirely when not provided (preserves existing setting)', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const supabase = { from: vi.fn().mockReturnValue({ upsert }) } as never

    await upsertChatbotConfig(supabase, 'u1', baseInput)

    const payload = upsert.mock.calls[0][0] as Record<string, unknown>
    expect('virtual_submission_instructions' in payload).toBe(false)
  })
})

describe('upsertChatbotConfig — virtual_submission_mode persistence', () => {
  const baseInput = {
    name: 'Assistant',
    persona: 'p',
    instructions: 'i',
    doRules: [],
    dontRules: [],
    fallbackMessage: 'fb',
    temperature: 0.4,
    maxContext: 6,
    pauseAiInstructions: '',
  }

  it('writes a valid mode to the row', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const supabase = { from: vi.fn().mockReturnValue({ upsert }) } as never

    await upsertChatbotConfig(supabase, 'u1', { ...baseInput, virtualSubmissionMode: 'auto' })

    const payload = upsert.mock.calls[0][0] as Record<string, unknown>
    expect(payload.virtual_submission_mode).toBe('auto')
  })

  it('coerces an invalid mode to the default (suggest)', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const supabase = { from: vi.fn().mockReturnValue({ upsert }) } as never

    await upsertChatbotConfig(supabase, 'u1', { ...baseInput, virtualSubmissionMode: 'bogus' })

    const payload = upsert.mock.calls[0][0] as Record<string, unknown>
    expect(payload.virtual_submission_mode).toBe('suggest')
  })

  it('omits the column entirely when the mode is not provided (preserves existing setting)', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const supabase = { from: vi.fn().mockReturnValue({ upsert }) } as never

    await upsertChatbotConfig(supabase, 'u1', baseInput)

    const payload = upsert.mock.calls[0][0] as Record<string, unknown>
    expect('virtual_submission_mode' in payload).toBe(false)
  })
})
