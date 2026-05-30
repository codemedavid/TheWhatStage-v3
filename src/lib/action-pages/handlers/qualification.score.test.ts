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

  it('exposes raw as an alias of score', () => {
    const cfg: QualificationConfig = {
      ...baseConfig,
      questions: [
        {
          id: 'q1',
          prompt: 'A?',
          kind: 'single_choice',
          required: false,
          weight: 2,
          options: [{ label: 'Yes', value: 'yes', score: 3 }],
        },
      ],
    }
    const r = scoreQualification(cfg, { q1: 'yes' })
    expect(r.score).toBe(6)
    expect(r.raw).toBe(r.score)
  })
})

describe('scoreQualification normalization', () => {
  it('normalizes to 100 when raw equals max', () => {
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
    const r = scoreQualification(cfg, { q1: 'yes' })
    expect(r.raw).toBe(5)
    expect(r.max).toBe(5)
    expect(r.normalized).toBe(100)
  })

  it('produces a proportional integer normalized value', () => {
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
            { label: 'Lo', value: 'lo', score: 2 },
            { label: 'Hi', value: 'hi', score: 6 },
          ],
        },
      ],
    }
    // max = 6, raw = 2 -> round(100 * 2 / 6) = 33
    const r = scoreQualification(cfg, { q1: 'lo' })
    expect(r.max).toBe(6)
    expect(r.raw).toBe(2)
    expect(r.normalized).toBe(33)
    expect(Number.isInteger(r.normalized)).toBe(true)
  })

  it('returns normalized 0 (no division) when max is 0', () => {
    const cfg: QualificationConfig = {
      ...baseConfig,
      questions: [
        {
          id: 'q1',
          prompt: 'Tell us',
          kind: 'short_text',
          required: false,
          weight: 5,
        },
      ],
    }
    const r = scoreQualification(cfg, { q1: 'hello' })
    expect(r.max).toBe(0)
    expect(r.normalized).toBe(0)
  })

  it('handles empty questions config', () => {
    const r = scoreQualification(baseConfig, {})
    expect(r).toEqual({
      score: 0,
      raw: 0,
      max: 0,
      normalized: 0,
      missing_required: [],
    })
  })

  it('computes max independent of answers (all missing -> normalized 0)', () => {
    const cfg: QualificationConfig = {
      ...baseConfig,
      questions: [
        {
          id: 'q1',
          prompt: 'A?',
          kind: 'single_choice',
          required: false,
          weight: 1,
          options: [{ label: 'Yes', value: 'yes', score: 10 }],
        },
      ],
    }
    const r = scoreQualification(cfg, {})
    expect(r.max).toBe(10)
    expect(r.raw).toBe(0)
    expect(r.normalized).toBe(0)
  })

  it('clamps negative raw to normalized 0', () => {
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
            { label: 'Bad', value: 'bad', score: -5 },
            { label: 'Good', value: 'good', score: 4 },
          ],
        },
      ],
    }
    // max uses only the positive option (4); raw = -5 -> clamp to 0
    const r = scoreQualification(cfg, { q1: 'bad' })
    expect(r.max).toBe(4)
    expect(r.raw).toBe(-5)
    expect(r.normalized).toBe(0)
  })

  it('uses rating_max for the ceiling', () => {
    const cfg: QualificationConfig = {
      ...baseConfig,
      questions: [
        {
          id: 'q1',
          prompt: 'Rate',
          kind: 'rating',
          required: false,
          weight: 2,
          rating_max: 10,
        },
      ],
    }
    const r = scoreQualification(cfg, { q1: 5 })
    expect(r.max).toBe(20)
    expect(r.raw).toBe(10)
    expect(r.normalized).toBe(50)
  })

  it('defaults rating ceiling to 5 when rating_max is absent', () => {
    const cfg: QualificationConfig = {
      ...baseConfig,
      questions: [
        {
          id: 'q1',
          prompt: 'Rate',
          kind: 'rating',
          required: false,
          weight: 1,
        },
      ],
    }
    const r = scoreQualification(cfg, { q1: 5 })
    expect(r.max).toBe(5)
    expect(r.normalized).toBe(100)
  })

  it('weight 0 contributes nothing to raw or max', () => {
    const cfg: QualificationConfig = {
      ...baseConfig,
      questions: [
        {
          id: 'q1',
          prompt: 'A?',
          kind: 'single_choice',
          required: false,
          weight: 0,
          options: [{ label: 'Yes', value: 'yes', score: 100 }],
        },
      ],
    }
    const r = scoreQualification(cfg, { q1: 'yes' })
    expect(r.raw).toBe(0)
    expect(r.max).toBe(0)
    expect(r.normalized).toBe(0)
  })

  it('guards NaN weight as 1', () => {
    const cfg: QualificationConfig = {
      ...baseConfig,
      questions: [
        {
          id: 'q1',
          prompt: 'A?',
          kind: 'single_choice',
          required: false,
          weight: Number.NaN,
          options: [{ label: 'Yes', value: 'yes', score: 7 }],
        },
      ],
    }
    const r = scoreQualification(cfg, { q1: 'yes' })
    expect(r.raw).toBe(7)
    expect(r.max).toBe(7)
    expect(r.normalized).toBe(100)
  })
})

describe('scoreQualification multi_choice cap', () => {
  it('caps duplicate selections at the positive-option ceiling', () => {
    const cfg: QualificationConfig = {
      ...baseConfig,
      questions: [
        {
          id: 'q1',
          prompt: 'Pick',
          kind: 'multi_choice',
          required: false,
          weight: 1,
          options: [
            { label: 'A', value: 'a', score: 2 },
            { label: 'B', value: 'b', score: 3 },
          ],
        },
      ],
    }
    // ceiling = 2 + 3 = 5; duplicates must not inflate beyond 5
    const r = scoreQualification(cfg, { q1: ['a', 'a', 'a', 'b', 'b'] })
    expect(r.raw).toBe(5)
    expect(r.max).toBe(5)
    expect(r.normalized).toBe(100)
  })

  it('keeps normal (non-duplicate) multi_choice sums unchanged', () => {
    const cfg: QualificationConfig = {
      ...baseConfig,
      questions: [
        {
          id: 'q1',
          prompt: 'Pick',
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
    expect(scoreQualification(cfg, { q1: ['a', 'b'] }).raw).toBe(5)
    expect(scoreQualification(cfg, { q1: ['a', 'b', 'c'] }).raw).toBe(10)
  })

  it('ignores negative options in the max ceiling but applies them to raw', () => {
    const cfg: QualificationConfig = {
      ...baseConfig,
      questions: [
        {
          id: 'q1',
          prompt: 'Pick',
          kind: 'multi_choice',
          required: false,
          weight: 1,
          options: [
            { label: 'Plus', value: 'plus', score: 4 },
            { label: 'Minus', value: 'minus', score: -2 },
          ],
        },
      ],
    }
    // ceiling = 4 (only positive). selecting both: min(4 + -2, 4) = 2
    const r = scoreQualification(cfg, { q1: ['plus', 'minus'] })
    expect(r.max).toBe(4)
    expect(r.raw).toBe(2)
    expect(r.normalized).toBe(50)
  })

  it('one heavy question cannot dominate the normalized score', () => {
    const cfg: QualificationConfig = {
      ...baseConfig,
      questions: [
        {
          id: 'big',
          prompt: 'Many',
          kind: 'multi_choice',
          required: false,
          weight: 3,
          options: [
            { label: '1', value: '1', score: 5 },
            { label: '2', value: '2', score: 5 },
            { label: '3', value: '3', score: 5 },
            { label: '4', value: '4', score: 5 },
          ],
        },
        {
          id: 'small',
          prompt: 'A?',
          kind: 'single_choice',
          required: false,
          weight: 1,
          options: [{ label: 'Yes', value: 'yes', score: 5 }],
        },
      ],
    }
    // big max = (5*4)*3 = 60, small max = 5 -> total 65
    const r = scoreQualification(cfg, {
      big: ['1', '2', '3', '4'],
      small: 'yes',
    })
    expect(r.max).toBe(65)
    expect(r.raw).toBe(65)
    expect(r.normalized).toBe(100)
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
