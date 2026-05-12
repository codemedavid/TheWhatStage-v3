import { describe, it, expect } from 'vitest'
import { scoreQualification } from './qualification.score'
import { parseSubmission } from '../dispatch'
import './qualification' // side-effect: registers the qualification handler
import type { QualificationConfig } from '@/app/a/[slug]/_kinds/qualification/schema'

const baseConfig: QualificationConfig = {
  theme: {
    background_color: '#FFFFFF',
    accent_color: '#059669',
    button_text_color: '#FFFFFF',
  },
  progress_bar: true,
  questions: [],
  scoring: {
    mode: 'rule_based',
    threshold: 1,
    qualified_outcome: 'qualified',
    disqualified_outcome: 'disqualified',
  },
  outcomes: [],
}

describe('scoreQualification', () => {
  it('sums single_choice option scores', () => {
    const cfg: QualificationConfig = {
      ...baseConfig,
      questions: [
        {
          id: 'q1',
          prompt: 'A?',
          kind: 'single_choice',
          required: false,
          weight: 1,
          options: [
            { label: 'Yes', value: 'yes', score: 5 },
            { label: 'No', value: 'no', score: 0 },
          ],
        },
      ],
    }
    expect(scoreQualification(cfg, { q1: 'yes' }).score).toBe(5)
    expect(scoreQualification(cfg, { q1: 'no' }).score).toBe(0)
  })

  it('sums all selected scores for multi_choice', () => {
    const cfg: QualificationConfig = {
      ...baseConfig,
      questions: [
        {
          id: 'q1',
          prompt: 'Pick all that apply',
          kind: 'multi_choice',
          required: false,
          weight: 1,
          options: [
            { label: 'A', value: 'a', score: 2 },
            { label: 'B', value: 'b', score: 3 },
            { label: 'C', value: 'c', score: 5 },
          ],
        },
      ],
    }
    expect(scoreQualification(cfg, { q1: ['a', 'b'] }).score).toBe(5)
    expect(scoreQualification(cfg, { q1: ['a', 'b', 'c'] }).score).toBe(10)
  })

  it('uses rating value × weight', () => {
    const cfg: QualificationConfig = {
      ...baseConfig,
      questions: [
        {
          id: 'q1',
          prompt: 'Rate 1-5',
          kind: 'rating',
          required: false,
          weight: 2,
          rating_max: 5,
        },
      ],
    }
    expect(scoreQualification(cfg, { q1: 4 }).score).toBe(8)
  })

  it('applies weight to choice scores', () => {
    const cfg: QualificationConfig = {
      ...baseConfig,
      questions: [
        {
          id: 'q1',
          prompt: 'A?',
          kind: 'single_choice',
          required: false,
          weight: 3,
          options: [{ label: 'Yes', value: 'yes', score: 2 }],
        },
      ],
    }
    expect(scoreQualification(cfg, { q1: 'yes' }).score).toBe(6)
  })

  it('reports missing required questions', () => {
    const cfg: QualificationConfig = {
      ...baseConfig,
      questions: [
        {
          id: 'q1',
          prompt: 'A?',
          kind: 'short_text',
          required: true,
          weight: 1,
        },
        {
          id: 'q2',
          prompt: 'B?',
          kind: 'single_choice',
          required: true,
          weight: 1,
          options: [{ label: 'Yes', value: 'yes', score: 1 }],
        },
      ],
    }
    const r = scoreQualification(cfg, { q2: 'yes' })
    expect(r.missing_required).toEqual(['q1'])
    expect(r.score).toBe(1)
  })

  it('treats short_text as zero contribution', () => {
    const cfg: QualificationConfig = {
      ...baseConfig,
      questions: [
        {
          id: 'q1',
          prompt: 'Tell us more',
          kind: 'short_text',
          required: false,
          weight: 5,
        },
      ],
    }
    expect(scoreQualification(cfg, { q1: 'lots of text' }).score).toBe(0)
  })
})

describe('qualification handler', () => {
  it('short-circuits with pending_review in manual_review mode', () => {
    const cfg: QualificationConfig = {
      ...baseConfig,
      scoring: { mode: 'manual_review' },
      questions: [
        {
          id: 'q1',
          prompt: 'A?',
          kind: 'single_choice',
          required: false,
          weight: 1,
          options: [{ label: 'Yes', value: 'yes', score: 5 }],
        },
      ],
    }
    const result = parseSubmission(
      'qualification',
      { answers: JSON.stringify({ q1: 'yes' }) },
      cfg as unknown as Record<string, unknown>,
    )
    expect(result.outcome).toBe('pending_review')
    expect(result.data.score).toBeNull()
    expect(result.data.answers).toEqual([
      {
        questionId: 'q1',
        prompt: 'A?',
        kind: 'single_choice',
        value: 'yes',
        display: 'Yes',
      },
    ])
  })

  it('returns qualified when score >= threshold', () => {
    const cfg: QualificationConfig = {
      ...baseConfig,
      scoring: { mode: 'rule_based', threshold: 5 },
      questions: [
        {
          id: 'q1',
          prompt: 'A?',
          kind: 'single_choice',
          required: false,
          weight: 1,
          options: [
            { label: 'Yes', value: 'yes', score: 5 },
            { label: 'No', value: 'no', score: 0 },
          ],
        },
      ],
    }
    const yes = parseSubmission(
      'qualification',
      { answers: JSON.stringify({ q1: 'yes' }) },
      cfg as unknown as Record<string, unknown>,
    )
    expect(yes.outcome).toBe('qualified')
    const no = parseSubmission(
      'qualification',
      { answers: JSON.stringify({ q1: 'no' }) },
      cfg as unknown as Record<string, unknown>,
    )
    expect(no.outcome).toBe('disqualified')
  })

  it('records missing required answers in data.meta', () => {
    const cfg: QualificationConfig = {
      ...baseConfig,
      scoring: { mode: 'rule_based', threshold: 0 },
      questions: [
        {
          id: 'q1',
          prompt: 'Required',
          kind: 'short_text',
          required: true,
          weight: 1,
        },
      ],
    }
    const result = parseSubmission(
      'qualification',
      { answers: JSON.stringify({}) },
      cfg as unknown as Record<string, unknown>,
    )
    expect(result.data.meta).toEqual({ validation_errors: { missing_required: ['q1'] } })
  })

  it('stores matched outcome action metadata', () => {
    const cfg: QualificationConfig = {
      ...baseConfig,
      scoring: { mode: 'rule_based', threshold: 5 },
      questions: [
        {
          id: 'q1',
          prompt: 'A?',
          kind: 'single_choice',
          required: false,
          weight: 1,
          options: [{ label: 'Yes', value: 'yes', score: 5 }],
        },
      ],
      outcomes: [
        {
          id: 'qualified',
          label: 'Qualified buyer',
          outcome: 'qualified',
          match: { kind: 'score_at_least', value: 5 },
          to_stage_id: '00000000-0000-0000-0000-000000000101',
          messenger_text: 'Great fit.',
          attach_action_page_id: '00000000-0000-0000-0000-000000000201',
          attach_cta_label: 'Continue',
          public_message: 'You qualify.',
        },
      ],
    }

    const result = parseSubmission(
      'qualification',
      { answers: JSON.stringify({ q1: 'yes' }) },
      cfg as unknown as Record<string, unknown>,
    )

    expect(result.outcome).toBe('qualified')
    expect(result.data.outcome_action_id).toBe('qualified')
    expect(result.data.outcome_label).toBe('Qualified buyer')
    expect(result.data.outcome_action).toEqual({
      to_stage_id: '00000000-0000-0000-0000-000000000101',
      messenger_text: 'Great fit.',
      attach_action_page_id: '00000000-0000-0000-0000-000000000201',
      attach_cta_label: 'Continue',
      public_message: 'You qualify.',
    })
  })
})
