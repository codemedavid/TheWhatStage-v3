import { describe, expect, it } from 'vitest'
import { attachmentDisplayUrl, normalizeAttachmentType, resolveMessageAttachments } from './attachments'

function fakeSupabase(signed: Record<string, string>) {
  const requested: string[] = []
  const supabase = {
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => {
          requested.push(path)
          return { data: signed[path] ? { signedUrl: signed[path] } : null, error: null }
        },
      }),
    },
  }
  return { supabase: supabase as never, requested }
}

describe('normalizeAttachmentType', () => {
  it('keeps known types and falls back to file', () => {
    expect(normalizeAttachmentType('image')).toBe('image')
    expect(normalizeAttachmentType('action_page')).toBe('action_page')
    expect(normalizeAttachmentType('sticker')).toBe('file')
    expect(normalizeAttachmentType(undefined)).toBe('file')
  })
})

describe('attachmentDisplayUrl', () => {
  it('prefers signed storage, then direct url, then Meta payload url', () => {
    const signed = new Map([['u1/a.png', 'https://signed/a.png']])
    expect(attachmentDisplayUrl({ storage_path: 'u1/a.png', url: 'https://x' }, signed)).toBe('https://signed/a.png')
    expect(attachmentDisplayUrl({ url: 'https://x' }, signed)).toBe('https://x')
    expect(attachmentDisplayUrl({ payload: { url: 'https://cdn' } }, signed)).toBe('https://cdn')
    expect(attachmentDisplayUrl({}, signed)).toBeNull()
  })
})

describe('resolveMessageAttachments', () => {
  it('signs each storage path once and normalizes inbound Meta and outbound operator shapes', async () => {
    const { supabase, requested } = fakeSupabase({ 'u1/a.png': 'https://signed/a.png' })
    const rows = [
      {
        id: 'm1', direction: 'inbound' as const, sender: 'user' as const, body: '', created_at: 't', error: null,
        attachments: [{ type: 'image', payload: { url: 'https://cdn/x.jpg' } }],
      },
      {
        id: 'm2', direction: 'outbound' as const, sender: 'operator' as const, body: 'hi', created_at: 't', error: null,
        attachments: [
          { type: 'image', storage_path: 'u1/a.png', name: 'a.png' },
          { type: 'image', storage_path: 'u1/a.png' },
          { type: 'action_page', url: 'https://app/a/x', name: 'Book' },
        ],
      },
      { id: 'm3', direction: 'inbound' as const, sender: 'user' as const, body: 'no att', created_at: 't', error: null, attachments: null },
    ]

    const out = await resolveMessageAttachments(supabase, rows)

    expect(requested).toEqual(['u1/a.png'])
    expect(out[0].attachments).toEqual([{ type: 'image', url: 'https://cdn/x.jpg', name: null }])
    expect(out[1].attachments).toEqual([
      { type: 'image', url: 'https://signed/a.png', name: 'a.png' },
      { type: 'image', url: 'https://signed/a.png', name: null },
      { type: 'action_page', url: 'https://app/a/x', name: 'Book' },
    ])
    expect(out[2].attachments).toEqual([])
  })
})
