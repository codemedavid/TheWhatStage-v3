import { describe, it, expect } from 'vitest'
import {
  coerceTab,
  isInboxTab,
  pickProjectChip,
  summarizeSubmission,
  resolveBadge,
  timeAgo,
  mapThreadRow,
  mapSubmissionRow,
  mapProjectRow,
  type RawThreadRow,
  type RawSubmissionRow,
  type RawProjectRow,
} from './rows'

describe('coerceTab / isInboxTab', () => {
  it('accepts the four known tabs', () => {
    expect(isInboxTab('needs-reply')).toBe(true)
    expect(isInboxTab('important')).toBe(true)
    expect(isInboxTab('submissions')).toBe(true)
    expect(isInboxTab('projects')).toBe(true)
  })

  it('defaults unknown / malformed values to needs-reply', () => {
    expect(coerceTab(undefined)).toBe('needs-reply')
    expect(coerceTab('garbage')).toBe('needs-reply')
    expect(coerceTab(42)).toBe('needs-reply')
    expect(coerceTab(['important'])).toBe('needs-reply')
  })

  it('passes a valid tab through unchanged', () => {
    expect(coerceTab('important')).toBe('important')
  })
})

describe('pickProjectChip', () => {
  it('returns null when there are no projects', () => {
    expect(pickProjectChip(null)).toBeNull()
    expect(pickProjectChip([])).toBeNull()
    expect(pickProjectChip(undefined)).toBeNull()
  })

  it('ignores archived projects', () => {
    expect(
      pickProjectChip([{ title: 'Archived', archived_at: '2026-01-01', updated_at: '2026-06-01' }]),
    ).toBeNull()
  })

  it('picks the most-recently-updated non-archived project title', () => {
    const title = pickProjectChip([
      { title: 'Old', archived_at: null, updated_at: '2026-06-01' },
      { title: 'New', archived_at: null, updated_at: '2026-06-20' },
      { title: 'Closed', archived_at: '2026-06-25', updated_at: '2026-06-25' },
    ])
    expect(title).toBe('New')
  })

  it('accepts a single object join shape', () => {
    expect(pickProjectChip({ title: 'Solo', archived_at: null, updated_at: '2026-06-10' })).toBe('Solo')
  })
})

describe('summarizeSubmission', () => {
  it('prefers a non-empty outcome', () => {
    expect(summarizeSubmission('booked', { name: 'Ana' })).toBe('booked')
  })

  it('falls back to the first string value in data', () => {
    expect(summarizeSubmission(null, { note: '  hello  ', other: 'x' })).toBe('hello')
  })

  it('falls back to a numeric value when no string is present', () => {
    expect(summarizeSubmission('', { qty: 3 })).toBe('3')
  })

  it('returns a generic label when nothing is usable', () => {
    expect(summarizeSubmission(null, {})).toBe('New submission')
    expect(summarizeSubmission(undefined, null)).toBe('New submission')
  })

  it('truncates very long values', () => {
    const long = 'x'.repeat(500)
    const out = summarizeSubmission(null, { note: long })
    expect(out.length).toBeLessThanOrEqual(140)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('timeAgo', () => {
  const NOW = new Date('2026-06-26T12:00:00Z').getTime()

  it('returns empty string for null or unparseable input', () => {
    expect(timeAgo(null, NOW)).toBe('')
    expect(timeAgo('not-a-date', NOW)).toBe('')
  })

  it('labels sub-minute as "now"', () => {
    expect(timeAgo('2026-06-26T11:59:30Z', NOW)).toBe('now')
  })

  it('labels minutes, hours, and days', () => {
    expect(timeAgo('2026-06-26T11:45:00Z', NOW)).toBe('15m')
    expect(timeAgo('2026-06-26T09:00:00Z', NOW)).toBe('3h')
    expect(timeAgo('2026-06-24T12:00:00Z', NOW)).toBe('2d')
  })

  it('falls back to a date string beyond a week', () => {
    const out = timeAgo('2026-06-01T12:00:00Z', NOW)
    expect(out).not.toMatch(/^\d+[mhd]$/)
    expect(out).not.toBe('now')
  })
})

describe('resolveBadge', () => {
  it('shows unread when present, taking precedence over missed', () => {
    expect(resolveBadge(3, 5)).toEqual({ count: 3, variant: 'unread' })
  })

  it('shows missed when there is no unread', () => {
    expect(resolveBadge(0, 5)).toEqual({ count: 5, variant: 'missed' })
  })

  it('returns null when nothing is waiting', () => {
    expect(resolveBadge(0, 0)).toBeNull()
  })
})

describe('mapThreadRow', () => {
  const base: RawThreadRow = {
    id: 't1',
    lead_id: 'lead-1',
    full_name: 'Maria FB',
    picture_url: 'http://img/1.jpg',
    unread_count: 2,
    missed_count: 0,
    is_important: false,
    last_message_at: '2026-06-25T10:00:00Z',
    last_message_preview: 'Hi po, available pa ba kayo',
    leads: { name: 'Maria Santos', projects: [{ title: 'Kitchen Reno', archived_at: null, updated_at: '2026-06-20' }] },
    facebook_pages: { name: 'My Page' },
  }

  it('maps a thread to an inbox item, preferring the lead name', () => {
    const item = mapThreadRow(base)
    expect(item).toMatchObject({
      key: 'thread:t1',
      leadId: 'lead-1',
      name: 'Maria Santos',
      pictureUrl: 'http://img/1.jpg',
      projectTitle: 'Kitchen Reno',
      pageName: 'My Page',
      preview: 'Hi po, available pa ba kayo',
      timestamp: '2026-06-25T10:00:00Z',
      unreadCount: 2,
      missedCount: 0,
      isImportant: false,
      source: 'thread',
    })
  })

  it('falls back to the facebook full_name when the lead has no name', () => {
    const item = mapThreadRow({ ...base, leads: { name: '  ', projects: null } })
    expect(item.name).toBe('Maria FB')
  })

  it('falls back to "Unknown" when neither name is present', () => {
    const item = mapThreadRow({ ...base, full_name: null, leads: null })
    expect(item.name).toBe('Unknown')
    expect(item.projectTitle).toBeNull()
  })

  it('clamps negative counts and reflects the important pin', () => {
    const item = mapThreadRow({ ...base, unread_count: -1, missed_count: -4, is_important: true })
    expect(item.unreadCount).toBe(0)
    expect(item.missedCount).toBe(0)
    expect(item.isImportant).toBe(true)
  })

  it('handles array join shapes from PostgREST', () => {
    const item = mapThreadRow({
      ...base,
      leads: [{ name: 'Arr Lead', projects: [] }],
      facebook_pages: [{ name: 'Arr Page' }],
    })
    expect(item.name).toBe('Arr Lead')
    expect(item.pageName).toBe('Arr Page')
  })
})

describe('mapSubmissionRow', () => {
  const base: RawSubmissionRow = {
    id: 's1',
    lead_id: 'lead-2',
    outcome: null,
    data: { full_name: 'Juan Cruz', budget: '50k' },
    created_at: '2026-06-25T09:00:00Z',
    action_pages: { title: 'Reno Quote', kind: 'form' },
    leads: {
      name: 'Juan Cruz',
      messenger_threads: { is_important: true, unread_count: 1, missed_count: 0, picture_url: 'p.jpg' },
      projects: null,
    },
  }

  it('maps a submission, pulling unread + pin from the lead thread', () => {
    const item = mapSubmissionRow(base)
    expect(item).toMatchObject({
      key: 'submission:s1',
      leadId: 'lead-2',
      name: 'Juan Cruz',
      pictureUrl: 'p.jpg',
      pageName: 'Reno Quote',
      tag: 'Form',
      unreadCount: 1,
      isImportant: true,
      source: 'submission',
    })
    expect(item.preview).toBe('Juan Cruz')
  })

  it('maps an unconverted submission with no chat thread', () => {
    const item = mapSubmissionRow({
      ...base,
      leads: { name: null, messenger_threads: null, projects: null },
    })
    expect(item.name).toBe('Unknown')
    expect(item.unreadCount).toBe(0)
    expect(item.missedCount).toBe(0)
    expect(item.isImportant).toBe(false)
  })

  it('title-cases an unknown action page kind for the tag', () => {
    const item = mapSubmissionRow({ ...base, action_pages: { title: 't', kind: 'webinar' } })
    expect(item.tag).toBe('Webinar')
  })
})

describe('mapProjectRow', () => {
  const base: RawProjectRow = {
    id: 'p1',
    lead_id: 'lead-3',
    title: 'Wedding Setup',
    updated_at: '2026-06-24T00:00:00Z',
    leads: {
      name: 'Ana Reyes',
      messenger_threads: {
        is_important: false,
        unread_count: 0,
        missed_count: 2,
        picture_url: 'a.jpg',
        last_message_at: '2026-06-25T08:00:00Z',
        last_message_preview: 'Ok sige po',
      },
    },
  }

  it('maps a project, using its own title and the thread for activity', () => {
    const item = mapProjectRow(base)
    expect(item).toMatchObject({
      key: 'project:p1',
      leadId: 'lead-3',
      name: 'Ana Reyes',
      projectTitle: 'Wedding Setup',
      preview: 'Ok sige po',
      timestamp: '2026-06-25T08:00:00Z',
      missedCount: 2,
      source: 'project',
    })
  })

  it('falls back to project updated_at when the lead has no thread', () => {
    const item = mapProjectRow({ ...base, leads: { name: 'Ana', messenger_threads: null } })
    expect(item.timestamp).toBe('2026-06-24T00:00:00Z')
    expect(item.preview).toBeNull()
    expect(item.unreadCount).toBe(0)
  })
})
