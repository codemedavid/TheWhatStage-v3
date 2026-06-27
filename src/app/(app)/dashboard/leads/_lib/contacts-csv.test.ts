import { describe, it, expect } from 'vitest'
import { contactsToCsv, type ContactExportRow } from './contacts-csv'
import type { StageRow, FieldDefRow } from './queries'

const stages: StageRow[] = [
  { id: 's1', name: 'New Lead', description: null, position: 0, is_default: true, kind: null, entry_signals: [], exit_signals: [], required_fields: [] },
]
const defs: FieldDefRow[] = [
  { id: 'f1', key: 'industry', label: 'Industry', type: 'text', options: null, position: 0 },
]

function makeRow(overrides: Partial<ContactExportRow> = {}): ContactExportRow {
  return {
    id: 'l1', stage_id: 's1', name: 'Jane',
    email: 'j@x.com', phone: '+15550001',
    company: 'Acme', job_title: null, source: 'messenger',
    estimated_value: 1000, notes: null,
    custom_fields: { industry: 'SaaS' },
    phones: ['+15550001', '+15550002'], emails: ['j@x.com'],
    position: 0,
    created_at: '2026-04-28T00:00:00Z', updated_at: '2026-04-28T00:00:00Z',
    last_activity_at: '2026-04-28T00:00:00Z',
    picture_url: null, unread_count: 0, missed_count: 0,
    campaign_id: null, campaign_name: 'Spring Promo',
    latest_auto_move: null,
    latest_phone: { value: '+15550002', source: 'messenger', collected_at: '2026-04-27T00:00:00Z' },
    latest_email: { value: 'j@x.com', source: 'form', collected_at: '2026-04-26T00:00:00Z' },
    latest_contact_at: '2026-04-27T00:00:00Z',
    project_status: 'Onboarding',
    ...overrides,
  }
}

describe('contactsToCsv', () => {
  it('writes a header row with phone, project status, and custom field columns', () => {
    const header = contactsToCsv([], stages, defs).split('\n')[0]
    expect(header).toContain('phones')
    expect(header).toContain('latest_phone')
    expect(header).toContain('project_status')
    expect(header).toContain('lead_stage')
    expect(header).toContain('industry')
  })

  it('joins every phone number in the phones array', () => {
    const out = contactsToCsv([makeRow()], stages, defs)
    expect(out).toContain('+15550001; +15550002')
  })

  it('falls back to the legacy phone field when phones array is empty', () => {
    const out = contactsToCsv([makeRow({ phones: [], phone: '+15559999' })], stages, defs)
    expect(out).toContain('+15559999')
  })

  it('includes the most recent project status', () => {
    const out = contactsToCsv([makeRow({ project_status: 'Won' })], stages, defs)
    expect(out).toContain('Won')
  })

  it('emits an empty cell when the contact has no project', () => {
    const out = contactsToCsv([makeRow({ project_status: null })], stages, defs)
    const cells = out.split('\n')[1]
    expect(cells).toContain(',,') // project_status blank between two filled neighbours
  })

  it('resolves the lead pipeline stage name from stage_id', () => {
    const out = contactsToCsv([makeRow()], stages, defs)
    expect(out).toContain('New Lead')
  })

  it('escapes commas, quotes, and newlines', () => {
    const out = contactsToCsv([makeRow({ name: 'Jane, "Q"', company: 'Acme\nCorp' })], stages, defs)
    expect(out).toContain('"Jane, ""Q"""')
    expect(out).toContain('"Acme\nCorp"')
  })
})
