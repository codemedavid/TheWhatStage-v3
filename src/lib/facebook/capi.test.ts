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

describe('dispatchCapiEvent — network paths', () => {
  const enabledPage = {
    fb_page_id: 'P1',
    capi_enabled: true,
    capi_dataset_id: 'DS123',
    capi_access_token: 'enc:tok',
    capi_test_event_code: null,
  }
  const noOverride = { capi_event_name_override: null }

  it('logs sent on 2xx with http_status + fb_trace_id', async () => {
    const { admin, inserts } = makeAdmin({ page: enabledPage, actionPage: noOverride })
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ events_received: 1, fbtrace_id: 'trace-XYZ' }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-fb-trace-id': 'trace-XYZ' },
      }),
    )
    await dispatchCapiEvent({ ...baseInput({ admin }) })
    expect(mocks.fetch).toHaveBeenCalledOnce()
    const [url, init] = mocks.fetch.mock.calls[0]
    expect(url).toBe('https://graph.facebook.com/v24.0/DS123/events?access_token=decrypted%3Aenc%3Atok')
    expect((init as RequestInit).method).toBe('POST')
    expect(inserts[0].row).toMatchObject({
      status: 'sent',
      event_name: 'Lead',
      http_status: 200,
      fb_trace_id: 'trace-XYZ',
    })
  })

  it('logs error on 4xx with response_body', async () => {
    const { admin, inserts } = makeAdmin({ page: enabledPage, actionPage: noOverride })
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'bad event_id', fbtrace_id: 'trace-ERR' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await dispatchCapiEvent({ ...baseInput({ admin }) })
    expect(inserts[0].row).toMatchObject({
      status: 'error',
      http_status: 400,
      fb_trace_id: 'trace-ERR',
    })
    expect(inserts[0].row.response_body).toMatchObject({ error: { message: 'bad event_id' } })
    expect(inserts[0].row.error_message).toBe('bad event_id')
  })

  it('logs error on network failure', async () => {
    const { admin, inserts } = makeAdmin({ page: enabledPage, actionPage: noOverride })
    mocks.fetch.mockRejectedValueOnce(new Error('ENOTFOUND'))
    await dispatchCapiEvent({ ...baseInput({ admin }) })
    expect(inserts[0].row).toMatchObject({ status: 'error' })
    expect(inserts[0].row.error_message).toMatch(/ENOTFOUND/)
  })

  it('propagates test_event_code when set', async () => {
    const { admin } = makeAdmin({
      page: { ...enabledPage, capi_test_event_code: 'TEST123' },
      actionPage: noOverride,
    })
    mocks.fetch.mockResolvedValueOnce(new Response('{}', { status: 200 }))
    await dispatchCapiEvent({ ...baseInput({ admin }) })
    const [, init] = mocks.fetch.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.test_event_code).toBe('TEST123')
    expect(body.data).toHaveLength(1)
  })

  it('includes lead contact data when leadId is set', async () => {
    const { admin } = makeAdmin({
      page: enabledPage,
      actionPage: noOverride,
      lead: { phones: ['+63 917 555 1234'], emails: ['Foo@Bar.COM'], name: 'Ada Lovelace' },
    })
    mocks.fetch.mockResolvedValueOnce(new Response('{}', { status: 200 }))
    await dispatchCapiEvent({ ...baseInput({ admin, leadId: 'lead-1' }) })
    const [, init] = mocks.fetch.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.data[0].user_data.em).toBeDefined()
    expect(body.data[0].user_data.ph).toBeDefined()
    expect(body.data[0].user_data.fn).toBeDefined()
    expect(body.data[0].user_data.ln).toBeDefined()
    expect(body.data[0].user_data.external_id).toBeDefined()
  })
})
