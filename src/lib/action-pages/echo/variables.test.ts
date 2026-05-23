import { describe, expect, it } from 'vitest'
import { ACTION_PAGE_KINDS } from '@/lib/action-pages/kinds'
import { VARIABLES_BY_KIND, knownPathsForKind, sampleContextForKind } from './variables'
import { renderEchoTemplate } from './render'

describe('VARIABLES_BY_KIND', () => {
  for (const kind of ACTION_PAGE_KINDS) {
    it(`has at least one variable for kind ${kind}`, () => {
      expect(VARIABLES_BY_KIND[kind].length).toBeGreaterThan(0)
    })

    it(`has unique paths for kind ${kind}`, () => {
      const paths = VARIABLES_BY_KIND[kind].map((v) => v.path)
      expect(new Set(paths).size).toBe(paths.length)
    })

    it(`has label, sample, and group for every variable in ${kind}`, () => {
      for (const v of VARIABLES_BY_KIND[kind]) {
        expect(v.label.length).toBeGreaterThan(0)
        expect(v.sample.length).toBeGreaterThan(0)
        expect(v.group.length).toBeGreaterThan(0)
      }
    })

    it(`renders every variable for ${kind} against its sample without warnings`, () => {
      const known = knownPathsForKind(kind, [])
      const ctx = sampleContextForKind(kind, [])
      for (const v of VARIABLES_BY_KIND[kind]) {
        const result = renderEchoTemplate(`{{${v.path}}}`, ctx, known)
        expect(result.warnings).toEqual([])
        expect(result.text).toBe(v.sample)
      }
    })
  }
})

describe('knownPathsForKind', () => {
  it('extends with custom.<key> paths for kinds that accept custom fields', () => {
    const known = knownPathsForKind('catalog', ['notes', 'address'])
    expect(known.has('custom.notes')).toBe(true)
    expect(known.has('custom.address')).toBe(true)
  })

  it('ignores custom keys for kinds that do not declare a Custom group', () => {
    const before = knownPathsForKind('qualification', [])
    const after = knownPathsForKind('qualification', ['foo'])
    expect(after.has('custom.foo')).toBe(false)
    expect(after.size).toBe(before.size)
  })
})
