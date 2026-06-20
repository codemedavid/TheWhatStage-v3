import { describe, expect, it } from 'vitest'
import type { SubmissionListItem } from '../../_lib/queries'
import {
  submissionSource,
  displayName,
  extractFormFields,
  extractAnswers,
  getScore,
  formatOutcomeLabel,
  computeStats,
  getFilters,
  filterSubmissions,
} from './form-submissions.helpers'

function makeSubmission(
  partial: Partial<SubmissionListItem> = {},
): SubmissionListItem {
  return {
    id: 'sub-1',
    outcome: null,
    data: {},
    psid: null,
    page_id: null,
    lead_id: null,
    lead_name: null,
    messenger_name: null,
    messenger_full_name: null,
    created_at: '2026-06-20T10:00:00.000Z',
    ...partial,
  }
}

describe('submissionSource', () => {
  it('returns Messenger when a psid is present', () => {
    expect(submissionSource(makeSubmission({ psid: '123' }))).toBe('Messenger')
  })

  it('returns Web when there is no psid', () => {
    expect(submissionSource(makeSubmission({ psid: null }))).toBe('Web')
  })
})

describe('displayName', () => {
  it('prefers the lead name', () => {
    expect(
      displayName(makeSubmission({ lead_name: 'Ada', messenger_name: 'A. L.' })),
    ).toBe('Ada')
  })

  it('falls back to the messenger name', () => {
    expect(displayName(makeSubmission({ messenger_name: 'Grace' }))).toBe('Grace')
  })

  it('returns Anonymous when nothing identifies the person', () => {
    expect(displayName(makeSubmission())).toBe('Anonymous')
  })
})

describe('extractFormFields', () => {
  it('pulls human-readable fields from data.fields, skipping empties', () => {
    const fields = extractFormFields({
      fields: { full_name: 'Ada Lovelace', email: 'ada@x.io', note: '' },
    })
    expect(fields).toEqual([
      { key: 'full_name', label: 'Full Name', value: 'Ada Lovelace' },
      { key: 'email', label: 'Email', value: 'ada@x.io' },
    ])
  })

  it('returns an empty array when there are no fields', () => {
    expect(extractFormFields({})).toEqual([])
  })
})

describe('extractAnswers', () => {
  it('maps qualification answers to prompt/value pairs using display when present', () => {
    const answers = extractAnswers({
      answers: [
        { prompt: 'Budget?', display: '$5k+' },
        { prompt: 'Channels?', display: ['Email', 'SMS'] },
        { value: 'fallback' },
      ],
    })
    expect(answers).toEqual([
      { prompt: 'Budget?', value: '$5k+' },
      { prompt: 'Channels?', value: 'Email, SMS' },
      { prompt: 'Q3', value: 'fallback' },
    ])
  })

  it('returns an empty array when there are no answers', () => {
    expect(extractAnswers({})).toEqual([])
  })
})

describe('getScore', () => {
  it('returns the numeric score', () => {
    expect(getScore({ score: 7.5 })).toBe(7.5)
  })

  it('returns null when there is no score', () => {
    expect(getScore({})).toBeNull()
  })
})

describe('formatOutcomeLabel', () => {
  it('uses the known label for a recognized outcome', () => {
    expect(formatOutcomeLabel('qualified')).toBe('Qualified')
  })

  it('humanizes an unknown outcome', () => {
    expect(formatOutcomeLabel('not_a_fit')).toBe('Not A Fit')
  })
})

describe('computeStats (form)', () => {
  const now = new Date('2026-06-20T12:00:00.000Z')

  it('counts total, this month and this week of submitted entries', () => {
    const subs = [
      makeSubmission({ id: 'a', created_at: '2026-06-20T09:00:00.000Z' }), // this week
      makeSubmission({ id: 'b', created_at: '2026-06-02T09:00:00.000Z' }), // this month, not week
      makeSubmission({ id: 'c', created_at: '2026-04-01T09:00:00.000Z' }), // older
    ]
    const stats = computeStats('form', subs, now)
    expect(stats.map((s) => [s.label, s.value])).toEqual([
      ['Total', 3],
      ['This month', 2],
      ['This week', 1],
    ])
  })
})

describe('computeStats (qualification)', () => {
  const now = new Date('2026-06-20T12:00:00.000Z')

  it('summarizes the top outcomes plus a this-week count', () => {
    const subs = [
      makeSubmission({ id: 'a', outcome: 'qualified', created_at: '2026-06-20T09:00:00.000Z' }),
      makeSubmission({ id: 'b', outcome: 'qualified', created_at: '2026-06-18T09:00:00.000Z' }),
      makeSubmission({ id: 'c', outcome: 'disqualified', created_at: '2026-05-01T09:00:00.000Z' }),
    ]
    const stats = computeStats('qualification', subs, now)
    expect(stats[0]).toMatchObject({ label: 'Qualified', value: 2 })
    expect(stats.some((s) => s.label === 'Disqualified' && s.value === 1)).toBe(true)
    expect(stats.some((s) => s.label === 'This week' && s.value === 2)).toBe(true)
  })
})

describe('getFilters', () => {
  it('builds source filters for the form kind', () => {
    const subs = [
      makeSubmission({ id: 'a', psid: '1' }),
      makeSubmission({ id: 'b', psid: null }),
      makeSubmission({ id: 'c', psid: null }),
    ]
    expect(getFilters('form', subs)).toEqual([
      { key: 'all', label: 'All', count: 3 },
      { key: 'web', label: 'Web', count: 2 },
      { key: 'messenger', label: 'Messenger', count: 1 },
    ])
  })

  it('builds outcome filters for the qualification kind', () => {
    const subs = [
      makeSubmission({ id: 'a', outcome: 'qualified' }),
      makeSubmission({ id: 'b', outcome: 'qualified' }),
      makeSubmission({ id: 'c', outcome: 'disqualified' }),
    ]
    expect(getFilters('qualification', subs)).toEqual([
      { key: 'all', label: 'All', count: 3 },
      { key: 'qualified', label: 'Qualified', count: 2 },
      { key: 'disqualified', label: 'Disqualified', count: 1 },
    ])
  })
})

describe('filterSubmissions', () => {
  const subs = [
    makeSubmission({ id: 'a', psid: '1', lead_name: 'Ada', outcome: 'qualified' }),
    makeSubmission({ id: 'b', psid: null, lead_name: 'Bob', outcome: 'disqualified' }),
  ]

  it('filters the form kind by source key', () => {
    expect(filterSubmissions(subs, 'form', 'messenger', '').map((s) => s.id)).toEqual(['a'])
    expect(filterSubmissions(subs, 'form', 'web', '').map((s) => s.id)).toEqual(['b'])
  })

  it('filters the qualification kind by outcome key', () => {
    expect(
      filterSubmissions(subs, 'qualification', 'disqualified', '').map((s) => s.id),
    ).toEqual(['b'])
  })

  it('returns everything for the all key', () => {
    expect(filterSubmissions(subs, 'form', 'all', '').map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('applies a free-text query across name and field values', () => {
    const withFields = [
      makeSubmission({ id: 'a', lead_name: 'Ada', data: { fields: { city: 'Paris' } } }),
      makeSubmission({ id: 'b', lead_name: 'Bob', data: { fields: { city: 'London' } } }),
    ]
    expect(filterSubmissions(withFields, 'form', 'all', 'paris').map((s) => s.id)).toEqual(['a'])
    expect(filterSubmissions(withFields, 'form', 'all', 'bob').map((s) => s.id)).toEqual(['b'])
  })
})
