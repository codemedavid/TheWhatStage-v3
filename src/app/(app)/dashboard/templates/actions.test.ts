import { describe, expect, it, vi, beforeEach } from 'vitest'

// ── mocks ──
const getUserMock = vi.hoisted(() => vi.fn())
const userFromMock = vi.hoisted(() => vi.fn())
const adminFromMock = vi.hoisted(() => vi.fn())
const createTemplateMock = vi.hoisted(() => vi.fn())
const fetchAllMock = vi.hoisted(() => vi.fn())
const resolveTargetPageMock = vi.hoisted(() => vi.fn())

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn(() => { throw new Error('redirect') }) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock }, from: userFromMock }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: adminFromMock }) }))
vi.mock('@/lib/facebook/crypto', () => ({ decryptToken: (t: string) => t }))
vi.mock('@/lib/facebook/templates-page-resolver', () => ({ resolveTargetPage: resolveTargetPageMock }))
// Partial mock: keep MetaTemplateError real so `instanceof` works in the action.
vi.mock('@/lib/facebook/messenger-templates', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/facebook/messenger-templates')>()
  return { ...actual, createMessengerTemplate: createTemplateMock, fetchAllMessengerTemplates: fetchAllMock }
})

import { submitTemplatesForReview, refreshTemplateStatuses } from './actions'
import { MetaTemplateError } from '@/lib/facebook/messenger-templates'

// terminal data the user-client select chain should resolve to
let selectRows: unknown[] = []
let rereadRows: unknown[] = []

function installUserClient() {
  userFromMock.mockImplementation(() => {
    let cols = ''
    const chain: Record<string, unknown> = {}
    chain.select = (c: string) => { cols = c; return chain }
    chain.in = () => chain
    chain.eq = () =>
      Promise.resolve({ data: cols.includes('messenger_template_categories') ? rereadRows : selectRows })
    return chain
  })
}

function installAdminClient(updates: Array<{ id: string; v: Record<string, unknown> }>) {
  adminFromMock.mockImplementation(() => ({
    update: (v: Record<string, unknown>) => ({
      eq: (_col: string, id: string) => {
        updates.push({ id, v })
        return Promise.resolve({ error: null })
      },
    }),
  }))
}

function rowWithCats(id: string, status: string, extra: Record<string, unknown> = {}) {
  return { id, name: id, display_name: id, meta_status: status, sample_values: [], buttons: [], messenger_template_categories: [], ...extra }
}

beforeEach(() => {
  getUserMock.mockReset()
  userFromMock.mockReset()
  adminFromMock.mockReset()
  createTemplateMock.mockReset()
  fetchAllMock.mockReset()
  resolveTargetPageMock.mockReset()
  getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
  resolveTargetPageMock.mockResolvedValue({ id: 'pg1', fb_page_id: 'fb1', page_access_token: 'enc1' })
  installUserClient()
})

describe('submitTemplatesForReview — partial failure', () => {
  it('records per-id outcomes, keeps permission-error rows as draft, resolves the page once', async () => {
    selectRows = [
      { id: 't1', name: 't1', page_id: null, language: 'en_US', body_text: 'a', variable_count: 0, sample_values: [], buttons: [], footer: null, meta_status: 'draft' },
      { id: 't2', name: 't2', page_id: null, language: 'en_US', body_text: 'b', variable_count: 0, sample_values: [], buttons: [], footer: null, meta_status: 'draft' },
      { id: 't3', name: 't3', page_id: null, language: 'en_US', body_text: 'c', variable_count: 0, sample_values: [], buttons: [], footer: null, meta_status: 'draft' },
    ]
    rereadRows = [rowWithCats('t1', 'approved'), rowWithCats('t2', 'draft'), rowWithCats('t3', 'rejected')]

    createTemplateMock.mockImplementation((args: { name: string }) => {
      if (args.name === 't1') return Promise.resolve({ id: 'm1', status: 'APPROVED' })
      if (args.name === 't2') return Promise.reject(new MetaTemplateError('(#200) perms', { code: 200, httpStatus: 403 }))
      return Promise.reject(new Error('Body contains a promotional phrase'))
    })

    const updates: Array<{ id: string; v: Record<string, unknown> }> = []
    installAdminClient(updates)

    const r = await submitTemplatesForReview(['t1', 't2', 't3'])
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const byId = Object.fromEntries(r.data.map((o) => [o.id, o]))
    expect(byId.t1.outcome).toBe('approved')
    expect(byId.t2.outcome).toBe('permission_error')
    expect(byId.t3.outcome).toBe('rejected')

    // page resolved exactly once for the whole batch (all share page_id null)
    expect(resolveTargetPageMock).toHaveBeenCalledTimes(1)

    // t1 persisted approved; t3 persisted rejected; t2 (permission) NOT written
    expect(updates.find((u) => u.id === 't1')?.v.meta_status).toBe('approved')
    expect(updates.find((u) => u.id === 't3')?.v.meta_status).toBe('rejected')
    expect(updates.find((u) => u.id === 't2')).toBeUndefined()

    // each outcome carries the re-read row for client merge
    expect(byId.t1.row?.id).toBe('t1')
  })

  it('skips templates that are not draft/rejected', async () => {
    selectRows = [
      { id: 't1', name: 't1', page_id: null, language: 'en_US', body_text: 'a', variable_count: 0, sample_values: [], buttons: [], footer: null, meta_status: 'approved' },
    ]
    rereadRows = [rowWithCats('t1', 'approved')]
    const updates: Array<{ id: string; v: Record<string, unknown> }> = []
    installAdminClient(updates)

    const r = await submitTemplatesForReview(['t1'])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data[0].outcome).toBe('error')
    expect(createTemplateMock).not.toHaveBeenCalled()
  })
})

describe('refreshTemplateStatuses — only changed rows', () => {
  it('writes + returns approved flip, ignores still-pending', async () => {
    selectRows = [
      { id: 't1', name: 't1', language: 'en_US', page_id: null, meta_status: 'pending', meta_template_id: 'm1' },
      { id: 't2', name: 't2', language: 'en_US', page_id: null, meta_status: 'pending', meta_template_id: 'm2' },
    ]
    rereadRows = [rowWithCats('t1', 'approved')]
    fetchAllMock.mockResolvedValue([
      { id: 'm1', name: 't1', language: 'en_US', status: 'APPROVED', rejected_reason: null },
      { id: 'm2', name: 't2', language: 'en_US', status: 'PENDING', rejected_reason: null },
    ])
    const updates: Array<{ id: string; v: Record<string, unknown> }> = []
    installAdminClient(updates)

    const r = await refreshTemplateStatuses(['t1', 't2'])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.map((o) => o.id)).toEqual(['t1'])
    expect(r.data[0].changed).toBe(true)
    expect(r.data[0].row?.id).toBe('t1')
    // only t1 written; t2 unchanged (still pending, id already present)
    expect(updates.map((u) => u.id)).toEqual(['t1'])
    expect(updates[0].v.meta_status).toBe('approved')
  })
})
