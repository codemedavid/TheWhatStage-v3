import { describe, it, expect } from 'vitest'
import { parseProviderRef, isValidProviderRef } from './providers'

describe('parseProviderRef — youtube', () => {
  const cases: Array<[string, string]> = [
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0', 'dQw4w9WgXcQ'],
    ['https://youtube-nocookie.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ]
  for (const [input, id] of cases) {
    it(`extracts ${id} from ${input}`, () => {
      const r = parseProviderRef('youtube', input)
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.ref.providerVideoId).toBe(id)
    })
  }
  it('rejects junk', () => {
    expect(parseProviderRef('youtube', 'https://example.com/foo').ok).toBe(false)
    expect(parseProviderRef('youtube', '').ok).toBe(false)
  })
})

describe('parseProviderRef — vimeo', () => {
  it('parses plain, hash-in-path and hash-in-query forms', () => {
    expect(parseProviderRef('vimeo', 'https://vimeo.com/123456789')).toEqual({
      ok: true,
      ref: { providerVideoId: '123456789', providerHash: null, sourcePath: null },
    })
    expect(parseProviderRef('vimeo', 'https://vimeo.com/123456789/abcdef')).toEqual({
      ok: true,
      ref: { providerVideoId: '123456789', providerHash: 'abcdef', sourcePath: null },
    })
    expect(parseProviderRef('vimeo', 'https://player.vimeo.com/video/123456789?h=zzz')).toEqual({
      ok: true,
      ref: { providerVideoId: '123456789', providerHash: 'zzz', sourcePath: null },
    })
    expect(parseProviderRef('vimeo', '987654321')).toEqual({
      ok: true,
      ref: { providerVideoId: '987654321', providerHash: null, sourcePath: null },
    })
  })
})

describe('parseProviderRef — loom', () => {
  it('parses share + embed links and bare ids', () => {
    const id = '0a1b2c3d4e5f6071'
    expect(parseProviderRef('loom', `https://www.loom.com/share/${id}`).ok).toBe(true)
    expect(parseProviderRef('loom', `https://loom.com/embed/${id}`).ok).toBe(true)
    expect(parseProviderRef('loom', id).ok).toBe(true)
    expect(parseProviderRef('loom', 'https://example.com/x').ok).toBe(false)
  })
})

describe('parseProviderRef — imagekit', () => {
  it('accepts full https URL or absolute path; rejects others', () => {
    expect(parseProviderRef('imagekit', 'https://ik.imagekit.io/acme/courses/x/l1.mp4')).toEqual({
      ok: true,
      ref: { providerVideoId: null, providerHash: null, sourcePath: 'https://ik.imagekit.io/acme/courses/x/l1.mp4' },
    })
    expect(parseProviderRef('imagekit', '/courses/x/l1.mp4')).toEqual({
      ok: true,
      ref: { providerVideoId: null, providerHash: null, sourcePath: '/courses/x/l1.mp4' },
    })
    expect(parseProviderRef('imagekit', 'http://insecure.example/x.mp4').ok).toBe(false)
    expect(parseProviderRef('imagekit', 'javascript:alert(1)').ok).toBe(false)
    expect(parseProviderRef('imagekit', 'relative/path.mp4').ok).toBe(false)
  })
})

describe('isValidProviderRef', () => {
  it('agrees with parseProviderRef', () => {
    expect(isValidProviderRef('youtube', 'dQw4w9WgXcQ')).toBe(true)
    expect(isValidProviderRef('youtube', 'nope')).toBe(false)
  })
})
