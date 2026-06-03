import { describe, it, expect } from 'vitest'
import { buildEmbedUrl } from './embed'

describe('buildEmbedUrl', () => {
  it('builds a privacy-friendly YouTube embed from a valid 11-char id', () => {
    expect(buildEmbedUrl('youtube', { videoId: 'dQw4w9WgXcQ' })).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1',
    )
  })

  it('builds a Vimeo embed, with optional unlisted hash', () => {
    expect(buildEmbedUrl('vimeo', { videoId: '123456789' })).toBe(
      'https://player.vimeo.com/video/123456789',
    )
    expect(buildEmbedUrl('vimeo', { videoId: '123456789', hash: 'abc123' })).toBe(
      'https://player.vimeo.com/video/123456789?h=abc123',
    )
  })

  it('builds a Loom embed', () => {
    expect(buildEmbedUrl('loom', { videoId: 'abcdef123456' })).toBe(
      'https://www.loom.com/embed/abcdef123456',
    )
  })

  it('returns null for imagekit (signed <video>, not an iframe)', () => {
    expect(buildEmbedUrl('imagekit', { videoId: null })).toBeNull()
  })

  it('rejects malformed / malicious ids (never renders an attacker URL)', () => {
    expect(buildEmbedUrl('youtube', { videoId: 'not-an-id' })).toBeNull()
    expect(buildEmbedUrl('youtube', { videoId: '"><script>' })).toBeNull()
    expect(buildEmbedUrl('youtube', { videoId: '../../etc' })).toBeNull()
    expect(buildEmbedUrl('vimeo', { videoId: 'abc' })).toBeNull()
    expect(buildEmbedUrl('vimeo', { videoId: '123', hash: 'bad hash!' })).toBe(
      'https://player.vimeo.com/video/123',
    )
    expect(buildEmbedUrl('loom', { videoId: 'short' })).toBeNull()
    expect(buildEmbedUrl('youtube', { videoId: null })).toBeNull()
    expect(buildEmbedUrl('youtube', { videoId: '' })).toBeNull()
  })
})
