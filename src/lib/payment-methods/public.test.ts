import { describe, expect, it } from 'vitest'
import { filterAllowedIds } from './public'

describe('filterAllowedIds', () => {
  it('returns all when no exclusions', () => {
    expect(filterAllowedIds(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c'])
  })
  it('drops excluded ids and preserves order', () => {
    expect(filterAllowedIds(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c'])
  })
  it('dedupes the exclusion set', () => {
    expect(filterAllowedIds(['a', 'b'], ['a', 'a'])).toEqual(['b'])
  })
})
