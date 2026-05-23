import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  admin: null as unknown,
  decryptToken: vi.fn((token: string) => `decrypted:${token}`),
  fetch: vi.fn(),
}))

vi.mock('@/lib/facebook/crypto', () => ({
  decryptToken: mocks.decryptToken,
}))

vi.stubGlobal('fetch', mocks.fetch)

import { dispatchCapiEvent } from './capi'

function makeAdmin(opts: {
  page?: Record<string, unknown> | null
  actionPage?: Record<string, unknown> | null
  lead?: Record<string, unknown> | null
  insertOk?: boolean
}) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
  const from = vi.fn((table: string) => {
    if (table === 'facebook_pages') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: opts.page ?? null, error: null }),
          }),
        }),
      }
    }
    if (table === 'action_pages') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: opts.actionPage ?? null, error: null }),
          }),
        }),
      }
    }
    if (table === 'leads') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: opts.lead ?? null, error: null }),
          }),
        }),
      }
    }
    if (table === 'capi_event_logs') {
      return {
        insert: (row: Record<string, unknown>) => {
          inserts.push({ table, row })
          return { error: opts.insertOk === false ? { message: 'insert failed' } : null }
        },
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
  return { admin: { from }, inserts }
}

function baseInput(overrides: Partial<Parameters<typeof dispatchCapiEvent>[0]> = {}) {
  return {
    admin: undefined as unknown,
    userId: 'u1',
    submissionId: 'sub-1',
    actionPageId: 'ap-1',
    actionPageKind: 'form' as const,
    actionPageSlug: 'welcome',
    outcome: 'submitted',
    psid: 'PSID1',
    pageRowId: 'page-row-1',
    parsedData: {},
    pageConfig: {},
    leadId: null,
    clientIp: '203.0.113.10',
    clientUserAgent: 'vitest',
    submissionCreatedAt: new Date('2024-05-23T16:00:00Z'),
    businessOrderId: null,
    catalogOrder: null,
    ...overrides,
  }
}

beforeEach(() => {
  mocks.fetch.mockReset()
})

describe('dispatchCapiEvent — skip paths', () => {
  it('skips with no_messenger_context when psid is null', async () => {
    const { admin, inserts } = makeAdmin({})
    await dispatchCapiEvent({ ...baseInput({ psid: null, admin }) })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(inserts).toHaveLength(1)
    expect(inserts[0].row).toMatchObject({ status: 'skipped', skip_reason: 'no_messenger_context' })
  })

  it('skips with no_messenger_context when pageRowId is null', async () => {
    const { admin, inserts } = makeAdmin({})
    await dispatchCapiEvent({ ...baseInput({ pageRowId: null, admin }) })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(inserts[0].row).toMatchObject({ status: 'skipped', skip_reason: 'no_messenger_context' })
  })

  it('skips with disabled when facebook_pages.capi_enabled is false', async () => {
    const { admin, inserts } = makeAdmin({
      page: { fb_page_id: 'P1', capi_enabled: false, capi_dataset_id: null, capi_access_token: null, capi_test_event_code: null },
      actionPage: { capi_event_name_override: null },
    })
    await dispatchCapiEvent({ ...baseInput({ admin }) })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(inserts[0].row).toMatchObject({ status: 'skipped', skip_reason: 'disabled' })
  })

  it('skips with not_configured when dataset_id missing', async () => {
    const { admin, inserts } = makeAdmin({
      page: { fb_page_id: 'P1', capi_enabled: true, capi_dataset_id: null, capi_access_token: 'tok', capi_test_event_code: null },
      actionPage: { capi_event_name_override: null },
    })
    await dispatchCapiEvent({ ...baseInput({ admin }) })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(inserts[0].row).toMatchObject({ status: 'skipped', skip_reason: 'not_configured' })
  })

  it('skips with outcome_skip for qualification/disqualified', async () => {
    const { admin, inserts } = makeAdmin({
      page: { fb_page_id: 'P1', capi_enabled: true, capi_dataset_id: 'DS', capi_access_token: 'tok', capi_test_event_code: null },
      actionPage: { capi_event_name_override: null },
    })
    await dispatchCapiEvent({ ...baseInput({ admin, actionPageKind: 'qualification', outcome: 'disqualified' }) })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(inserts[0].row).toMatchObject({ status: 'skipped', skip_reason: 'outcome_skip' })
  })

  it('skips with outcome_skip when override is "SKIP"', async () => {
    const { admin, inserts } = makeAdmin({
      page: { fb_page_id: 'P1', capi_enabled: true, capi_dataset_id: 'DS', capi_access_token: 'tok', capi_test_event_code: null },
      actionPage: { capi_event_name_override: 'SKIP' },
    })
    await dispatchCapiEvent({ ...baseInput({ admin }) })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(inserts[0].row).toMatchObject({ status: 'skipped', skip_reason: 'outcome_skip' })
  })
})
