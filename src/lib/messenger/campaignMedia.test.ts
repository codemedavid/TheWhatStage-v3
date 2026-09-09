import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loadAssetsMock, sendMediaMock } = vi.hoisted(() => ({ loadAssetsMock: vi.fn(), sendMediaMock: vi.fn() }))
vi.mock('@/lib/media/send', () => ({ loadSendableAssets: loadAssetsMock, sendMediaAssets: sendMediaMock }))

import { sendCampaignMedia } from './campaignMedia'

const thread = { id: 't1', psid: 'p1', last_inbound_at: '2026-09-07T00:00:00Z' }
const admin = {} as never

beforeEach(() => {
  loadAssetsMock.mockReset()
  sendMediaMock.mockReset()
})

describe('sendCampaignMedia', () => {
  it('does nothing when the campaign has no media', async () => {
    const out = await sendCampaignMedia(admin, {
      campaign: { id: 'c1', user_id: 'u1', media_asset_ids: [] },
      thread, pageToken: 'tok', insideWindow: true,
    })
    expect(out).toEqual({ sent: 0, skipped: 0, reason: null })
    expect(loadAssetsMock).not.toHaveBeenCalled()
  })

  it('skips media outside the 24h window because attachments cannot ride the HUMAN_AGENT text', async () => {
    const out = await sendCampaignMedia(admin, {
      campaign: { id: 'c1', user_id: 'u1', media_asset_ids: ['a1'] },
      thread, pageToken: 'tok', insideWindow: false,
    })
    expect(out).toEqual({ sent: 0, skipped: 1, reason: 'outside_window' })
    expect(sendMediaMock).not.toHaveBeenCalled()
  })

  it('sends the campaign media as bot inside the window', async () => {
    const asset = { id: 'a1', name: 'Demo', slug: 'demo', storagePath: 'p', mimeType: 'video/mp4' }
    loadAssetsMock.mockResolvedValue([asset])
    sendMediaMock.mockResolvedValue({ sent: [{ assetId: 'a1', messageId: 'm' }], skipped: [] })
    const out = await sendCampaignMedia(admin, {
      campaign: { id: 'c1', user_id: 'u1', media_asset_ids: ['a1'] },
      thread, pageToken: 'tok', insideWindow: true,
    })
    expect(loadAssetsMock).toHaveBeenCalledWith(admin, 'u1', ['a1'])
    expect(sendMediaMock).toHaveBeenCalledWith(expect.objectContaining({
      assets: [asset], kind: 'bot', sender: 'bot', thread: { ...thread, user_id: 'u1' },
    }))
    expect(out).toEqual({ sent: 1, skipped: 0, reason: null })
  })

  it('never throws — a media failure is reported, not raised', async () => {
    loadAssetsMock.mockRejectedValue(new Error('db down'))
    const out = await sendCampaignMedia(admin, {
      campaign: { id: 'c1', user_id: 'u1', media_asset_ids: ['a1'] },
      thread, pageToken: 'tok', insideWindow: true,
    })
    expect(out).toEqual({ sent: 0, skipped: 1, reason: 'media_failed' })
  })
})
