import { describe, expect, it } from 'vitest'
import {
  parseQualificationConfig,
  type QualificationConfig,
} from '@/app/a/[slug]/_kinds/qualification/schema'

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
})
