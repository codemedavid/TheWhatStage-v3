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
  isImpliedSubmission,
  impliedQuote,
  resolveDateRange,
  filterByDateRange,
  countWithinRange,
  conversionRate,
  formatPercent,
  computeRangeMetrics,
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

describe('resolveDateRange', () => {
  // 2026-06-20 12:00 UTC === 2026-06-20 20:00 Manila (UTC+8)
  const now = new Date('2026-06-20T12:00:00.000Z')

  it('bounds today to the Manila calendar day', () => {
    expect(resolveDateRange('today', now)).toEqual({ from: '2026-06-20', to: '2026-06-20' })
  })

  it('bounds week from Monday through today', () => {
    // 2026-06-20 is a Saturday; Monday of that week is 2026-06-15
    expect(resolveDateRange('week', now)).toEqual({ from: '2026-06-15', to: '2026-06-20' })
  })

  it('bounds month from the 1st through today', () => {
    expect(resolveDateRange('month', now)).toEqual({ from: '2026-06-01', to: '2026-06-20' })
  })

  it('clears bounds for all time', () => {
    expect(resolveDateRange('all', now)).toEqual({ from: null, to: null })
  })

  it('passes through custom bounds', () => {
    expect(
      resolveDateRange('custom', now, { from: '2026-06-01', to: '2026-06-10' }),
    ).toEqual({ from: '2026-06-01', to: '2026-06-10' })
  })
})

describe('filterByDateRange / countWithinRange', () => {
  const rows = [
    makeSubmission({ id: 'today', created_at: '2026-06-20T03:00:00.000Z' }), // 11:00 Manila, 6/20
    makeSubmission({ id: 'yesterday', created_at: '2026-06-19T03:00:00.000Z' }),
    makeSubmission({ id: 'lastmonth', created_at: '2026-05-10T03:00:00.000Z' }),
  ]

  it('keeps only rows within an inclusive Manila-day window', () => {
    const bounds = { from: '2026-06-19', to: '2026-06-20' }
    expect(filterByDateRange(rows, bounds).map((r) => r.id)).toEqual(['today', 'yesterday'])
  })

  it('returns all rows when bounds are open', () => {
    expect(filterByDateRange(rows, { from: null, to: null }).map((r) => r.id)).toEqual([
      'today',
      'yesterday',
      'lastmonth',
    ])
  })

  it('counts raw timestamps within the window', () => {
    const stamps = rows.map((r) => r.created_at)
    expect(countWithinRange(stamps, { from: '2026-06-20', to: '2026-06-20' })).toBe(1)
    expect(countWithinRange(stamps, { from: null, to: null })).toBe(3)
  })
})

describe('conversionRate / formatPercent', () => {
  it('divides submissions by leads', () => {
    expect(conversionRate(40, 200)).toBeCloseTo(0.2)
  })

  it('returns null when there are no leads', () => {
    expect(conversionRate(5, 0)).toBeNull()
  })

  it('formats a rate as a rounded percentage', () => {
    expect(formatPercent(0.2)).toBe('20%')
    expect(formatPercent(0.125)).toBe('12.5%')
    expect(formatPercent(null)).toBe('—')
  })
})

describe('computeRangeMetrics', () => {
  const now = new Date('2026-06-20T12:00:00.000Z')
  const subs = [
    makeSubmission({ id: 'a', created_at: '2026-06-20T03:00:00.000Z' }), // today
    makeSubmission({ id: 'b', created_at: '2026-06-02T03:00:00.000Z' }), // this month
    makeSubmission({ id: 'c', created_at: '2026-04-01T03:00:00.000Z' }), // older
  ]
  const leadStamps = [
    '2026-06-20T01:00:00.000Z', // today
    '2026-06-20T02:00:00.000Z', // today
    '2026-06-02T01:00:00.000Z', // this month
    '2026-01-01T01:00:00.000Z', // older
  ]

  it('reports submissions, leads and conversion within the selected range', () => {
    const bounds = resolveDateRange('today', now)
    const m = computeRangeMetrics(subs, leadStamps, bounds)
    expect(m.submissions).toBe(1)
    expect(m.leads).toBe(2)
    expect(m.conversionRate).toBeCloseTo(0.5)
  })

  it('uses all rows for the all-time range', () => {
    const bounds = resolveDateRange('all', now)
    const m = computeRangeMetrics(subs, leadStamps, bounds)
    expect(m.submissions).toBe(3)
    expect(m.leads).toBe(4)
    expect(m.conversionRate).toBeCloseTo(0.75)
  })

  it('uses the exact total for the all-time window when the list is capped', () => {
    const bounds = resolveDateRange('all', now)
    // leadStamps has 4 entries but the true account total is 9000 (capped list).
    const m = computeRangeMetrics(subs, leadStamps, bounds, 9000)
    expect(m.leads).toBe(9000)
    expect(m.conversionRate).toBeCloseTo(3 / 9000)
  })

  it('ignores the total for a windowed range', () => {
    const bounds = resolveDateRange('today', now)
    const m = computeRangeMetrics(subs, leadStamps, bounds, 9000)
    expect(m.leads).toBe(2)
  })

  it('returns a null rate when no leads fall in the range', () => {
    const bounds = resolveDateRange('custom', now, { from: '2026-03-01', to: '2026-03-31' })
    const m = computeRangeMetrics(subs, leadStamps, bounds)
    expect(m.leads).toBe(0)
    expect(m.conversionRate).toBeNull()
  })
})

describe('isImpliedSubmission / impliedQuote', () => {
  it('detects the implied_proceed outcome', () => {
    expect(isImpliedSubmission({ outcome: 'implied_proceed' })).toBe(true)
    expect(isImpliedSubmission({ outcome: 'submitted' })).toBe(false)
    expect(isImpliedSubmission({ outcome: null })).toBe(false)
  })

  it('labels implied_proceed as "Chat-implied"', () => {
    expect(formatOutcomeLabel('implied_proceed')).toBe('Chat-implied')
  })

  it('extracts the message quote from virtual submission data', () => {
    expect(impliedQuote({ message_quote: 'Kayo na po bahala' })).toBe('Kayo na po bahala')
    expect(impliedQuote({ message_quote: '   ' })).toBeNull()
    expect(impliedQuote({})).toBeNull()
    expect(impliedQuote(null)).toBeNull()
  })
})
