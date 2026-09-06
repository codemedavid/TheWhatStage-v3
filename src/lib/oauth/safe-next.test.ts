import { describe, expect, it } from 'vitest'
import { safeNextPath } from './safe-next'

describe('safeNextPath', () => {
  it('accepts a same-origin path with a query', () => {
    expect(safeNextPath('/oauth/authorize?client_id=x&state=y')).toBe('/oauth/authorize?client_id=x&state=y')
  })

  const rejected: Array<[string, unknown]> = [
    ['protocol-relative', '//evil.example'],
    ['backslash trick', '/\\evil.example'],
    ['absolute url', 'https://evil.example'],
    ['scheme', 'javascript:alert(1)'],
    ['control char', '/ok\nLocation: x'],
    ['empty', ''],
    ['non-string', 42],
    ['missing', undefined],
  ]
  it.each(rejected)('rejects %s', (_label, value) => {
    expect(safeNextPath(value)).toBeNull()
  })
})
