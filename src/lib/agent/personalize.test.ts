import { describe, expect, it } from 'vitest'
import {
  NAME_FALLBACK,
  PERSONALIZATION_TAGS,
  firstNameOf,
  hasPersonalizationTags,
  lastNameOf,
  personalize,
} from './personalize'

describe('firstNameOf', () => {
  it('returns the leading token of a multi-word name', () => {
    expect(firstNameOf('Maria Clara de los Santos')).toBe('Maria')
  })

  it('returns the whole name when there is only one token', () => {
    expect(firstNameOf('Madonna')).toBe('Madonna')
  })

  it('collapses surrounding whitespace', () => {
    expect(firstNameOf('   Juan   Dela Cruz  ')).toBe('Juan')
  })

  it('returns empty string for a missing name', () => {
    expect(firstNameOf(null)).toBe('')
    expect(firstNameOf('   ')).toBe('')
  })
})

describe('lastNameOf', () => {
  it('returns every token after the first', () => {
    expect(lastNameOf('Juan Dela Cruz')).toBe('Dela Cruz')
  })

  it('falls back to the only token when there is no surname', () => {
    expect(lastNameOf('Madonna')).toBe('Madonna')
  })

  it('returns empty string for a missing name', () => {
    expect(lastNameOf(null)).toBe('')
  })
})

describe('personalize — supported tags', () => {
  const lead = { name: 'Juan Dela Cruz' }

  it('substitutes [first_name]', () => {
    expect(personalize('Hi [first_name], kumusta?', lead)).toBe('Hi Juan, kumusta?')
  })

  it('substitutes [name] with the full name', () => {
    expect(personalize('Hello [name]!', lead)).toBe('Hello Juan Dela Cruz!')
  })

  it('substitutes [last_name]', () => {
    expect(personalize('Mr. [last_name]', lead)).toBe('Mr. Dela Cruz')
  })

  it('substitutes [full_name] as an alias of [name]', () => {
    expect(personalize('[full_name]', lead)).toBe('Juan Dela Cruz')
  })

  it('substitutes every occurrence, not just the first', () => {
    expect(personalize('[first_name], hi [first_name]', lead)).toBe('Juan, hi Juan')
  })

  it('is case-insensitive', () => {
    expect(personalize('Hi [First_Name] / [NAME]', lead)).toBe('Hi Juan / Juan Dela Cruz')
  })

  it('accepts space and no-separator spellings', () => {
    expect(personalize('[first name] [firstname]', lead)).toBe('Juan Juan')
  })

  it('tolerates padding inside the brackets', () => {
    expect(personalize('Hi [ first_name ]', lead)).toBe('Hi Juan')
  })

  it('leaves unknown bracket text untouched', () => {
    expect(personalize('See [pricing] for [first_name]', lead)).toBe(
      'See [pricing] for Juan',
    )
  })

  it('returns the text unchanged when it holds no tags', () => {
    expect(personalize('Plain message', lead)).toBe('Plain message')
  })
})

describe('personalize — leads with no usable name', () => {
  it('uses the generic fallback for a null name', () => {
    expect(personalize('Hi [first_name]!', { name: null })).toBe(`Hi ${NAME_FALLBACK}!`)
  })

  it('uses the generic fallback for a blank name', () => {
    expect(personalize('Hi [name]!', { name: '   ' })).toBe(`Hi ${NAME_FALLBACK}!`)
  })

  it('honours a caller-supplied fallback', () => {
    expect(personalize('Hi [first_name]', { name: null }, { fallback: 'friend' })).toBe(
      'Hi friend',
    )
  })

  it('never leaves a literal tag in the output', () => {
    const out = personalize('[name] [first_name] [last_name] [full_name]', { name: null })
    expect(hasPersonalizationTags(out)).toBe(false)
  })
})

describe('personalize — custom field tags', () => {
  it('substitutes an arbitrary custom field by name', () => {
    const lead = { name: 'Ana', custom_fields: { company: 'Acme Signs' } }
    expect(personalize('Hi [first_name] from [company]', lead)).toBe(
      'Hi Ana from Acme Signs',
    )
  })

  it('leaves the bracket text alone when the custom field is absent', () => {
    const lead = { name: 'Ana', custom_fields: {} }
    expect(personalize('Hi [company]', lead)).toBe('Hi [company]')
  })

  it('ignores non-string custom field values', () => {
    const lead = { name: 'Ana', custom_fields: { company: { nested: true } } }
    expect(personalize('Hi [company]', lead)).toBe('Hi [company]')
  })
})

describe('personalize — idempotence and safety', () => {
  it('is idempotent: re-rendering a rendered message changes nothing', () => {
    const lead = { name: 'Juan Dela Cruz' }
    const once = personalize('Hi [first_name]', lead)
    expect(personalize(once, lead)).toBe(once)
  })

  it('does not treat a substituted name as a new tag', () => {
    const lead = { name: '[first_name]' }
    expect(personalize('Hi [first_name]', lead)).toBe('Hi [first_name]')
  })

  it('handles empty input', () => {
    expect(personalize('', { name: 'Ana' })).toBe('')
  })
})

describe('hasPersonalizationTags', () => {
  it('detects a known tag', () => {
    expect(hasPersonalizationTags('Hi [first_name]')).toBe(true)
  })

  it('ignores unknown bracket text', () => {
    expect(hasPersonalizationTags('See [pricing]')).toBe(false)
  })
})

describe('PERSONALIZATION_TAGS', () => {
  it('advertises the canonical tags for the composer UI', () => {
    const tags = PERSONALIZATION_TAGS.map((t) => t.tag)
    expect(tags).toContain('[first_name]')
    expect(tags).toContain('[name]')
    expect(tags).toContain('[last_name]')
  })

  it('every advertised tag actually resolves', () => {
    for (const { tag } of PERSONALIZATION_TAGS) {
      expect(personalize(tag, { name: 'Juan Dela Cruz' })).not.toBe(tag)
    }
  })
})
