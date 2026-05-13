import { describe, it, expect } from 'vitest'
import { leadsToCsv } from './csv'
import type { LeadRow, StageRow, FieldDefRow } from './queries'

const stages: StageRow[] = [
  { id: 's1', name: 'New Lead', description: null, position: 0, is_default: true, kind: null, entry_signals: [], exit_signals: [], required_fields: [] },
]
const defs: FieldDefRow[] = [
  { id: 'f1', key: 'industry', label: 'Industry', type: 'text', options: null, position: 0 },
]
const lead: LeadRow = {
  id: 'l1', stage_id: 's1', name: 'Jane, "Q"', email: 'j@x.com',
  phone: null, company: 'Acme\nCorp', job_title: null, source: null,
  estimated_value: 1000, notes: null,
  custom_fields: { industry: 'SaaS' }, phones: null, emails: null, position: 0,
  created_at: '2026-04-28T00:00:00Z', updated_at: '2026-04-28T00:00:00Z',
  picture_url: null,
  campaign_id: null,
  campaign_name: null,
  latest_auto_move: null,
}

describe('leadsToCsv', () => {
  it('writes headers including stage and custom field keys', () => {
    const out = leadsToCsv([], stages, defs)
    expect(out.split('\n')[0]).toContain('stage')
    expect(out.split('\n')[0]).toContain('industry')
  })
  it('escapes commas, quotes, newlines', () => {
    const out = leadsToCsv([lead], stages, defs)
    expect(out).toContain('"Jane, ""Q"""')
    expect(out).toContain('"Acme\nCorp"')
    expect(out).toContain('New Lead')
    expect(out).toContain('SaaS')
  })
  it('handles empty values', () => {
    const out = leadsToCsv([{ ...lead, name: '', email: null, custom_fields: {} }], stages, defs)
    const cells = out.split('\n')[1].split(',')
    expect(cells[1]).toBe('')
    expect(cells[2]).toBe('')
  })
})
