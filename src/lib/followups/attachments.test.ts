import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/action-pages/urls', () => ({
  deeplinkActionPageUrl: vi.fn((secret: string, claims: Record<string, unknown>) =>
    `https://app/a/${claims.slug}?psid=${claims.psid}&pid=${claims.pageId}&exp=${claims.exp}&sig=${secret.slice(0, 4)}`,
  ),
}))

import { mintMediaAssetUrl, mintActionPageDeeplink } from './attachments'

function makeAdmin(opts: {
  asset?: { storage_path: string; is_archived: boolean } | null
  signedUrl?: string | null
  page?: {
    slug: string
    signing_secret: string
    cta_label?: string | null
    title?: string | null
    bot_send_instructions?: string | null
  } | null
} = {}) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.maybeSingle = async () => {
        if (table === 'media_assets') return { data: opts.asset ?? null, error: null }
        if (table === 'action_pages') return { data: opts.page  ?? null, error: null }
        return { data: null, error: null }
      }
      return chain
    },
    storage: {
      from(_bucket: string) {
        return {
          createSignedUrl: async (_path: string, _ttl: number) =>
            opts.signedUrl === null
              ? { data: null, error: new Error('no') }
              : { data: { signedUrl: opts.signedUrl ?? 'https://signed/url' }, error: null },
        }
      },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('mintMediaAssetUrl', () => {
  it('returns the signed URL for an active asset owned by the user', async () => {
    const admin = makeAdmin({ asset: { storage_path: 'u1/f1/a1.jpg', is_archived: false } })
    const url = await mintMediaAssetUrl(admin as never, 'a1', 'u1')
    expect(url).toBe('https://signed/url')
  })

  it('returns null when the asset is archived', async () => {
    const admin = makeAdmin({ asset: { storage_path: 'u1/f1/a1.jpg', is_archived: true } })
    const url = await mintMediaAssetUrl(admin as never, 'a1', 'u1')
    expect(url).toBeNull()
  })

  it('returns null when the asset is missing', async () => {
    const admin = makeAdmin({ asset: null })
    const url = await mintMediaAssetUrl(admin as never, 'a1', 'u1')
    expect(url).toBeNull()
  })

  it('returns null when the storage layer fails to sign', async () => {
    const admin = makeAdmin({
      asset: { storage_path: 'u1/f1/a1.jpg', is_archived: false },
      signedUrl: null,
    })
    const url = await mintMediaAssetUrl(admin as never, 'a1', 'u1')
    expect(url).toBeNull()
  })
})

describe('mintActionPageDeeplink', () => {
  it('returns the signed deeplink plus the page CTA context', async () => {
    const admin = makeAdmin({
      page: {
        slug: 'booking',
        signing_secret: 'secret-xyz',
        cta_label: 'Open form',
        title: 'Booking',
        bot_send_instructions: 'send when ready',
      },
    })
    const result = await mintActionPageDeeplink(admin as never, 'page-1', 'u1', {
      psid: 'PSID123',
      pageId: 'pageuuid-456',
    })
    expect(result?.url).toMatch(
      /https:\/\/app\/a\/booking\?psid=PSID123&pid=pageuuid-456&exp=\d+&sig=secr/,
    )
    expect(result).toMatchObject({ ctaLabel: 'Open form', title: 'Booking', instructions: 'send when ready' })
  })

  it('defaults missing cta_label/title/instructions to safe strings', async () => {
    const admin = makeAdmin({
      page: { slug: 'booking', signing_secret: 'secret-xyz', cta_label: null, title: null, bot_send_instructions: null },
    })
    const result = await mintActionPageDeeplink(admin as never, 'page-1', 'u1', {
      psid: 'PSID123',
      pageId: 'pageuuid-456',
    })
    expect(result).toMatchObject({ ctaLabel: '', title: '', instructions: '' })
  })

  it('returns null when the action page is missing', async () => {
    const admin = makeAdmin({ page: null })
    const result = await mintActionPageDeeplink(admin as never, 'page-1', 'u1', {
      psid: 'PSID123',
      pageId: 'pageuuid-456',
    })
    expect(result).toBeNull()
  })
})
