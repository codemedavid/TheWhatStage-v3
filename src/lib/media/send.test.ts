import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendOutbound = vi.fn()
vi.mock('@/lib/messenger/outbound', () => ({
  sendOutbound: (...args: unknown[]) => sendOutbound(...args),
}))

import { buildMediaPayload, loadSendableAssets, sendMediaAssets, type SendableMediaAsset } from './send'

const THREAD = { id: 't1', psid: 'psid-1', last_inbound_at: '2026-09-07T00:00:00Z', user_id: 'u1' }

function asset(over: Partial<SendableMediaAsset> = {}): SendableMediaAsset {
  return {
    id: 'a1',
    name: 'Intro voice',
    slug: 'intro-voice',
    storagePath: 'u1/intro.mp3',
    mimeType: 'audio/mpeg',
    ...over,
  }
}

function makeAdmin(opts: { signFail?: Set<string>; insertError?: { code?: string; message: string } | null; rows?: unknown[] } = {}) {
  const inserts: Record<string, unknown>[] = []
  const admin = {
    inserts,
    from(table: string) {
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.in = () => chain
      chain.insert = (row: Record<string, unknown>) => {
        inserts.push({ table, ...row })
        return Promise.resolve({ error: opts.insertError ?? null })
      }
      chain.then = (resolve: (v: unknown) => void) => resolve({ data: opts.rows ?? [], error: null })
      return chain
    },
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) =>
          opts.signFail?.has(path)
            ? { data: null, error: new Error('sign failed') }
            : { data: { signedUrl: `https://signed/${path}` }, error: null },
      }),
    },
  }
  return admin
}

beforeEach(() => {
  sendOutbound.mockReset()
  sendOutbound.mockResolvedValue({ sent: true, messageId: 'mid-1' })
})

describe('buildMediaPayload', () => {
  it('builds an image payload for image mimes', () => {
    expect(buildMediaPayload('image/png', 'https://x/img')).toEqual({ kind: 'image', imageUrl: 'https://x/img' })
  })

  it('builds attachment payloads for video and audio', () => {
    expect(buildMediaPayload('video/mp4', 'https://x/v')).toEqual({ kind: 'video', url: 'https://x/v' })
    expect(buildMediaPayload('audio/mpeg', 'https://x/a')).toEqual({ kind: 'audio', url: 'https://x/a' })
  })
})

describe('sendMediaAssets', () => {
  it('sends each asset with the payload kind derived from its mime and persists inbox rows', async () => {
    const admin = makeAdmin()
    const result = await sendMediaAssets({
      admin: admin as never,
      thread: THREAD,
      pageToken: 'tok',
      assets: [asset(), asset({ id: 'a2', name: 'Demo', slug: 'demo', storagePath: 'u1/demo.mp4', mimeType: 'video/mp4' })],
      kind: 'bot',
      sender: 'bot',
      logTag: 'test',
    })

    expect(sendOutbound).toHaveBeenCalledTimes(2)
    expect(sendOutbound.mock.calls[0][0]).toMatchObject({
      pageToken: 'tok',
      kind: 'bot',
      payload: { kind: 'audio', url: 'https://signed/u1/intro.mp3' },
    })
    expect(sendOutbound.mock.calls[1][0]).toMatchObject({
      payload: { kind: 'video', url: 'https://signed/u1/demo.mp4' },
    })
    expect(result.sent.map((s) => s.assetId)).toEqual(['a1', 'a2'])
    expect(admin.inserts).toHaveLength(2)
    expect(admin.inserts[0]).toMatchObject({
      table: 'messenger_messages',
      thread_id: 't1',
      user_id: 'u1',
      direction: 'outbound',
      sender: 'bot',
      fb_message_id: 'mid-1',
      media_asset_id: 'a1',
      body: '[audio] Intro voice',
      attachments: [{ type: 'audio', media_asset_id: 'a1', storage_path: 'u1/intro.mp3' }],
    })
  })

  it('skips an asset whose URL cannot be signed and keeps going', async () => {
    const admin = makeAdmin({ signFail: new Set(['u1/intro.mp3']) })
    const result = await sendMediaAssets({
      admin: admin as never,
      thread: THREAD,
      pageToken: 'tok',
      assets: [asset(), asset({ id: 'a2', storagePath: 'u1/b.mp3' })],
      kind: 'bot',
      sender: 'bot',
      logTag: 'test',
    })
    expect(sendOutbound).toHaveBeenCalledTimes(1)
    expect(result.skipped).toEqual([{ assetId: 'a1', reason: 'sign_failed' }])
    expect(result.sent.map((s) => s.assetId)).toEqual(['a2'])
  })

  it('stops after the first policy block since later sends would be blocked too', async () => {
    sendOutbound.mockResolvedValueOnce({ sent: false, reason: 'window' })
    const admin = makeAdmin()
    const result = await sendMediaAssets({
      admin: admin as never,
      thread: THREAD,
      pageToken: 'tok',
      assets: [asset(), asset({ id: 'a2' })],
      kind: 'bot',
      sender: 'bot',
      logTag: 'test',
    })
    expect(sendOutbound).toHaveBeenCalledTimes(1)
    expect(result.sent).toEqual([])
    expect(result.skipped).toEqual([
      { assetId: 'a1', reason: 'send_blocked:window' },
      { assetId: 'a2', reason: 'send_blocked:window' },
    ])
  })

  it('records a thrown send as send_failed and continues with the next asset', async () => {
    sendOutbound.mockRejectedValueOnce(new Error('graph 500'))
    const admin = makeAdmin()
    const result = await sendMediaAssets({
      admin: admin as never,
      thread: THREAD,
      pageToken: 'tok',
      assets: [asset(), asset({ id: 'a2' })],
      kind: 'bot',
      sender: 'bot',
      logTag: 'test',
    })
    expect(result.skipped).toEqual([{ assetId: 'a1', reason: 'send_failed' }])
    expect(result.sent.map((s) => s.assetId)).toEqual(['a2'])
  })

  it('treats a duplicate inbox row (23505) as success', async () => {
    const admin = makeAdmin({ insertError: { code: '23505', message: 'dup' } })
    const result = await sendMediaAssets({
      admin: admin as never,
      thread: THREAD,
      pageToken: 'tok',
      assets: [asset()],
      kind: 'bot',
      sender: 'bot',
      logTag: 'test',
    })
    expect(result.sent).toHaveLength(1)
  })

  it('returns empty results without touching the network for no assets', async () => {
    const admin = makeAdmin()
    const result = await sendMediaAssets({
      admin: admin as never,
      thread: THREAD,
      pageToken: 'tok',
      assets: [],
      kind: 'bot',
      sender: 'bot',
      logTag: 'test',
    })
    expect(sendOutbound).not.toHaveBeenCalled()
    expect(result).toEqual({ sent: [], skipped: [] })
  })
})

describe('loadSendableAssets', () => {
  it('returns assets in the requested order, dropping archived and unknown ids', async () => {
    const admin = makeAdmin({
      rows: [
        { id: 'a2', name: 'Two', slug: 'two', storage_path: 'p2', mime_type: 'video/mp4', is_archived: false },
        { id: 'a1', name: 'One', slug: 'one', storage_path: 'p1', mime_type: 'audio/mpeg', is_archived: false },
        { id: 'a3', name: 'Three', slug: 'three', storage_path: 'p3', mime_type: 'image/png', is_archived: true },
      ],
    })
    const assets = await loadSendableAssets(admin as never, 'u1', ['a1', 'a2', 'a3', 'missing'])
    expect(assets.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(assets[0]).toEqual({ id: 'a1', name: 'One', slug: 'one', storagePath: 'p1', mimeType: 'audio/mpeg' })
  })

  it('returns an empty list for no ids without querying', async () => {
    const admin = makeAdmin()
    const fromSpy = vi.spyOn(admin, 'from')
    expect(await loadSendableAssets(admin as never, 'u1', [])).toEqual([])
    expect(fromSpy).not.toHaveBeenCalled()
  })
})
