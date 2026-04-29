import { describe, it, expect, beforeAll } from 'vitest'
import { randomBytes } from 'node:crypto'

beforeAll(() => {
  process.env.FB_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64')
})

describe('facebook/crypto', () => {
  it('round-trips plaintext through encrypt/decrypt', async () => {
    const { encryptToken, decryptToken } = await import('./crypto')
    const plain = 'EAAB-fake-long-lived-token'
    const envelope = encryptToken(plain)
    expect(envelope).not.toContain(plain)
    expect(decryptToken(envelope)).toBe(plain)
  })

  it('throws when the envelope is tampered with', async () => {
    const { encryptToken, decryptToken } = await import('./crypto')
    const envelope = encryptToken('secret')
    const buf = Buffer.from(envelope, 'base64')
    buf[buf.length - 1] ^= 0x01
    const tampered = buf.toString('base64')
    expect(() => decryptToken(tampered)).toThrow()
  })
})
