import { describe, expect, it } from 'vitest'
import { buildMediaRagText, extractMediaRefs } from './rag-text'

describe('buildMediaRagText', () => {
  it('includes folder and image descriptions with reference tokens', () => {
    const text = buildMediaRagText({
      folderName: 'Reviews',
      folderSlug: 'image-review',
      folderDescription: 'Customer proof and testimonials.',
      assetName: 'Ryan Engineer Review',
      assetSlug: 'new-review-customer-ryan',
      assetDescription: 'Review from engineer Ryan about build quality.',
    })

    expect(text).toContain('# Ryan Engineer Review')
    expect(text).toContain('Media folder: Reviews')
    expect(text).toContain('Folder slug: #image-review')
    expect(text).toContain('Folder description: Customer proof and testimonials.')
    expect(text).toContain('Image slug: @new-review-customer-ryan')
    expect(text).toContain('Image description: Review from engineer Ryan about build quality.')
  })

  it('falls back to slugs and none markers for empty display fields', () => {
    expect(
      buildMediaRagText({
        folderName: ' ',
        folderSlug: 'proof',
        folderDescription: null,
        assetName: '',
        assetSlug: 'before-after',
        assetDescription: null,
      }),
    ).toBe(
      [
        '# before-after',
        '',
        'Media folder: proof',
        'Folder slug: #proof',
        'Folder description: (none)',
        '',
        'Image slug: @before-after',
        'Image description: (none)',
      ].join('\n'),
    )
  })
})

describe('extractMediaRefs', () => {
  it('extracts unique folder and asset refs in first-seen order', () => {
    expect(extractMediaRefs('Use #image-review and @ryan-review. Then #image-review again.')).toEqual({
      folderSlugs: ['image-review'],
      assetSlugs: ['ryan-review'],
    })
  })

  it('ignores email addresses and invalid tokens', () => {
    expect(extractMediaRefs('Email test@example.com and use #valid-folder.')).toEqual({
      folderSlugs: ['valid-folder'],
      assetSlugs: [],
    })
  })

  it('extracts quoted and angle-wrapped refs', () => {
    expect(extractMediaRefs('Use "@quoted-asset", \'@single-quoted\', and <@angle-asset>.')).toEqual({
      folderSlugs: [],
      assetSlugs: ['quoted-asset', 'single-quoted', 'angle-asset'],
    })
  })

  it('deduplicates repeated asset refs while preserving first-seen order', () => {
    expect(extractMediaRefs('@first @second @first @third @second')).toEqual({
      folderSlugs: [],
      assetSlugs: ['first', 'second', 'third'],
    })
  })
})
