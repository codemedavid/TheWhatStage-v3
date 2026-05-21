import { afterEach, describe, expect, it } from 'vitest'
import {
  __leadCacheResetForTests,
  leadCacheClear,
  leadCacheGet,
  leadCacheSet,
} from './cache'

describe('leads/cache', () => {
  afterEach(() => __leadCacheResetForTests())

  it('returns undefined when key not set', () => {
    expect(leadCacheGet('ns', 'lead-1', 'k')).toBeUndefined()
  })

  it('round-trips a value under (namespace, leadId, key)', () => {
    leadCacheSet<number>('ns', 'lead-1', 'k', 42)
    expect(leadCacheGet<number>('ns', 'lead-1', 'k')).toBe(42)
  })

  it('does not leak between leads with the same namespace+key', () => {
    leadCacheSet('ns', 'lead-1', 'k', 'A')
    leadCacheSet('ns', 'lead-2', 'k', 'B')
    expect(leadCacheGet('ns', 'lead-1', 'k')).toBe('A')
    expect(leadCacheGet('ns', 'lead-2', 'k')).toBe('B')
  })

  it('does not leak between namespaces with the same leadId+key', () => {
    leadCacheSet('nsA', 'lead-1', 'k', 1)
    leadCacheSet('nsB', 'lead-1', 'k', 2)
    expect(leadCacheGet('nsA', 'lead-1', 'k')).toBe(1)
    expect(leadCacheGet('nsB', 'lead-1', 'k')).toBe(2)
  })

  it('leadCacheClear removes all entries for a single lead', () => {
    leadCacheSet('nsA', 'lead-1', 'k', 1)
    leadCacheSet('nsB', 'lead-1', 'k', 2)
    leadCacheSet('nsA', 'lead-2', 'k', 9)
    leadCacheClear('lead-1')
    expect(leadCacheGet('nsA', 'lead-1', 'k')).toBeUndefined()
    expect(leadCacheGet('nsB', 'lead-1', 'k')).toBeUndefined()
    expect(leadCacheGet('nsA', 'lead-2', 'k')).toBe(9)
  })
})
