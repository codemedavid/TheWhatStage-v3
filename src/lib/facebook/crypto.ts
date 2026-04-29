import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALG = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16

function loadKey(): Buffer {
  const raw = process.env.FB_TOKEN_ENCRYPTION_KEY
  if (!raw) {
    throw new Error('FB_TOKEN_ENCRYPTION_KEY is required')
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error(
      `FB_TOKEN_ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}`,
    )
  }
  return key
}

const key = loadKey()

export function encryptToken(plain: string): string {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALG, key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct]).toString('base64')
}

export function decryptToken(envelope: string): string {
  const buf = Buffer.from(envelope, 'base64')
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error('envelope too short')
  }
  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ct = buf.subarray(IV_LEN + TAG_LEN)
  const decipher = createDecipheriv(ALG, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}
