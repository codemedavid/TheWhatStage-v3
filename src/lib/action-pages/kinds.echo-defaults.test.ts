import { describe, expect, it } from 'vitest'
import { ACTION_PAGE_KINDS, KIND_REGISTRY } from './kinds'
import { knownPathsForKind, sampleContextForKind } from './echo/variables'
import { renderEchoTemplate } from './echo/render'

describe('KIND_REGISTRY default echo templates', () => {
  for (const kind of ACTION_PAGE_KINDS) {
    it(`renders ${kind}.defaultNotificationText without unknown-token warnings`, () => {
      const tpl = KIND_REGISTRY[kind].defaultNotificationText
      const known = knownPathsForKind(kind, [])
      const ctx = sampleContextForKind(kind, [])
      const result = renderEchoTemplate(tpl, ctx, known)
      expect(result.warnings).toEqual([])
      expect(result.text.length).toBeGreaterThan(0)
    })
  }
})
