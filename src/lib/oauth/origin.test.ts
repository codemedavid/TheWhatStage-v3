import { afterEach, describe, expect, it } from 'vitest'
import { protectedResourceMetadataUrl, publicOrigin } from './origin'

const ORIGINAL = process.env.NEXT_PUBLIC_APP_URL

afterEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = ORIGINAL
})

describe('publicOrigin', () => {
  it('prefers a well-formed NEXT_PUBLIC_APP_URL', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.whatstage.com/'
    const req = new Request('http://localhost:3000/api/mcp')
    expect(publicOrigin(req)).toBe('https://app.whatstage.com')
  })

  it('falls back to forwarded headers when the env var has no scheme', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'localhost:3000'
    const req = new Request('http://internal:3000/api/mcp', {
      headers: { 'x-forwarded-host': 'app.whatstage.com', 'x-forwarded-proto': 'https' },
    })
    expect(publicOrigin(req)).toBe('https://app.whatstage.com')
  })

  it('falls back to the request URL with no headers', () => {
    process.env.NEXT_PUBLIC_APP_URL = ''
    expect(publicOrigin(new Request('http://localhost:3000/x'))).toBe('http://localhost:3000')
  })

  it('points the 401 at the path-based resource metadata document', () => {
    expect(protectedResourceMetadataUrl('https://a.b')).toBe('https://a.b/.well-known/oauth-protected-resource/api/mcp')
  })
})
