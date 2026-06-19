import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchProjectInfoBySubmissionIds } from './queries'

// Minimal chainable stub: from().select().eq().in() resolves to { data, error }.
function fakeSupabase(result: { data: unknown; error: unknown }): SupabaseClient {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => Promise.resolve(result),
  }
  return { from: () => builder } as unknown as SupabaseClient
}

describe('fetchProjectInfoBySubmissionIds', () => {
  it('returns an empty map when there are no submission ids', async () => {
    const map = await fetchProjectInfoBySubmissionIds(fakeSupabase({ data: [], error: null }), 'u1', [])
    expect(map.size).toBe(0)
  })

  it('maps submission id to project info, normalizing an object-shaped stage join', async () => {
    const data = [
      {
        id: 'p1',
        origin_submission_id: 's1',
        project_stages: { name: 'Scoping', kind: 'open' },
        leads: { messenger_threads: { unread_count: 4, missed_count: 9 } },
      },
    ]
    const map = await fetchProjectInfoBySubmissionIds(fakeSupabase({ data, error: null }), 'u1', ['s1'])
    expect(map.get('s1')).toEqual({
      id: 'p1',
      stageName: 'Scoping',
      stageKind: 'open',
      unreadCount: 4,
      missedCount: 9,
    })
  })

  it('normalizes array-shaped stage and thread joins to their first element', async () => {
    const data = [
      {
        id: 'p2',
        origin_submission_id: 's2',
        project_stages: [{ name: 'Won', kind: 'won' }],
        leads: [{ messenger_threads: [{ unread_count: 1, missed_count: 2 }] }],
      },
    ]
    const map = await fetchProjectInfoBySubmissionIds(fakeSupabase({ data, error: null }), 'u1', ['s2'])
    expect(map.get('s2')).toEqual({
      id: 'p2',
      stageName: 'Won',
      stageKind: 'won',
      unreadCount: 1,
      missedCount: 2,
    })
  })

  it('falls back to null stage fields and zero counts when joins are missing', async () => {
    const data = [{ id: 'p3', origin_submission_id: 's3', project_stages: null, leads: null }]
    const map = await fetchProjectInfoBySubmissionIds(fakeSupabase({ data, error: null }), 'u1', ['s3'])
    expect(map.get('s3')).toEqual({
      id: 'p3',
      stageName: null,
      stageKind: null,
      unreadCount: 0,
      missedCount: 0,
    })
  })

  it('skips rows with a null origin submission id', async () => {
    const data = [{ id: 'p4', origin_submission_id: null, project_stages: { name: 'New', kind: 'open' } }]
    const map = await fetchProjectInfoBySubmissionIds(fakeSupabase({ data, error: null }), 'u1', ['s4'])
    expect(map.size).toBe(0)
  })

  it('throws a labelled error when the query fails', async () => {
    const client = fakeSupabase({ data: null, error: { message: 'boom' } })
    await expect(fetchProjectInfoBySubmissionIds(client, 'u1', ['s5'])).rejects.toThrow(
      'fetchProjectInfoBySubmissionIds: boom',
    )
  })
})
