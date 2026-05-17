import { describe, expect, it } from 'vitest'
import { VIBE_PRESETS } from './personality-shared'

describe('VIBE_PRESETS', () => {
  it('exposes the four expected presets in stable order', () => {
    expect(VIBE_PRESETS).toEqual([
      'friendly_kuya_ate',
      'professional_consultant',
      'hype_closer',
      'calm_expert',
    ])
  })

  it('values are unique', () => {
    expect(new Set(VIBE_PRESETS).size).toBe(VIBE_PRESETS.length)
  })
})
