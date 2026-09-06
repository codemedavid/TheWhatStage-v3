import { createHash, randomBytes } from 'node:crypto'

// Key format: "wsk_" + 32 random bytes as base64url (43 chars). The prefix lets
// secret scanners and humans recognise a WhatStage key at a glance.
export const API_KEY_PREFIX = 'wsk_'
const RANDOM_BYTES = 32
// Display stub length ("wsk_" + 8 chars) — enough to tell keys apart, useless
// for guessing the rest.
const DISPLAY_PREFIX_LEN = API_KEY_PREFIX.length + 8

export interface GeneratedApiKey {
  /** Full secret. Shown to the user exactly once; never persisted. */
  plaintext: string
  /** Display stub persisted for the key list. */
  prefix: string
  /** sha256(plaintext) hex — the only thing stored server-side. */
  hash: string
}

export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}

export function generateApiKey(): GeneratedApiKey {
  const plaintext = API_KEY_PREFIX + randomBytes(RANDOM_BYTES).toString('base64url')
  return {
    plaintext,
    prefix: plaintext.slice(0, DISPLAY_PREFIX_LEN),
    hash: hashApiKey(plaintext),
  }
}

// Cheap shape check before hitting the database.
export function looksLikeApiKey(value: string): boolean {
  return value.startsWith(API_KEY_PREFIX) && value.length >= DISPLAY_PREFIX_LEN + 20
}
