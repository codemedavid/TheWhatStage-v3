import { describe, expect, it } from 'vitest'
import { buildMediaRagText, extractMediaRefs } from './rag-text'

describe('buildMediaRagText', () => {
  it('includes folder and image descriptions with reference tokens', () => {
    expect(
      buildMediaRagText({
        folderName: 'Reviews',
        folderSlug: 'image-review',
        folderDescription: 'Customer proof and testimonials.',
        assetName: 'Ryan Engineer Review',
        assetSlug: 'new-review-customer-ryan',
        assetDescription: 'Review from engineer Ryan about build quality.',
      }),
    ).toContain('Folder slug: #image-review')
    expect(
      buildMediaRagText({
        folderName: 'Reviews',
        folderSlug: 'image-review',
        folderDescription: 'Customer proof and testimonials.',
        assetName: 'Ryan Engineer Review',
        assetSlug: 'new-review-customer-ryan',
        assetDescription: 'Review from engineer Ryan about build quality.',
      }),
    ).toContain('Image slug: @new-review-customer-ryan')
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

  it('deduplicates repeated asset refs while preserving first-seen order', () => {
    expect(extractMediaRefs('@first @second @first @third @second')).toEqual({
      folderSlugs: [],
      assetSlugs: ['first', 'second', 'third'],
    })
  })
})
