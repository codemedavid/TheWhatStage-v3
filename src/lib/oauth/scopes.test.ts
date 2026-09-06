import { describe, expect, it } from 'vitest'
import { resolveRequestedScopes } from './scopes'

describe('resolveRequestedScopes', () => {
  it('grants everything when no scope is requested', () => {
    expect(resolveRequestedScopes(undefined)).toEqual(['read', 'send', 'projects'])
    expect(resolveRequestedScopes('')).toEqual(['read', 'send', 'projects'])
  })

  it('narrows to the requested subset in canonical order', () => {
    expect(resolveRequestedScopes('projects read')).toEqual(['read', 'projects'])
  })

  it('returns null for an unknown scope', () => {
    expect(resolveRequestedScopes('read admin')).toBeNull()
  })
})
