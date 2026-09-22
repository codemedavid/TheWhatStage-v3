import { beforeEach, describe, expect, it, vi } from 'vitest'

const dispatch = vi.fn()
vi.mock('@/lib/messenger/operator-send', () => ({
  dispatchOperatorSendFor: (args: unknown) => dispatch(args),
}))

const loadSendableAssets = vi.fn()
vi.mock('./send', async (importActual) => {
  const actual = await importActual<typeof import('./send')>()
  return { ...actual, loadSendableAssets: (...args: unknown[]) => loadSendableAssets(...args) }
})

import { sendMediaAssetFor } from './operator-send'

const ASSET = { id: 'a1', name: 'Intro voice', slug: 'intro-voice', storagePath: 'u1/intro.mp3', mimeType: 'audio/mpeg' }

function makeClient(signOk = true) {
  return {
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) =>
          signOk ? { data: { signedUrl: `https://signed/${path}` }, error: null } : { data: null, error: new Error('nope') },
      }),
    },
  } as never
}

beforeEach(() => {
  dispatch.mockReset()
  dispatch.mockResolvedValue({ ok: true })
  loadSendableAssets.mockReset()
  loadSendableAssets.mockResolvedValue([ASSET])
})

describe('sendMediaAssetFor', () => {
  it('returns media_not_found when the asset is missing or archived', async () => {
    loadSendableAssets.mockResolvedValue([])
    const result = await sendMediaAssetFor(makeClient(), 'u1', 'lead-1', 'a1')
    expect(result).toEqual({ ok: false, error: 'media_not_found' })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('returns media_sign_failed when the storage URL cannot be signed', async () => {
    const result = await sendMediaAssetFor(makeClient(false), 'u1', 'lead-1', 'a1')
    expect(result).toEqual({ ok: false, error: 'media_sign_failed' })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('dispatches an operator send with the audio payload and re-signable attachment', async () => {
    const result = await sendMediaAssetFor(makeClient(), 'u1', 'lead-1', 'a1')
    expect(result).toEqual({ ok: true })
    expect(dispatch).toHaveBeenCalledTimes(1)
    const args = dispatch.mock.calls[0][0] as { leadId: string; userId: string; build: () => unknown }
    expect(args.leadId).toBe('lead-1')
    expect(args.userId).toBe('u1')
    expect(args.build()).toEqual({
      payload: { kind: 'audio', url: 'https://signed/u1/intro.mp3' },
      body: '[audio] Intro voice',
      attachments: [{ type: 'audio', media_asset_id: 'a1', storage_path: 'u1/intro.mp3', name: 'Intro voice' }],
    })
  })
})
