import { describe, expect, it } from 'vitest'
import {
  MEDIA_KIND_LIMITS,
  isAllowedMediaMime,
  mediaKindFromMime,
  mediaKindLabel,
  messengerAttachmentTypeFor,
} from './kind'

describe('mediaKindFromMime', () => {
  it('maps image mimes to image', () => {
    expect(mediaKindFromMime('image/jpeg')).toBe('image')
    expect(mediaKindFromMime('image/webp')).toBe('image')
  })

  it('maps video mimes to video', () => {
    expect(mediaKindFromMime('video/mp4')).toBe('video')
    expect(mediaKindFromMime('video/quicktime')).toBe('video')
  })

  it('maps audio mimes to audio', () => {
    expect(mediaKindFromMime('audio/mpeg')).toBe('audio')
    expect(mediaKindFromMime('audio/mp4')).toBe('audio')
  })

  it('returns null for unsupported or empty mimes', () => {
    expect(mediaKindFromMime('application/pdf')).toBeNull()
    expect(mediaKindFromMime('')).toBeNull()
    expect(mediaKindFromMime(undefined)).toBeNull()
  })
})

describe('isAllowedMediaMime', () => {
  it('accepts the playable voice formats only', () => {
    expect(isAllowedMediaMime('audio/mpeg')).toBe(true)
    expect(isAllowedMediaMime('audio/mp4')).toBe(true)
    expect(isAllowedMediaMime('audio/wav')).toBe(true)
    expect(isAllowedMediaMime('audio/webm')).toBe(false)
    expect(isAllowedMediaMime('audio/ogg')).toBe(false)
  })

  it('accepts mp4 and mov video', () => {
    expect(isAllowedMediaMime('video/mp4')).toBe(true)
    expect(isAllowedMediaMime('video/quicktime')).toBe(true)
    expect(isAllowedMediaMime('video/x-msvideo')).toBe(false)
  })
})

describe('MEDIA_KIND_LIMITS', () => {
  it('caps every kind at or below the Messenger 25 MB attachment limit', () => {
    const META_LIMIT = 25 * 1024 * 1024
    for (const kind of ['image', 'video', 'audio'] as const) {
      expect(MEDIA_KIND_LIMITS[kind].maxBytes).toBeLessThanOrEqual(META_LIMIT)
    }
  })
})

describe('messengerAttachmentTypeFor', () => {
  it('returns the Messenger attachment type for a mime', () => {
    expect(messengerAttachmentTypeFor('image/png')).toBe('image')
    expect(messengerAttachmentTypeFor('video/mp4')).toBe('video')
    expect(messengerAttachmentTypeFor('audio/mpeg')).toBe('audio')
  })

  it('throws for a mime that cannot be sent', () => {
    expect(() => messengerAttachmentTypeFor('application/pdf')).toThrow(/unsupported/i)
  })
})

describe('mediaKindLabel', () => {
  it('uses customer-facing wording for audio', () => {
    expect(mediaKindLabel('audio')).toBe('voice message')
    expect(mediaKindLabel('video')).toBe('video')
    expect(mediaKindLabel('image')).toBe('image')
  })
})
