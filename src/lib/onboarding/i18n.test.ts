import { describe, expect, it } from 'vitest'
import { t, LANG_COOKIE, readLangFromCookie } from './i18n'

describe('t', () => {
  it('returns Tagalog by default', () => {
    expect(t('welcome.title', 'tl')).toBe('Tara, i-setup natin yung bot mo')
  })

  it('returns English when lang=en', () => {
    expect(t('welcome.title', 'en')).toBe("Let's set up your bot")
  })
})

describe('phase B polish keys', () => {
  it('renames shell.skip_for_now to Save & exit / I-save at lumabas', () => {
    expect(t('shell.skip_for_now', 'en')).toBe('Save & exit')
    expect(t('shell.skip_for_now', 'tl')).toBe('I-save at lumabas')
  })

  it('keeps shell.skip_step as Skip this step / Laktawan ang hakbang', () => {
    expect(t('shell.skip_step', 'en')).toBe('Skip this step')
    expect(t('shell.skip_step', 'tl')).toBe('Laktawan ang hakbang')
  })

  it('renames gen.skip to Skip AI draft / Laktawan ang AI draft', () => {
    expect(t('gen.skip', 'en')).toBe('Skip AI draft')
    expect(t('gen.skip', 'tl')).toBe('Laktawan ang AI draft')
  })

  it('exposes generation.retry', () => {
    expect(t('generation.retry', 'en')).toBe('Retry')
    expect(t('generation.retry', 'tl')).toBe('Subukan ulit')
  })

  it('localizes generation.failure.* reasons', () => {
    expect(t('generation.failure.timeout', 'en')).toMatch(/too long/i)
    expect(t('generation.failure.timeout', 'tl')).toMatch(/labis/i)
    expect(t('generation.failure.not_enqueued', 'en')).toMatch(/did not start/i)
    expect(t('generation.failure.unknown_error', 'en')).toBe('Unexpected error.')
  })

  it('flow.counter interpolates length and max', () => {
    expect(t('flow.counter', 'en', { length: 5, max: 2000 })).toBe('5/20 min · max 2000')
    expect(t('flow.counter', 'tl', { length: 25, max: 2000 })).toBe('25/20 min · max 2000')
  })

  it('exposes goal.recommended', () => {
    expect(t('goal.recommended', 'en')).toBe('Recommended')
    expect(t('goal.recommended', 'tl')).toBe('Inirerekomenda')
  })

  it('knowledge.doc_title interpolates business name', () => {
    expect(t('knowledge.doc_title', 'en', { name: 'Acme' })).toBe('About Acme')
    expect(t('knowledge.doc_title', 'tl', { name: 'Acme' })).toBe('Tungkol sa Acme')
  })
})

describe('readLangFromCookie', () => {
  it('returns "tl" when cookie missing', () => {
    expect(readLangFromCookie(undefined)).toBe('tl')
  })

  it('returns "en" when cookie = "en"', () => {
    expect(readLangFromCookie('en')).toBe('en')
  })

  it('returns "tl" when cookie has unknown value', () => {
    expect(readLangFromCookie('jp')).toBe('tl')
  })

  it('cookie name is ws_onboarding_lang', () => {
    expect(LANG_COOKIE).toBe('ws_onboarding_lang')
  })
})
