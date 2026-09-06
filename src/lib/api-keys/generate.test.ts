import { describe, expect, it } from 'vitest'
import { API_KEY_PREFIX, generateApiKey, hashApiKey, looksLikeApiKey } from './generate'

describe('generateApiKey', () => {
  it('produces a wsk_-prefixed secret whose hash matches hashApiKey', () => {
    const key = generateApiKey()

    expect(key.plaintext.startsWith(API_KEY_PREFIX)).toBe(true)
    expect(key.prefix).toBe(key.plaintext.slice(0, 12))
    expect(key.hash).toBe(hashApiKey(key.plaintext))
    expect(key.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generates distinct keys on every call', () => {
    const a = generateApiKey()
    const b = generateApiKey()
    expect(a.plaintext).not.toBe(b.plaintext)
    expect(a.hash).not.toBe(b.hash)
  })

  it('looksLikeApiKey accepts generated keys and rejects junk', () => {
    expect(looksLikeApiKey(generateApiKey().plaintext)).toBe(true)
    expect(looksLikeApiKey('wsk_short')).toBe(false)
    expect(looksLikeApiKey('sk-not-ours-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false)
  })
})
