import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProjectWorkspaceRow } from '@/lib/projects/types'
import {
  defaultCopyName,
  deleteWorkspaceGuard,
  computeWorkspaceSummaries,
  resolveDefaultStageId,
  fetchProjectWorkspaceId,
} from './workspaces'

// Minimal chainable Supabase stub: every terminal (maybeSingle/single) pulls the
// next queued result, so a sequence of queries can be scripted in order.
function fakeClient(queue: Array<{ data?: unknown; error?: unknown }>): SupabaseClient {
  let i = 0
  const next = () => queue[i++] ?? { data: null, error: null }
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit']) builder[m] = () => builder
  builder.maybeSingle = async () => next()
  builder.single = async () => next()
  return { from: () => builder } as unknown as SupabaseClient
}

describe('defaultCopyName', () => {
  it('prefixes "Copy of"', () => {
    expect(defaultCopyName('Sales')).toBe('Copy of Sales')
  })

  it('caps the result at the 60-char name limit', () => {
    const long = 'x'.repeat(80)
    const copy = defaultCopyName(long)
    expect(copy.length).toBe(60)
    expect(copy.startsWith('Copy of ')).toBe(true)
  })
})

describe('deleteWorkspaceGuard', () => {
  it('blocks the default workspace', () => {
    expect(deleteWorkspaceGuard({ isDefault: true, projectCount: 0 })).toMatch(/default/i)
  })

  it('blocks a non-empty workspace and names the count', () => {
    const msg = deleteWorkspaceGuard({ isDefault: false, projectCount: 3 })
    expect(msg).toMatch(/3/)
    expect(msg).toMatch(/move or delete/i)
  })

  it('allows deleting an empty, non-default workspace', () => {
    expect(deleteWorkspaceGuard({ isDefault: false, projectCount: 0 })).toBeNull()
  })

  it('blocks default even when empty (default guard wins)', () => {
    expect(deleteWorkspaceGuard({ isDefault: true, projectCount: 0 })).not.toBeNull()
  })
})

describe('computeWorkspaceSummaries', () => {
  const ws = (id: string, over: Partial<ProjectWorkspaceRow> = {}): ProjectWorkspaceRow => ({
    id,
    name: id,
    description: null,
    position: 0,
    is_default: false,
    color: null,
    ...over,
  })

  it('counts stages and projects per workspace and sums non-archived value', () => {
    const workspaces = [ws('w1', { is_default: true }), ws('w2')]
    const stages = [
      { workspace_id: 'w1' },
      { workspace_id: 'w1' },
      { workspace_id: 'w2' },
    ]
    const projects = [
      { workspace_id: 'w1', value: 100, archived_at: null, currency: 'USD' },
      { workspace_id: 'w1', value: 50, archived_at: '2026-01-01', currency: 'USD' }, // archived
      { workspace_id: 'w2', value: 200, archived_at: null, currency: 'PHP' },
    ]

    const out = computeWorkspaceSummaries(workspaces, stages, projects)
    const w1 = out.find((w) => w.id === 'w1')!
    const w2 = out.find((w) => w.id === 'w2')!

    expect(w1.stageCount).toBe(2)
    expect(w1.projectCount).toBe(2) // archived included in the "empty?" count
    expect(w1.activeProjectCount).toBe(1)
    expect(w1.openValue).toBe(100) // archived 50 excluded
    expect(w1.currency).toBe('USD')

    expect(w2.stageCount).toBe(1)
    expect(w2.activeProjectCount).toBe(1)
    expect(w2.openValue).toBe(200)
  })

  it('returns zeroed counts for an empty workspace and preserves order', () => {
    const workspaces = [ws('w1'), ws('w2')]
    const out = computeWorkspaceSummaries(workspaces, [], [])
    expect(out.map((w) => w.id)).toEqual(['w1', 'w2'])
    expect(out[0]).toMatchObject({ stageCount: 0, projectCount: 0, activeProjectCount: 0, openValue: 0 })
  })
})

describe('resolveDefaultStageId', () => {
  it('returns the flagged default stage when present', async () => {
    const client = fakeClient([{ data: { id: 's-default' } }])
    expect(await resolveDefaultStageId(client, 'u1', 'w1')).toBe('s-default')
  })

  it('falls back to the lowest-position stage when no default flag exists', async () => {
    const client = fakeClient([{ data: null }, { data: { id: 's-first' } }])
    expect(await resolveDefaultStageId(client, 'u1', 'w1')).toBe('s-first')
  })

  it('returns null when the workspace has no stages at all', async () => {
    const client = fakeClient([{ data: null }, { data: null }])
    expect(await resolveDefaultStageId(client, 'u1', 'w1')).toBeNull()
  })
})

describe('fetchProjectWorkspaceId', () => {
  it('returns the card\'s workspace for the deep-link redirect', async () => {
    const client = fakeClient([{ data: { workspace_id: 'w-9' } }])
    expect(await fetchProjectWorkspaceId(client, 'u1', 'p1')).toBe('w-9')
  })

  it('returns null when the card is missing or not owned', async () => {
    const client = fakeClient([{ data: null }])
    expect(await fetchProjectWorkspaceId(client, 'u1', 'p1')).toBeNull()
  })
})
