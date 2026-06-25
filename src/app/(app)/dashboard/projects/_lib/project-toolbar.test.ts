import { describe, it, expect } from 'vitest'
import { buildProjectToolbarModel, resolveInitialDrawerTab } from './project-toolbar'
import type { ProjectCardRow } from './queries'

function card(over: Partial<ProjectCardRow>): ProjectCardRow {
  return {
    id: 'p', user_id: 'u', workspace_id: 'w', lead_id: 'l', origin_submission_id: null,
    stage_id: 's', title: 't', description: null, value: null,
    currency: 'PHP', ai_instructions: null, notes: null, position: 0,
    archived_at: null, created_at: '2026-06-01', updated_at: '2026-06-01',
    lead_name: null, lead_email: null, lead_phone: null, lead_company: null,
    lead_picture_url: null, stage_name: null, stage_kind: 'open',
    origin_submission_kind: null, unread_count: 0, missed_count: 0,
    is_archived: false,
    ...over,
  }
}

describe('buildProjectToolbarModel — archive button', () => {
  it('labels the action "Archive" for an active project', () => {
    const { archive } = buildProjectToolbarModel(card({ is_archived: false }))
    expect(archive.isArchived).toBe(false)
    expect(archive.label).toBe('Archive')
  })

  it('labels the action "Unarchive" for an archived project', () => {
    const { archive } = buildProjectToolbarModel(card({ is_archived: true }))
    expect(archive.isArchived).toBe(true)
    expect(archive.label).toBe('Unarchive')
  })
})

describe('buildProjectToolbarModel — read-messages button', () => {
  it('hides the button when there is nothing unread or missed', () => {
    const { read } = buildProjectToolbarModel(card({ unread_count: 0, missed_count: 0 }))
    expect(read.show).toBe(false)
    expect(read.count).toBe(0)
  })

  it('shows an unread (red) button when messages are waiting on us', () => {
    const { read } = buildProjectToolbarModel(card({ unread_count: 3, missed_count: 0 }))
    expect(read.show).toBe(true)
    expect(read.count).toBe(3)
    expect(read.variant).toBe('unread')
    expect(read.label).toBe('Read 3 messages')
  })

  it('uses singular wording for a single unread message', () => {
    const { read } = buildProjectToolbarModel(card({ unread_count: 1 }))
    expect(read.label).toBe('Read 1 message')
  })

  it('falls back to the missed (amber) tally when nothing is unread', () => {
    const { read } = buildProjectToolbarModel(card({ unread_count: 0, missed_count: 2 }))
    expect(read.show).toBe(true)
    expect(read.count).toBe(2)
    expect(read.variant).toBe('missed')
    expect(read.label).toBe('Read 2 missed')
  })

  it('prefers the unread count over the missed tally when both are present', () => {
    const { read } = buildProjectToolbarModel(card({ unread_count: 4, missed_count: 9 }))
    expect(read.variant).toBe('unread')
    expect(read.count).toBe(4)
  })

  it('clamps negative/garbage counts to a hidden button', () => {
    const { read } = buildProjectToolbarModel(card({ unread_count: -5, missed_count: -1 }))
    expect(read.show).toBe(false)
    expect(read.count).toBe(0)
  })
})

describe('resolveInitialDrawerTab', () => {
  it('defaults to the overview tab when nothing is requested', () => {
    expect(resolveInitialDrawerTab()).toBe('overview')
    expect(resolveInitialDrawerTab(null)).toBe('overview')
    expect(resolveInitialDrawerTab(undefined)).toBe('overview')
  })

  it('opens the conversation tab when the card Read button requests it', () => {
    expect(resolveInitialDrawerTab('conversation')).toBe('conversation')
  })

  it('passes through every known tab', () => {
    for (const tab of ['overview', 'submissions', 'conversation', 'followup'] as const) {
      expect(resolveInitialDrawerTab(tab)).toBe(tab)
    }
  })

  it('falls back to overview for an unknown/garbage tab', () => {
    expect(resolveInitialDrawerTab('hacker')).toBe('overview')
    expect(resolveInitialDrawerTab('')).toBe('overview')
  })
})
