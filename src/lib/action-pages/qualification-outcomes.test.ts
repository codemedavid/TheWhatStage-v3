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
    const result = evaluateQualificationOutcome(config, {})
    expect(result.outcome).toBe('pending_review')
    expect(result.score).toBeNull()
    expect(result.missing_required).toEqual(['budget'])
  })

  it('matches answer_includes against multi-choice arrays', () => {
    const config = parseQualificationConfig({
      theme: {
        background_color: '#FFFFFF',
        accent_color: '#059669',
        button_text_color: '#FFFFFF',
      },
      progress_bar: true,
      questions: [
        {
          id: 'needs',
          prompt: 'Needs?',
          kind: 'multi_choice',
          required: true,
          weight: 1,
          options: [
            { label: 'Financing', value: 'financing', score: 1 },
            { label: 'Inspection', value: 'inspection', score: 1 },
          ],
        },
      ],
      scoring: { mode: 'rule_based', threshold: 3 },
      outcomes: [
        {
          id: 'inspection_requested',
          label: 'Inspection requested',
          outcome: 'inspection_requested',
          match: { kind: 'answer_includes', question_id: 'needs', value: 'inspection' },
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

    const result = evaluateQualificationOutcome(config, {
      needs: ['financing', 'inspection'],
    })

    expect(result.outcome).toBe('inspection_requested')
    expect(result.matchedOutcome.id).toBe('inspection_requested')
  })

  it('matches answer_equals against numeric rating values', () => {
    const config = parseQualificationConfig({
      theme: {
        background_color: '#FFFFFF',
        accent_color: '#059669',
        button_text_color: '#FFFFFF',
      },
      progress_bar: true,
      questions: [
        {
          id: 'urgency',
          prompt: 'Urgency?',
          kind: 'rating',
          required: true,
          weight: 1,
          rating_max: 5,
        },
      ],
      scoring: { mode: 'rule_based', threshold: 5 },
      outcomes: [
        {
          id: 'urgent',
          label: 'Urgent',
          outcome: 'urgent',
          match: { kind: 'answer_equals', question_id: 'urgency', value: 5 },
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

    const result = evaluateQualificationOutcome(config, { urgency: 5 })

    expect(result.outcome).toBe('urgent')
    expect(result.matchedOutcome.id).toBe('urgent')
  })

  it('returns synthetic pending review instead of first positive outcome when no conditions match', () => {
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
          prompt: 'Budget?',
          kind: 'single_choice',
          required: true,
          weight: 1,
          options: [{ label: 'Not ready', value: 'not_ready', score: 0 }],
        },
      ],
      scoring: { mode: 'rule_based', threshold: 10 },
      outcomes: [
        {
          id: 'qualified',
          label: 'Qualified',
          outcome: 'qualified',
          match: { kind: 'score_at_least', value: 10 },
          to_stage_id: null,
          messenger_text: '',
          attach_action_page_id: null,
          attach_cta_label: '',
          public_message: '',
        },
      ],
    })

    const result = evaluateQualificationOutcome(config, { budget: 'not_ready' })

    expect(result.outcome).toBe('pending_review')
    expect(result.matchedOutcome.id).toBe('pending_review')
    expect(result.score).toBe(0)
    expect(result.missing_required).toEqual([])
  })

  it('uses configured score_below fallback with non-disqualified outcome name when no conditions match', () => {
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
          prompt: 'Budget?',
          kind: 'single_choice',
          required: true,
          weight: 1,
          options: [{ label: 'Needs review', value: 'review', score: 5 }],
        },
      ],
      scoring: { mode: 'rule_based', threshold: 10 },
      outcomes: [
        {
          id: 'qualified',
          label: 'Qualified',
          outcome: 'qualified',
          match: { kind: 'score_at_least', value: 10 },
          to_stage_id: null,
          messenger_text: '',
          attach_action_page_id: null,
          attach_cta_label: '',
          public_message: '',
        },
        {
          id: 'low_score',
          label: 'Not fit',
          outcome: 'not_fit',
          match: { kind: 'score_below', value: 0 },
          to_stage_id: null,
          messenger_text: '',
          attach_action_page_id: null,
          attach_cta_label: '',
          public_message: '',
        },
      ],
    })

    const result = evaluateQualificationOutcome(config, { budget: 'review' })

    expect(result.outcome).toBe('not_fit')
    expect(result.matchedOutcome.id).toBe('low_score')
    expect(result.score).toBe(5)
  })

  it('uses configured not_fit outcome-string fallback when no conditions match', () => {
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
          prompt: 'Budget?',
          kind: 'single_choice',
          required: true,
          weight: 1,
          options: [{ label: 'Needs review', value: 'review', score: 5 }],
        },
      ],
      scoring: { mode: 'rule_based', threshold: 10 },
      outcomes: [
        {
          id: 'qualified',
          label: 'Qualified',
          outcome: 'qualified',
          match: { kind: 'score_at_least', value: 10 },
          to_stage_id: null,
          messenger_text: '',
          attach_action_page_id: null,
          attach_cta_label: '',
          public_message: '',
        },
        {
          id: 'fallback_not_fit',
          label: 'Not fit',
          outcome: 'not_fit',
          match: { kind: 'answer_equals', question_id: 'budget', value: 'impossible' },
          to_stage_id: null,
          messenger_text: '',
          attach_action_page_id: null,
          attach_cta_label: '',
          public_message: '',
        },
      ],
    })

    const result = evaluateQualificationOutcome(config, { budget: 'review' })

    expect(result.outcome).toBe('not_fit')
    expect(result.matchedOutcome.id).toBe('fallback_not_fit')
    expect(result.score).toBe(5)
  })

  it('manual review mode uses synthetic pending review instead of disqualified fallback', () => {
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
          prompt: 'Budget?',
          kind: 'single_choice',
          required: true,
          weight: 1,
          options: [{ label: 'Ready', value: 'ready', score: 5 }],
        },
      ],
      scoring: { mode: 'manual_review' },
      outcomes: [
        {
          id: 'fallback_not_fit',
          label: 'Not fit',
          outcome: 'not_fit',
          match: { kind: 'answer_equals', question_id: 'budget', value: 'impossible' },
          to_stage_id: null,
          messenger_text: '',
          attach_action_page_id: null,
          attach_cta_label: '',
          public_message: '',
        },
      ],
    })

    const result = evaluateQualificationOutcome(config, { budget: 'ready' })

    expect(result.outcome).toBe('pending_review')
    expect(result.matchedOutcome.id).toBe('pending_review')
    expect(result.score).toBeNull()
    expect(result.missing_required).toEqual([])
  })

  it('missing required answers use synthetic pending review instead of disqualified fallback', () => {
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
          prompt: 'Budget?',
          kind: 'single_choice',
          required: true,
          weight: 1,
          options: [{ label: 'Ready', value: 'ready', score: 5 }],
        },
      ],
      scoring: { mode: 'rule_based', threshold: 5 },
      outcomes: [
        {
          id: 'fallback_not_fit',
          label: 'Not fit',
          outcome: 'not_fit',
          match: { kind: 'answer_equals', question_id: 'budget', value: 'impossible' },
          to_stage_id: null,
          messenger_text: '',
          attach_action_page_id: null,
          attach_cta_label: '',
          public_message: '',
        },
      ],
    })

    const result = evaluateQualificationOutcome(config, {})

    expect(result.outcome).toBe('pending_review')
    expect(result.matchedOutcome.id).toBe('pending_review')
    expect(result.score).toBe(0)
    expect(result.missing_required).toEqual(['budget'])
  })

  it('manual review mode ignores disqualified-ish manual-review actions', () => {
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
          prompt: 'Budget?',
          kind: 'single_choice',
          required: true,
          weight: 1,
          options: [{ label: 'Ready', value: 'ready', score: 5 }],
        },
      ],
      scoring: { mode: 'manual_review' },
      outcomes: [
        {
          id: 'manual_not_fit',
          label: 'Not fit',
          outcome: 'not_fit',
          match: { kind: 'manual_review' },
          to_stage_id: null,
          messenger_text: '',
          attach_action_page_id: null,
          attach_cta_label: '',
          public_message: '',
        },
      ],
    })

    const result = evaluateQualificationOutcome(config, { budget: 'ready' })

    expect(result.outcome).toBe('pending_review')
    expect(result.matchedOutcome.id).toBe('pending_review')
    expect(result.score).toBeNull()
  })

  it('missing required answers ignore disqualified-ish manual-review actions', () => {
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
          prompt: 'Budget?',
          kind: 'single_choice',
          required: true,
          weight: 1,
          options: [{ label: 'Ready', value: 'ready', score: 5 }],
        },
      ],
      scoring: { mode: 'rule_based', threshold: 5 },
      outcomes: [
        {
          id: 'manual_not_fit',
          label: 'Not fit',
          outcome: 'not_fit',
          match: { kind: 'manual_review' },
          to_stage_id: null,
          messenger_text: '',
          attach_action_page_id: null,
          attach_cta_label: '',
          public_message: '',
        },
      ],
    })

    const result = evaluateQualificationOutcome(config, {})

    expect(result.outcome).toBe('pending_review')
    expect(result.matchedOutcome.id).toBe('pending_review')
    expect(result.score).toBe(0)
    expect(result.missing_required).toEqual(['budget'])
  })
})
