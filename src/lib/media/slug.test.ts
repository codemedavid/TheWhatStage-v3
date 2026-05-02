import { describe, expect, it } from 'vitest'
import {
  CreateMediaFolderInput,
  MediaFolderSlugSchema,
  MediaSlugSchema,
  UpdateMediaAssetInput,
} from './schemas'
import { makeSlug } from './slug'

describe('makeSlug', () => {
  it('normalizes names into lowercase dash slugs', () => {
    expect(makeSlug('New Review Customer Ryan!')).toBe('new-review-customer-ryan')
  })

  it('strips diacritics from slugs', () => {
    expect(makeSlug('Crème Brûlée À La Mode')).toBe('creme-brulee-a-la-mode')
  })

  it('uses fallback when input has no safe characters', () => {
    expect(makeSlug('***', 'image')).toBe('image')
  })

  it('extends a one-character fallback into a valid slug', () => {
    expect(makeSlug('***', 'x')).toBe('x-1')
  })

  it('uses a valid fallback when normalized input is one character', () => {
    const slug = makeSlug('A', 'image')

    expect(slug).toBe('image')
    expect(MediaSlugSchema.parse(slug)).toBe(slug)
  })

  it('caps length without leaving trailing dashes', () => {
    expect(makeSlug('A '.repeat(90), 'item', 12)).toBe('a-a-a-a-a-a')
  })
})

describe('media schemas', () => {
  it('accepts lowercase URL-safe media slugs', () => {
    expect(MediaSlugSchema.parse('new-review-customer-ryan')).toBe('new-review-customer-ryan')
  })

  it('caps folder slugs at 80 characters while allowing asset slugs up to 120 characters', () => {
    const eighty = `aa${'a'.repeat(78)}`
    const eightyOne = `aa${'a'.repeat(79)}`
    const oneHundredTwenty = `aa${'a'.repeat(118)}`

    expect(MediaFolderSlugSchema.parse(eighty)).toBe(eighty)
    expect(() => MediaFolderSlugSchema.parse(eightyOne)).toThrow()
    expect(() => CreateMediaFolderInput.parse({ name: 'Reviews', slug: eightyOne })).toThrow()
    expect(MediaSlugSchema.parse(oneHundredTwenty)).toBe(oneHundredTwenty)
  })

  it('rejects invalid media slugs', () => {
    expect(() => MediaSlugSchema.parse('Ab')).toThrow()
    expect(() => MediaSlugSchema.parse(' ab')).toThrow()
    expect(() => MediaSlugSchema.parse('Review_Image')).toThrow()
    expect(() => MediaSlugSchema.parse('a')).toThrow()
  })

  it('applies folder and asset defaults', () => {
    expect(CreateMediaFolderInput.parse({ name: ' Reviews ' })).toEqual({
      name: 'Reviews',
      description: null,
    })

    expect(
      UpdateMediaAssetInput.parse({
        id: '11111111-1111-4111-8111-111111111111',
        folderId: '22222222-2222-4222-8222-222222222222',
        name: 'Ryan Review',
        slug: 'ryan-review',
      }),
    ).toMatchObject({
      description: null,
      isArchived: false,
    })
  })
})
