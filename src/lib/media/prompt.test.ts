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
  })

  it('keeps the image wording for image-only candidates', () => {
    const block = buildMediaContextBlock([asset({})])!
    expect(block).toContain('# Attached media')
    expect(block).toContain('1 image')
    expect(block).toContain('- [image] Proof')
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
})
