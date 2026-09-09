import { describe, expect, it } from 'vitest'
import { buildMediaContextBlock } from './prompt'
import type { SelectedMediaAsset } from './selector'

function asset(over: Partial<SelectedMediaAsset>): SelectedMediaAsset {
  return {
    id: 'a',
    folderId: 'f',
    name: 'Proof',
    slug: 'proof',
    description: null,
    storagePath: 'p',
    mimeType: 'image/png',
    matchReason: 'semantic',
    ...over,
  }
}

describe('buildMediaContextBlock', () => {
  it('returns null for no media', () => {
    expect(buildMediaContextBlock([])).toBeNull()
    expect(buildMediaContextBlock([], 'candidates')).toBeNull()
  })

  it('keeps the auto "will be sent" wording by default', () => {
    const block = buildMediaContextBlock([asset({})])!
    expect(block).toContain('# Attached media')
    expect(block).toContain('1 image')
    expect(block).toContain('will be sent to the customer automatically')
    expect(block).toContain('- [image] Proof')
    expect(block).not.toContain('attach_media')
  })

  it('labels voice and video candidates and tells the bot to tee them up naturally', () => {
    const block = buildMediaContextBlock([
      asset({ id: 'v', name: 'Walkthrough', mimeType: 'video/mp4', description: 'How the service works' }),
      asset({ id: 'a', name: 'Warm hello', mimeType: 'audio/mpeg' }),
    ])!
    expect(block).toContain('1 video and 1 voice message')
    expect(block).toContain('- [video] Walkthrough — How the service works')
    expect(block).toContain('- [voice message] Warm hello')
    expect(block).toMatch(/voice message/i)
    expect(block).not.toContain('Kita mo po dito sa mga screenshots')
  })

  describe('candidates mode', () => {
    it('lists each item with its slug as the id the model must echo in attach_media', () => {
      const block = buildMediaContextBlock(
        [
          asset({ id: '1', slug: 'ryan-review', name: 'Ryan Review', description: 'Engineer testimonial' }),
          asset({ id: '2', slug: 'demo-video', name: 'Demo', mimeType: 'video/mp4' }),
        ],
        'candidates',
      )!
      expect(block).toContain('# Media candidates')
      expect(block).toContain('- id: ryan-review · [image] Ryan Review — Engineer testimonial')
      expect(block).toContain('- id: demo-video · [video] Demo')
      expect(block).toContain('`attach_media`')
    })

    it('frames items as optional and warns against hinting at unpicked items', () => {
      const block = buildMediaContextBlock([asset({})], 'candidates')!
      expect(block).toContain('NOTHING is sent unless you list its id')
      expect(block).toMatch(/Do NOT mention or hint at items you did not pick/)
      expect(block).not.toContain('will be sent to the customer automatically')
    })
  })
})
