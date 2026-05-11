import { describe, expect, it } from 'vitest'
import {
  parseQualificationConfig,
  type QualificationConfig,
} from '@/app/a/[slug]/_kinds/qualification/schema'
import { evaluateQualificationOutcome } from './qualification-outcomes'

describe('parseQualificationConfig outcome normalization', () => {
  it('derives default outcome actions from legacy threshold scoring', () => {
    const config = parseQualificationConfig({
      theme: {
        background_color: '#FFFFFF',
        accent_color: '#059669',
        button_text_color: '#FFFFFF',
      },
      progress_bar: true,
      questions: [],
      scoring: {
        mode: 'rule_based',
        threshold: 3,
        qualified_outcome: 'hot_lead',
        disqualified_outcome: 'not_fit',
      },
    })

    expect(config.outcomes.map((o) => o.outcome)).toEqual([
      'hot_lead',
      'not_fit',
      'pending_review',
    ])
    expect(config.outcomes[0]).toMatchObject({
      id: 'qualified',
      label: 'Qualified',
      match: { kind: 'score_at_least', value: 3 },
    })
    expect(config.outcomes[1]).toMatchObject({
      id: 'disqualified',
      label: 'Not qualified',
      match: { kind: 'score_below', value: 3 },
    })
  })

  it('keeps configured outcome actions in order', () => {
    const config = parseQualificationConfig({
      theme: {
        background_color: '#FFFFFF',
        accent_color: '#059669',
        button_text_color: '#FFFFFF',
      },
      progress_bar: true,
      questions: [],
      scoring: { mode: 'rule_based', threshold: 1 },
      outcomes: [
        {
          id: 'finance_needed',
          label: 'Needs financing',
          outcome: 'needs_financing',
          match: { kind: 'answer_equals', question_id: 'budget', value: 'finance' },
          to_stage_id: null,
          messenger_text: 'We can help with financing options.',
          attach_action_page_id: '00000000-0000-0000-0000-000000000001',
          attach_cta_label: 'See options',
          public_message: 'Thanks. We sent financing options in Messenger.',
        },
      ],
    } satisfies Partial<QualificationConfig>)

    expect(config.outcomes).toHaveLength(1)
    expect(config.outcomes[0]?.outcome).toBe('needs_financing')
    expect(config.outcomes[0]?.attach_cta_label).toBe('See options')
  })

  it('drops malformed outcome actions without losing valid questions or scoring', () => {
    const config = parseQualificationConfig({
      theme: {
        background_color: '#FFFFFF',
        accent_color: '#059669',
        button_text_color: '#FFFFFF',
      },
      progress_bar: true,
      questions: [
        {
          id: 'budget',
          prompt: 'What is your budget?',
          kind: 'single_choice',
          required: true,
          options: [{ label: 'Ready', value: 'ready', score: 2 }],
        },
      ],
      scoring: {
        mode: 'rule_based',
        threshold: 2,
        qualified_outcome: 'ready',
        disqualified_outcome: 'not_ready',
      },
      outcomes: [
        {
          id: '',
          label: '',
          outcome: '',
          match: { kind: 'answer_equals', question_id: '', value: 'ready' },
        },
      ],
    })

    expect(config.questions).toHaveLength(1)
    expect(config.questions[0]?.id).toBe('budget')
    expect(config.scoring).toMatchObject({
      threshold: 2,
      qualified_outcome: 'ready',
      disqualified_outcome: 'not_ready',
    })
    expect(config.outcomes.map((o) => o.outcome)).toEqual([
      'ready',
      'not_ready',
      'pending_review',
    ])
    expect(config.outcomes[0]?.match).toEqual({ kind: 'score_at_least', value: 2 })
  })

  it('derives default outcome actions with legacy zero threshold when omitted', () => {
    const config = parseQualificationConfig({
      theme: {
        background_color: '#FFFFFF',
        accent_color: '#059669',
        button_text_color: '#FFFFFF',
      },
      progress_bar: true,
      questions: [],
      scoring: {
        mode: 'rule_based',
        qualified_outcome: 'qualified',
        disqualified_outcome: 'disqualified',
      },
    })

    expect(config.outcomes[0]?.match).toEqual({ kind: 'score_at_least', value: 0 })
    expect(config.outcomes[1]?.match).toEqual({ kind: 'score_below', value: 0 })
  })
})

describe('evaluateQualificationOutcome', () => {
  const baseConfig = parseQualificationConfig({
    theme: {
      background_color: '#FFFFFF',
      accent_color: '#059669',
      button_text_color: '#FFFFFF',
    },
    progress_bar: true,
    questions: [
      {
        id: 'budget',
        prompt: 'Budget?',
        kind: 'single_choice',
        required: true,
        weight: 1,
        options: [
          { label: 'Ready', value: 'ready', score: 5 },
          { label: 'Needs financing', value: 'finance', score: 1 },
        ],
      },
    ],
    scoring: { mode: 'rule_based', threshold: 3 },
    outcomes: [
      {
        id: 'finance_needed',
        label: 'Needs financing',
        outcome: 'needs_financing',
        match: { kind: 'answer_equals', question_id: 'budget', value: 'finance' },
        to_stage_id: null,
        messenger_text: '',
        attach_action_page_id: null,
        attach_cta_label: '',
        public_message: '',
      },
      {
        id: 'qualified',
        label: 'Qualified',
        outcome: 'qualified',
        match: { kind: 'score_at_least', value: 3 },
        to_stage_id: null,
        messenger_text: '',
        attach_action_page_id: null,
        attach_cta_label: '',
        public_message: '',
      },
      {
        id: 'disqualified',
        label: 'Not qualified',
        outcome: 'disqualified',
        match: { kind: 'score_below', value: 3 },
        to_stage_id: null,
        messenger_text: '',
        attach_action_page_id: null,
        attach_cta_label: '',
        public_message: '',
      },
      {
        id: 'pending_review',
        label: 'Needs review',
        outcome: 'pending_review',
        match: { kind: 'manual_review' },
        to_stage_id: null,
        messenger_text: '',
        attach_action_page_id: null,
        attach_cta_label: '',
        public_message: '',
      },
    ],
  })

  it('uses first matching answer condition before score outcomes', () => {
    const result = evaluateQualificationOutcome(baseConfig, { budget: 'finance' })
    expect(result.outcome).toBe('needs_financing')
    expect(result.score).toBe(1)
    expect(result.matchedOutcome.id).toBe('finance_needed')
  })

  it('uses score outcomes when answer conditions do not match', () => {
    const result = evaluateQualificationOutcome(baseConfig, { budget: 'ready' })
    expect(result.outcome).toBe('qualified')
    expect(result.score).toBe(5)
    expect(result.missing_required).toEqual([])
  })

  it('routes missing required answers to pending review', () => {
    const result = evaluateQualificationOutcome(baseConfig, {})
    expect(result.outcome).toBe('pending_review')
    expect(result.missing_required).toEqual(['budget'])
  })

  it('manual review mode always returns the manual-review outcome', () => {
    const config = parseQualificationConfig({
      ...baseConfig,
      scoring: { mode: 'manual_review' },
    })
    const result = evaluateQualificationOutcome(config, { budget: 'ready' })
    expect(result.outcome).toBe('pending_review')
    expect(result.score).toBeNull()
  })
})
