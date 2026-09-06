import { describe, expect, it } from 'vitest'
import { isValidCodeVerifier, s256Challenge, verifyPkceS256 } from './pkce'

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'

describe('PKCE S256', () => {
  it('matches the RFC 7636 appendix B vector', () => {
    expect(s256Challenge(VERIFIER)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
    expect(verifyPkceS256(VERIFIER, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(true)
  })

  it('rejects a wrong verifier', () => {
    expect(verifyPkceS256(VERIFIER + 'x', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(false)
  })

  it('rejects verifiers outside the RFC alphabet or length', () => {
    expect(isValidCodeVerifier('short')).toBe(false)
    expect(isValidCodeVerifier('a'.repeat(43))).toBe(true)
    expect(isValidCodeVerifier('a'.repeat(129))).toBe(false)
    expect(isValidCodeVerifier('a'.repeat(42) + '!')).toBe(false)
  })
})
